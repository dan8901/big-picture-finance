import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import {
  goals,
  goalAchievements,
  transactions,
  accounts,
  manualIncomeEntries,
} from "@/db/schema";
import { sql, eq, and, desc } from "drizzle-orm";
import { getExchangeRatesForDates } from "@/lib/exchange";
import { evaluateGoals } from "@/lib/evaluate-goals";

// Convert transaction amounts to the goal's currency.
// Only ILS→USD rates are stored in the DB, so for USD→ILS we fetch ILS→USD and invert.
async function convertToGoalCurrency(
  txns: Array<{ amount: string; currency: string; date: string }>,
  goalCurrency: string
): Promise<Map<string, number>> {
  const needConversion = txns.filter((t) => t.currency !== goalCurrency);
  const convDates = needConversion.map((t) => t.date);
  if (convDates.length === 0) return new Map();

  // Always fetch ILS→USD (what's in the DB)
  const ilsToUsd = await getExchangeRatesForDates(convDates, "ILS", "USD");

  if (goalCurrency === "USD") {
    // Converting ILS→USD: use rates directly
    return ilsToUsd;
  } else {
    // Converting USD→ILS: invert the ILS→USD rate
    const usdToIls = new Map<string, number>();
    for (const [date, rate] of ilsToUsd) {
      usdToIls.set(date, rate > 0 ? 1 / rate : 0);
    }
    return usdToIls;
  }
}

// Compute actual spending for a budget_cap goal in a given period
async function computeBudgetAmount(
  goal: typeof goals.$inferSelect,
  periodStart: string,
  periodEnd: string
): Promise<number> {
  const conditions = [
    sql`${transactions.date} >= ${periodStart}`,
    sql`${transactions.date} <= ${periodEnd}`,
    eq(transactions.excluded, 0),
    sql`CAST(${transactions.amount} AS numeric) < 0`,
  ];

  if (goal.scope === "category" && goal.category) {
    conditions.push(eq(transactions.category, goal.category));
  }

  if (goal.owner) {
    const ownerAccounts = await db
      .select({ id: accounts.id })
      .from(accounts)
      .where(eq(accounts.owner, goal.owner));
    const ids = ownerAccounts.map((a) => a.id);
    if (ids.length > 0) {
      conditions.push(sql`${transactions.accountId} IN (${sql.join(ids, sql`, `)})`);
    } else {
      return 0;
    }
  }

  const txns = await db
    .select({
      amount: transactions.amount,
      currency: transactions.currency,
      date: transactions.date,
    })
    .from(transactions)
    .where(and(...conditions));

  const rates = await convertToGoalCurrency(txns, goal.currency);

  let total = 0;
  for (const tx of txns) {
    let amt = Math.abs(parseFloat(tx.amount));
    if (tx.currency !== goal.currency) {
      amt *= rates.get(tx.date) ?? 1;
    }
    total += amt;
  }

  return total;
}

