import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import {
  goals,
  goalAchievements,
  transactions,
  accounts,
  manualIncomeEntries,
} from "@/db/schema";
import { sql, eq, and } from "drizzle-orm";
import { getExchangeRatesForDates } from "@/lib/exchange";

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
    return ilsToUsd;
  } else {
    const usdToIls = new Map<string, number>();
    for (const [date, rate] of ilsToUsd) {
      usdToIls.set(date, rate > 0 ? 1 / rate : 0);
    }
    return usdToIls;
  }
}

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
      conditions.push(
        sql`${transactions.accountId} IN (${sql.join(ids, sql`, `)})`
      );
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

async function computeSavingsRate(
  goal: typeof goals.$inferSelect,
  periodStart: string,
  periodEnd: string
): Promise<{ rate: number; income: number; expenses: number }> {
  // Cap at end of previous month so partial months don't inflate savings
  const now = new Date();
  const endOfPrevMonth = new Date(now.getFullYear(), now.getMonth(), 0);
  const endOfPrevMonthStr = `${endOfPrevMonth.getFullYear()}-${String(endOfPrevMonth.getMonth() + 1).padStart(2, "0")}-${String(endOfPrevMonth.getDate()).padStart(2, "0")}`;
  const cappedEnd = periodEnd < endOfPrevMonthStr ? periodEnd : endOfPrevMonthStr;

  // Expenses
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

  // Manual income
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

  // Transaction income
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
    rate: totalIncome > 0
      ? ((totalIncome - totalExpenses) / totalIncome) * 100
      : 0,
    income: totalIncome,
    expenses: totalExpenses,
  };
}

export async function POST(request: NextRequest) {
  const { periods } = (await request.json()) as { periods: string[] };

  const allGoals = await db
    .select()
    .from(goals)
    .where(eq(goals.isActive, 1));

  const results: {
    goalId: number;
    goalName: string;
    period: string;
    achieved: boolean;
    actualAmount: number;
    targetAmount: number;
  }[] = [];

  for (const goal of allGoals) {
    for (const periodLabel of periods) {
      const { start, end } = getPeriodDatesFromLabel(periodLabel, goal.period);

      // Skip if period doesn't match goal's period type
      if (goal.period === "monthly" && !periodLabel.includes("-")) continue;
      if (goal.period === "annual" && periodLabel.includes("-")) continue;

      let actualAmount: number;
      let achieved: boolean;

      if (goal.type === "budget_cap") {
        actualAmount = await computeBudgetAmount(goal, start, end);
        achieved = actualAmount <= parseFloat(goal.targetAmount);
      } else if (goal.type === "savings_amount") {
        const result = await computeSavingsRate(goal, start, end);
        actualAmount = result.income - result.expenses;
        achieved = actualAmount >= parseFloat(goal.targetAmount);
      } else {
        const result = await computeSavingsRate(goal, start, end);
        actualAmount = result.rate;
        achieved = actualAmount >= parseFloat(goal.targetAmount);
      }

      // Upsert achievement
      await db
        .insert(goalAchievements)
        .values({
          goalId: goal.id,
          period: periodLabel,
          achieved: achieved ? 1 : 0,
          actualAmount: String(Math.round(actualAmount * 100) / 100),
        })
        .onConflictDoUpdate({
          target: [goalAchievements.goalId, goalAchievements.period],
          set: {
            achieved: achieved ? 1 : 0,
            actualAmount: String(Math.round(actualAmount * 100) / 100),
          },
        });

      results.push({
        goalId: goal.id,
        goalName: goal.name,
        period: periodLabel,
        achieved,
        actualAmount: Math.round(actualAmount * 100) / 100,
        targetAmount: parseFloat(goal.targetAmount),
      });
    }
  }

  return NextResponse.json({ results });
}
