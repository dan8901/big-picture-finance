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

const DISPLAY_CURRENCY = "USD";

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

  const ilsDates = txns
    .filter((t) => t.currency === "ILS")
    .map((t) => t.date);
  const rates = await getExchangeRatesForDates(ilsDates, "ILS", DISPLAY_CURRENCY);

  let total = 0;
  for (const tx of txns) {
    let amt = Math.abs(parseFloat(tx.amount));
    if (tx.currency === "ILS") {
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
  // Get expenses
  const expConditions = [
    sql`${transactions.date} >= ${periodStart}`,
    sql`${transactions.date} <= ${periodEnd}`,
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

  const ilsDates = expTxns
    .filter((t) => t.currency === "ILS")
    .map((t) => t.date);
  const rates = await getExchangeRatesForDates(ilsDates, "ILS", DISPLAY_CURRENCY);

  let totalExpenses = 0;
  for (const tx of expTxns) {
    let amt = Math.abs(parseFloat(tx.amount));
    if (tx.currency === "ILS") {
      amt *= rates.get(tx.date) ?? 1;
    }
    totalExpenses += amt;
  }

  // Get manual income
  const incomeEntries = await db.select().from(manualIncomeEntries);
  const rangeStart = new Date(periodStart);
  const rangeEnd = new Date(
    Math.min(new Date(periodEnd).getTime(), Date.now())
  );

  const incomeGroups: Record<string, (typeof incomeEntries)[number][]> = {};
  for (const entry of incomeEntries) {
    if (goal.owner && entry.owner !== goal.owner) continue;
    const key = `${entry.source}-${entry.owner}`;
    if (!incomeGroups[key]) incomeGroups[key] = [];
    incomeGroups[key].push(entry);
  }

  const ilsIncomeMonths: string[] = [];
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
      if (applicable?.currency === "ILS") {
        ilsIncomeMonths.push(`${monthStr}-01`);
      }
    }
  }

  const ilsIncomeRates = await getExchangeRatesForDates(
    ilsIncomeMonths,
    "ILS",
    DISPLAY_CURRENCY
  );

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
        if (applicable.currency === "ILS") {
          const rate = ilsIncomeRates.get(`${monthStr}-01`) ?? 1;
          amount *= rate;
        }
        totalIncome += amount;
      }
    }
  }

  // Also add transaction income (positive amounts)
  const incConditions = [
    sql`${transactions.date} >= ${periodStart}`,
    sql`${transactions.date} <= ${periodEnd}`,
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

  const ilsIncDates = incTxns
    .filter((t) => t.currency === "ILS")
    .map((t) => t.date);
  const incRates = await getExchangeRatesForDates(
    ilsIncDates,
    "ILS",
    DISPLAY_CURRENCY
  );
  for (const tx of incTxns) {
    let amt = parseFloat(tx.amount);
    if (tx.currency === "ILS") {
      amt *= incRates.get(tx.date) ?? 1;
    }
    totalIncome += amt;
  }

  return {
    savings: totalIncome > 0 ? ((totalIncome - totalExpenses) / totalIncome) * 100 : 0,
    income: totalIncome,
    expenses: totalExpenses,
  };
}

function getPeriodDates(period: string, referenceDate?: Date) {
  const now = referenceDate ?? new Date();
  if (period === "monthly") {
    const year = now.getFullYear();
    const month = now.getMonth() + 1;
    const start = `${year}-${String(month).padStart(2, "0")}-01`;
    const lastDay = new Date(year, month, 0).getDate();
    const end = `${year}-${String(month).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;
    return { start, end, label: `${year}-${String(month).padStart(2, "0")}` };
  } else {
    const year = now.getFullYear();
    return { start: `${year}-01-01`, end: `${year}-12-31`, label: `${year}` };
  }
}

function getPeriodDatesFromLabel(label: string, period: string) {
  if (period === "monthly") {
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
    .orderBy(desc(goals.createdAt));

  const results = [];

  for (const goal of allGoals) {
    const { start, end, label } = getPeriodDates(goal.period);

    let currentAmount = 0;
    let progress = 0;
    let status: "on_track" | "at_risk" | "exceeded" | "achieved" = "on_track";

    if (goal.type === "budget_cap") {
      currentAmount = await computeBudgetAmount(goal, start, end);
      const target = parseFloat(goal.targetAmount);
      progress = target > 0 ? (currentAmount / target) * 100 : 0;

      if (progress >= 100) status = "exceeded";
      else if (progress >= 80) status = "at_risk";
      else status = "on_track";
    } else if (goal.type === "savings_amount") {
      const result = await computeSavingsAmount(goal, start, end);
      currentAmount = result.income - result.expenses; // Absolute amount saved (USD)
      const target = parseFloat(goal.targetAmount);
      progress = target > 0 ? (currentAmount / target) * 100 : 0;

      if (currentAmount >= target) status = "achieved";
      else if (progress >= 95) status = "on_track";
      else if (progress >= 70) status = "at_risk";
      else status = "exceeded";
    } else {
      const result = await computeSavingsAmount(goal, start, end);
      currentAmount = result.savings; // This is a percentage
      const target = parseFloat(goal.targetAmount);
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

    // Compute streak: consecutive achieved periods from most recent
    let streak = 0;
    const sortedAchievements = [...achievements].sort((a, b) =>
      b.period.localeCompare(a.period)
    );
    for (const a of sortedAchievements) {
      if (a.achieved === 1) streak++;
      else break;
    }

    const history = achievements.slice(0, 6).map((a) => ({
      period: a.period,
      achieved: a.achieved === 1,
      actualAmount: parseFloat(a.actualAmount),
    }));

    results.push({
      ...goal,
      targetAmount: parseFloat(goal.targetAmount),
      currentAmount: Math.round(currentAmount * 100) / 100,
      currentPeriod: label,
      progress: Math.round(progress * 10) / 10,
      status,
      streak,
      history,
    });
  }

  return NextResponse.json(results);
}

export async function POST(request: NextRequest) {
  const body = await request.json();
  const { name, type, scope, category, owner, targetAmount, currency, period } =
    body;

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
      period,
    })
    .returning();

  return NextResponse.json(created, { status: 201 });
}

export async function PUT(request: NextRequest) {
  const body = await request.json();
  const { id, ...updates } = body;

  if (updates.targetAmount !== undefined) {
    updates.targetAmount = String(updates.targetAmount);
  }

  await db.update(goals).set(updates).where(eq(goals.id, id));

  return NextResponse.json({ ok: true });
}

export async function DELETE(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const id = parseInt(searchParams.get("id") ?? "0");

  await db.delete(goalAchievements).where(eq(goalAchievements.goalId, id));
  await db.delete(goals).where(eq(goals.id, id));

  return NextResponse.json({ ok: true });
}