// Compute savings for a savings_target goal
async function computeSavingsAmount(
  goal: typeof goals.$inferSelect,
  periodStart: string,
  periodEnd: string
): Promise<{ savings: number; income: number; expenses: number }> {
  // Cap at end of previous month so partial months don't inflate savings
  // (manual income is a full-month lump sum, but expenses are partial)
  const now = new Date();
  const endOfPrevMonth = new Date(now.getFullYear(), now.getMonth(), 0);
  const endOfPrevMonthStr = `${endOfPrevMonth.getFullYear()}-${String(endOfPrevMonth.getMonth() + 1).padStart(2, "0")}-${String(endOfPrevMonth.getDate()).padStart(2, "0")}`;
  const cappedEnd = periodEnd < endOfPrevMonthStr ? periodEnd : endOfPrevMonthStr;

  // Get expenses
  const expConditions = [
    sql`${transactions.date} >= ${periodStart}`,
    sql`${transactions.date} <= ${cappedEnd}`,
    eq(transactions.excluded, 0),
    sql`CAST(${transactions.amount} AS numeric) < 0`,
  ];

  if (goal.owner) {
    const ownerAccounts = await db
      .select({ id: accounts.id })
      .from(accounts)
      .where(eq(accounts.owner, goal.owner));
    const ids = ownerAccounts.map((a) => a.id);
    if (ids.length > 0) {
      expConditions.push(
        sql`${transactions.accountId} IN (${sql.join(ids, sql`, `)})`
      );
    }
  }

  const expTxns = await db
    .select({
      amount: transactions.amount,
      currency: transactions.currency,
      date: transactions.date,
    })
    .from(transactions)
    .where(and(...expConditions));

  const expRates = await convertToGoalCurrency(expTxns, goal.currency);

  let totalExpenses = 0;
  for (const tx of expTxns) {
    let amt = Math.abs(parseFloat(tx.amount));
    if (tx.currency !== goal.currency) {
      amt *= expRates.get(tx.date) ?? 1;
    }
    totalExpenses += amt;
  }

  // Get manual income
  const incomeEntries = await db.select().from(manualIncomeEntries);
  const rangeStart = new Date(periodStart);
  const rangeEnd = new Date(
    Math.min(new Date(cappedEnd).getTime(), endOfPrevMonth.getTime())
  );

  const incomeGroups: Record<string, (typeof incomeEntries)[number][]> = {};
  for (const entry of incomeEntries) {
    if (goal.owner && entry.owner !== goal.owner) continue;
    const key = `${entry.source}-${entry.owner}`;
    if (!incomeGroups[key]) incomeGroups[key] = [];
    incomeGroups[key].push(entry);
  }

  // Collect dates for income entries that need conversion
  const incomeConvDates: string[] = [];
  for (const entries of Object.values(incomeGroups)) {
    entries.sort((a, b) => a.startDate.localeCompare(b.startDate));
    for (
      let month = new Date(rangeStart);
      month <= rangeEnd;
      month.setMonth(month.getMonth() + 1)
    ) {
      const monthStr = `${month.getFullYear()}-${String(month.getMonth() + 1).padStart(2, "0")}`;
      let applicable = null;
      for (const entry of entries) {
        if (entry.startDate <= monthStr) applicable = entry;
      }
      if (applicable && applicable.currency !== goal.currency) {
        incomeConvDates.push(`${monthStr}-01`);
      }
    }
  }

  // Always fetch ILS→USD and invert if needed (only ILS→USD rates are stored)
  const incomeConvRatesRaw =
    incomeConvDates.length > 0
      ? await getExchangeRatesForDates(incomeConvDates, "ILS", "USD")
      : new Map<string, number>();
  let incomeConvRates: Map<string, number>;
  if (goal.currency === "USD") {
    incomeConvRates = incomeConvRatesRaw;
  } else {
    incomeConvRates = new Map<string, number>();
    for (const [date, rate] of incomeConvRatesRaw) {
      incomeConvRates.set(date, rate > 0 ? 1 / rate : 0);
    }
  }

  let totalIncome = 0;
  for (const entries of Object.values(incomeGroups)) {
    entries.sort((a, b) => a.startDate.localeCompare(b.startDate));
    for (
      let month = new Date(rangeStart);
      month <= rangeEnd;
      month.setMonth(month.getMonth() + 1)
    ) {
      const monthStr = `${month.getFullYear()}-${String(month.getMonth() + 1).padStart(2, "0")}`;
      let applicable = null;
      for (const entry of entries) {
        if (entry.startDate <= monthStr) applicable = entry;
      }
      if (applicable) {
        let amount = parseFloat(applicable.monthlyAmount);
        if (applicable.currency !== goal.currency) {
          const rate = incomeConvRates.get(`${monthStr}-01`) ?? 1;
          amount *= rate;
        }
        totalIncome += amount;
      }
    }
  }

  // Also add transaction income (positive amounts)
  const incConditions = [
    sql`${transactions.date} >= ${periodStart}`,
    sql`${transactions.date} <= ${cappedEnd}`,
    eq(transactions.excluded, 0),
    sql`CAST(${transactions.amount} AS numeric) > 0`,
  ];
  if (goal.owner) {
    const ownerAccounts = await db
      .select({ id: accounts.id })
      .from(accounts)
      .where(eq(accounts.owner, goal.owner));
    const ids = ownerAccounts.map((a) => a.id);
    if (ids.length > 0) {
      incConditions.push(
        sql`${transactions.accountId} IN (${sql.join(ids, sql`, `)})`
      );
    }
  }
  const incTxns = await db
    .select({
      amount: transactions.amount,
      currency: transactions.currency,
      date: transactions.date,
    })
    .from(transactions)
    .where(and(...incConditions));

  const incTxRates = await convertToGoalCurrency(incTxns, goal.currency);
  for (const tx of incTxns) {
    let amt = parseFloat(tx.amount);
    if (tx.currency !== goal.currency) {
      amt *= incTxRates.get(tx.date) ?? 1;
    }
    totalIncome += amt;
  }

  return {
    savings: totalIncome > 0 ? ((totalIncome - totalExpenses) / totalIncome) * 100 : 0,
    income: totalIncome,
    expenses: totalExpenses,
  };
}

