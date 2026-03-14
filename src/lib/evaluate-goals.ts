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

export type EvalResult = {
  goalId: number;
  goalName: string;
  period: string;
  achieved: boolean;
  actualAmount: number;
  targetAmount: number;
};

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

function generateDefaultPeriods(): string[] {
  const periods: string[] = [];
  const now = new Date();
  for (let i = 1; i <= 6; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    periods.push(
      `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`
    );
  }
  // Add previous year(s) covered by the 6-month window
  const yearsInRange = new Set(periods.map((p) => p.split("-")[0]));
  for (const y of yearsInRange) {
    if (parseInt(y) < now.getFullYear()) {
      periods.push(y);
    }
  }
  return periods;
}

// Convert transaction amounts to the goal's currency.
async function convertToGoalCurrency(
  txns: Array<{ amount: string; currency: string; date: string }>,
  goalCurrency: string
): Promise<Map<string, number>> {
  const needConversion = txns.filter((t) => t.currency !== goalCurrency);
  const convDates = needConversion.map((t) => t.date);
  if (convDates.length === 0) return new Map();

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

/**
 * Evaluate goals and upsert achievements.
 * @param periods - Period labels to evaluate (auto-generated if not provided)
 * @param goalIds - Specific goal IDs to evaluate (all active goals if not provided)
 */
export async function evaluateGoals(
  periods?: string[],
  goalIds?: number[]
): Promise<EvalResult[]> {
  const effectivePeriods = periods ?? generateDefaultPeriods();

  let goalsToEvaluate;
  if (goalIds && goalIds.length > 0) {
    goalsToEvaluate = await db
      .select()
      .from(goals)
      .where(
        and(
          eq(goals.isActive, 1),
          sql`${goals.id} IN (${sql.join(goalIds.map((id) => sql`${id}`), sql`, `)})`
        )
      );
  } else {
    goalsToEvaluate = await db
      .select()
      .from(goals)
      .where(eq(goals.isActive, 1));
  }

  const results: EvalResult[] = [];

  for (const goal of goalsToEvaluate) {
    const annualTarget = parseFloat(goal.targetAmount);

    for (const periodLabel of effectivePeriods) {
      const { start, end } = getPeriodDatesFromLabel(periodLabel);
      const isMonthlyPeriod = periodLabel.includes("-");

      const effectiveTarget = isMonthlyPeriod && goal.type !== "savings_target"
        ? annualTarget / 12
        : annualTarget;

      let actualAmount: number;
      let achieved: boolean;

      if (goal.type === "budget_cap") {
        actualAmount = await computeBudgetAmount(goal, start, end);
        achieved = actualAmount <= effectiveTarget;
      } else if (goal.type === "savings_amount") {
        const result = await computeSavingsRate(goal, start, end);
        actualAmount = result.income - result.expenses;
        achieved = actualAmount >= effectiveTarget;
      } else {
        const result = await computeSavingsRate(goal, start, end);
        actualAmount = result.rate;
        achieved = actualAmount >= effectiveTarget;
      }

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
        targetAmount: Math.round(effectiveTarget * 100) / 100,
      });
    }
  }

  return results;
}