function getPeriodDates(referenceDate?: Date) {
  const now = referenceDate ?? new Date();
  const year = now.getFullYear();
  return { start: `${year}-01-01`, end: `${year}-12-31`, label: `${year}` };
}

function getMonthPeriodDates(referenceDate?: Date) {
  const now = referenceDate ?? new Date();
  const year = now.getFullYear();
  const month = now.getMonth() + 1;
  const start = `${year}-${String(month).padStart(2, "0")}-01`;
  const lastDay = new Date(year, month, 0).getDate();
  const end = `${year}-${String(month).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;
  return { start, end, label: `${year}-${String(month).padStart(2, "0")}` };
}

function getPeriodDatesFromLabel(label: string) {
  if (label.includes("-")) {
    const [year, month] = label.split("-").map(Number);
    const start = `${year}-${String(month).padStart(2, "0")}-01`;
    const lastDay = new Date(year, month, 0).getDate();
    const end = `${year}-${String(month).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;
    return { start, end };
  } else {
    return { start: `${label}-01-01`, end: `${label}-12-31` };
  }
}

export async function GET() {
  const allGoals = await db
    .select()
    .from(goals)
    .orderBy(goals.sortOrder, desc(goals.createdAt));

  // Auto-evaluate if stale: check if last monthly achievement covers last completed month
  const now = new Date();
  const lastCompletedMonth = `${now.getFullYear()}-${String(now.getMonth()).padStart(2, "0")}`;
  // getMonth() is 0-based, so getMonth() for March = 2, which gives "02" = February — exactly last completed month
  if (lastCompletedMonth >= "2024-01") {
    const [latestAchievement] = await db
      .select({ maxPeriod: sql<string>`MAX(${goalAchievements.period})` })
      .from(goalAchievements)
      .where(sql`${goalAchievements.period} LIKE '____-__'`);
    const maxPeriod = latestAchievement?.maxPeriod;
    if (!maxPeriod || maxPeriod < lastCompletedMonth) {
      await evaluateGoals();
    }
  }

  // Get the date of the last available transaction for pace calculation (budget goals)
  const [lastTxResult] = await db
    .select({ maxDate: sql<string>`MAX(${transactions.date})` })
    .from(transactions)
    .where(eq(transactions.excluded, 0));
  const lastTxDate = lastTxResult?.maxDate ? new Date(lastTxResult.maxDate) : new Date();

  // Savings goals are capped at end of previous month
  const nowDate = new Date();
  const endOfPrevMonth = new Date(nowDate.getFullYear(), nowDate.getMonth(), 0);

  const results = [];

  for (const goal of allGoals) {
    const { start, end, label } = getPeriodDates();
    const target = parseFloat(goal.targetAmount);

    // Derive monthly target: /12 for amount-based, same for percentage
    const monthlyTarget = goal.type === "savings_target" ? target : target / 12;

    let currentAmount = 0;
    let progress = 0;
    let status: "on_track" | "at_risk" | "exceeded" | "achieved" = "on_track";

    // Compute pace fraction for annual progress
    const paceDate = goal.type === "budget_cap" ? lastTxDate : endOfPrevMonth;
    const paceFraction = Math.min((paceDate.getMonth() + 1) / 12, 1);

    if (goal.type === "budget_cap") {
      currentAmount = await computeBudgetAmount(goal, start, end);
      progress = target > 0 ? (currentAmount / target) * 100 : 0;
      const paceProgress = paceFraction > 0 ? progress / paceFraction : progress;

      if (progress >= 100) status = "exceeded";
      else if (paceProgress >= 80) status = "at_risk";
      else status = "on_track";
    } else if (goal.type === "savings_amount") {
      const result = await computeSavingsAmount(goal, start, end);
      currentAmount = result.income - result.expenses;
      progress = target > 0 ? (currentAmount / target) * 100 : 0;
      const paceProgress = paceFraction > 0 ? progress / paceFraction : progress;

      if (currentAmount >= target) status = "achieved";
      else if (paceProgress >= 95) status = "on_track";
      else if (paceProgress >= 70) status = "at_risk";
      else status = "exceeded";
    } else {
      // savings_target (percentage) — not pace-dependent
      const result = await computeSavingsAmount(goal, start, end);
      currentAmount = result.savings;
      progress = target > 0 ? (currentAmount / target) * 100 : 0;

      if (currentAmount >= target) status = "achieved";
      else if (progress >= 95) status = "on_track";
      else if (progress >= 70) status = "at_risk";
      else status = "exceeded";
    }

    // Get achievements for streak + history
    const achievements = await db
      .select()
      .from(goalAchievements)
      .where(eq(goalAchievements.goalId, goal.id))
      .orderBy(desc(goalAchievements.period));

    // Split into monthly and annual achievements
    const monthlyAchievements = achievements.filter((a) => a.period.includes("-"));
    const annualAchievements = achievements.filter((a) => !a.period.includes("-"));

    // Streak based on monthly achievements (consecutive months hitting derived target)
    let streak = 0;
    for (const a of monthlyAchievements) {
      if (a.achieved === 1) streak++;
      else break;
    }

    const monthlyHistory = monthlyAchievements.slice(0, 12).map((a) => ({
      period: a.period,
      achieved: a.achieved === 1,
      actualAmount: parseFloat(a.actualAmount),
    }));

    const annualHistory = annualAchievements.slice(0, 6).map((a) => ({
      period: a.period,
      achieved: a.achieved === 1,
      actualAmount: parseFloat(a.actualAmount),
    }));

    // Combined history for backward compat (sparklines etc.)
    const history = monthlyAchievements.slice(0, 6).map((a) => ({
      period: a.period,
      achieved: a.achieved === 1,
      actualAmount: parseFloat(a.actualAmount),
    }));

    results.push({
      ...goal,
      targetAmount: parseFloat(goal.targetAmount),
      monthlyTarget: Math.round(monthlyTarget * 100) / 100,
      currentAmount: Math.round(currentAmount * 100) / 100,
      currentPeriod: label,
      progress: Math.round(progress * 10) / 10,
      status,
      streak,
      history,
      monthlyHistory,
      annualHistory,
    });
  }

  return NextResponse.json(results);
}

export async function POST(request: NextRequest) {
  const body = await request.json();
  const { name, type, scope, category, owner, targetAmount, currency } =
    body;

  const [maxResult] = await db
    .select({ maxOrder: sql<number>`COALESCE(MAX(${goals.sortOrder}), -1)` })
    .from(goals);
  const nextOrder = (maxResult?.maxOrder ?? -1) + 1;

  const [created] = await db
    .insert(goals)
    .values({
      name,
      type,
      scope,
      category: scope === "category" ? category : null,
      owner: owner || null,
      targetAmount: String(targetAmount),
      currency,
      period: "annual",
      sortOrder: nextOrder,
    })
    .returning();

  // Auto-evaluate the new goal to populate its achievement history
  evaluateGoals(undefined, [created.id]).catch(() => {});

  return NextResponse.json(created, { status: 201 });
}

export async function PUT(request: NextRequest) {
  const body = await request.json();
  const { id, ...updates } = body;

  const hasTargetChange = updates.targetAmount !== undefined;
  if (hasTargetChange) {
    updates.targetAmount = String(updates.targetAmount);
  }

  await db.update(goals).set(updates).where(eq(goals.id, id));

  // Re-evaluate if target changed (past achievements may flip)
  if (hasTargetChange) {
    evaluateGoals(undefined, [id]).catch(() => {});
  }

  return NextResponse.json({ ok: true });
}

export async function DELETE(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const id = parseInt(searchParams.get("id") ?? "0");

  await db.delete(goalAchievements).where(eq(goalAchievements.goalId, id));
  await db.delete(goals).where(eq(goals.id, id));

  return NextResponse.json({ ok: true });
}
