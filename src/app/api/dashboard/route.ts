import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { transactions, manualIncomeEntries, accounts, events } from "@/db/schema";
import { sql, and, eq } from "drizzle-orm";
import { getExchangeRatesForDates } from "@/lib/exchange";

const DISPLAY_CURRENCY = "USD";

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const startDate =
    searchParams.get("startDate") ?? `${new Date().getFullYear()}-01-01`;
  const endDate =
    searchParams.get("endDate") ?? `${new Date().getFullYear()}-12-31`;

  // Get all non-excluded transactions in range
  const txns = await db
    .select({
      id: transactions.id,
      date: transactions.date,
      amount: transactions.amount,
      currency: transactions.currency,
      description: transactions.description,
      category: transactions.category,
      eventId: transactions.eventId,
      accountId: transactions.accountId,
      isRecurring: transactions.isRecurring,
    })
    .from(transactions)
    .where(
      and(
        sql`${transactions.date} >= ${startDate}`,
        sql`${transactions.date} <= ${endDate}`,
        eq(transactions.excluded, 0)
      )
    );

  // Get accounts for owner info
  const accts = await db.select().from(accounts);
  const accountMap = Object.fromEntries(accts.map((a) => [a.id, a]));

  const evts = await db.select().from(events);
  const eventMap = Object.fromEntries(evts.map((e) => [e.id, e]));

  // Fetch exchange rates for all ILS transaction dates
  const ilsDates = txns
    .filter((tx) => tx.currency === "ILS")
    .map((tx) => tx.date);
  const ilsRates = await getExchangeRatesForDates(
    ilsDates,
    "ILS",
    DISPLAY_CURRENCY
  );

  // Compute USD→ILS rates (inverse of ILS→USD) for ILS total calculations
  // Also fetch rates for USD transaction dates
  const usdDates = txns
    .filter((tx) => tx.currency === "USD")
    .map((tx) => tx.date);
  const usdIlsRatesRaw = await getExchangeRatesForDates(
    usdDates,
    "ILS",
    "USD"
  );
  const usdToIlsRates = new Map<string, number>();
  for (const [date, rate] of usdIlsRatesRaw) {
    usdToIlsRates.set(date, rate > 0 ? 1 / rate : 0);
  }

  // Get manual income entries
  const incomeEntries = await db.select().from(manualIncomeEntries);

  // Calculate manual income for the date range, capped at today
  const rangeStart = new Date(startDate);
  const rangeEnd = new Date(Math.min(new Date(endDate).getTime(), Date.now()));

  let totalManualIncome = 0;
  let totalManualIncomeILS = 0;
  let totalUSDFromILS = 0;
  let totalRawILS = 0;
  const incomeBySource: Record<string, number> = {};
  const incomeBySourceILS: Record<string, number> = {};
  const incomeByOwner: Record<string, number> = {};

  // Collect ILS manual income months for rate fetching
  const ilsIncomeMonths: string[] = [];
  const incomeGroups: Record<string, typeof incomeEntries> = {};
  for (const entry of incomeEntries) {
    const key = `${entry.source}-${entry.owner}`;
    if (!incomeGroups[key]) incomeGroups[key] = [];
    incomeGroups[key].push(entry);
  }

  // First pass: collect months that need rate conversion
  const usdIncomeMonths: string[] = [];
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
      if (applicable && applicable.currency === "ILS") {
        ilsIncomeMonths.push(`${monthStr}-01`);
      }
      if (applicable && applicable.currency === "USD") {
        usdIncomeMonths.push(`${monthStr}-01`);
      }
    }
  }

  const ilsIncomeRates = await getExchangeRatesForDates(
    ilsIncomeMonths,
    "ILS",
    DISPLAY_CURRENCY
  );
  // USD→ILS rates for manual income (inverse of ILS→USD)
  const usdIncomeIlsRatesRaw = await getExchangeRatesForDates(
    usdIncomeMonths,
    "ILS",
    "USD"
  );
  const usdIncomeToIlsRates = new Map<string, number>();
  for (const [date, rate] of usdIncomeIlsRatesRaw) {
    usdIncomeToIlsRates.set(date, rate > 0 ? 1 / rate : 0);
  }

  // Second pass: calculate with conversion
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
        const rawAmount = parseFloat(applicable.monthlyAmount);
        let amount = rawAmount;
        if (applicable.currency === "ILS") {
          totalManualIncomeILS += rawAmount;
          totalRawILS += rawAmount;
          const rate = ilsIncomeRates.get(`${monthStr}-01`) ?? 1;
          amount *= rate;
          totalUSDFromILS += amount;
          incomeBySourceILS[applicable.source] =
            (incomeBySourceILS[applicable.source] ?? 0) + rawAmount;
        } else {
          // USD manual income → convert to ILS for ILS totals
          const ilsRate = usdIncomeToIlsRates.get(`${monthStr}-01`) ?? 0;
          totalManualIncomeILS += rawAmount * ilsRate;
          incomeBySourceILS[applicable.source] =
            (incomeBySourceILS[applicable.source] ?? 0) + rawAmount * ilsRate;
        }
        totalManualIncome += amount;
        incomeBySource[applicable.source] =
          (incomeBySource[applicable.source] ?? 0) + amount;
        incomeByOwner[applicable.owner] =
          (incomeByOwner[applicable.owner] ?? 0) + amount;
      }
    }
  }

  // Calculate transaction-based metrics
  let totalExpenses = 0;
  let totalTransactionIncome = 0;
  let totalExpensesILS = 0;
  let totalTransactionIncomeILS = 0;
  const expensesByCategory: Record<string, number> = {};
  const expensesByCategoryILS: Record<string, number> = {};
  const expensesByOwner: Record<string, number> = {};
  const eventExpenses: Record<string, number> = {};
  const eventExpensesILS: Record<string, number> = {};
  const eventTxCounts: Record<string, number> = {};
  let normalExpenses = 0;
  let normalExpensesILS = 0;
  let recurringExpenses = 0;
  let nonRecurringExpenses = 0;
  const merchantsByCategory: Record<string, Record<string, { usd: number; ils: number; count: number; recurringCount: number }>> = {};
  const recurringByCategory: Record<string, number> = {};
  const nonRecurringByCategory: Record<string, number> = {};
  const monthlyData: Record<
    string,
    { income: number; expenses: number; incomeILS: number; expensesILS: number; usdFromILS: number; recurring: number; nonRecurring: number }
  > = {};

  // Seed monthlyData with manual income (salary, RSU, ESPP, pension, keren_hishtalmut)
  for (const entries of Object.values(incomeGroups)) {
    const sorted = [...entries].sort((a, b) => a.startDate.localeCompare(b.startDate));
    for (
      let month = new Date(rangeStart);
      month <= rangeEnd;
      month.setMonth(month.getMonth() + 1)
    ) {
      const monthStr = `${month.getFullYear()}-${String(month.getMonth() + 1).padStart(2, "0")}`;
      let applicable = null;
      for (const entry of sorted) {
        if (entry.startDate <= monthStr) applicable = entry;
      }
      if (applicable) {
        if (!monthlyData[monthStr]) {
          monthlyData[monthStr] = { income: 0, expenses: 0, incomeILS: 0, expensesILS: 0, usdFromILS: 0, recurring: 0, nonRecurring: 0 };
        }
        const rawAmount = parseFloat(applicable.monthlyAmount);
        let amount = rawAmount;
        if (applicable.currency === "ILS") {
          monthlyData[monthStr].incomeILS += rawAmount;
          const rate = ilsIncomeRates.get(`${monthStr}-01`) ?? 1;
          amount = rawAmount * rate;
        } else {
          // USD manual income → convert to ILS for monthly ILS tracking
          const ilsRate = usdIncomeToIlsRates.get(`${monthStr}-01`) ?? 0;
          monthlyData[monthStr].incomeILS += rawAmount * ilsRate;
        }
        monthlyData[monthStr].income += amount;
      }
    }
  }

  for (const tx of txns) {
    const rawAmount = parseFloat(tx.amount);
    let amount = rawAmount;
    const account = accountMap[tx.accountId];
    const owner = account?.owner ?? "Unknown";
    const month = tx.date.substring(0, 7);

    if (!monthlyData[month])
      monthlyData[month] = { income: 0, expenses: 0, incomeILS: 0, expensesILS: 0, usdFromILS: 0, recurring: 0, nonRecurring: 0 };

    // Track raw ILS amounts and convert to display currency
    if (tx.currency === "ILS") {
      if (rawAmount < 0) {
        totalExpensesILS += Math.abs(rawAmount);
      } else {
        totalTransactionIncomeILS += rawAmount;
      }
      totalRawILS += Math.abs(rawAmount);
      const rate = ilsRates.get(tx.date) ?? 1;
      amount *= rate;
      totalUSDFromILS += Math.abs(amount);
      monthlyData[month].usdFromILS += Math.abs(amount);
    } else {
      // USD transactions → convert to ILS for ILS totals
      const ilsRate = usdToIlsRates.get(tx.date) ?? 0;
      const ilsEquiv = rawAmount * ilsRate;
      if (rawAmount < 0) {
        totalExpensesILS += Math.abs(ilsEquiv);
      } else {
        totalTransactionIncomeILS += ilsEquiv;
      }
    }

    const isILS = tx.currency === "ILS";
    const ilsEquiv = tx.currency === "USD"
      ? Math.abs(rawAmount) * (usdToIlsRates.get(tx.date) ?? 0)
      : Math.abs(rawAmount);

    if (amount < 0) {
      const absAmount = Math.abs(amount);
      const absRaw = Math.abs(rawAmount);
      totalExpenses += absAmount;
      const category = tx.category ?? "Uncategorized";
      expensesByCategory[category] =
        (expensesByCategory[category] ?? 0) + absAmount;
      expensesByCategoryILS[category] =
        (expensesByCategoryILS[category] ?? 0) + (isILS ? absRaw : ilsEquiv);
      monthlyData[month].expensesILS += isILS ? absRaw : ilsEquiv;
      // Track per-merchant spend within category
      const merchantKey = tx.description
        .toLowerCase()
        .trim()
        .replace(/[\u200f\u200e\u202a\u202b\u202c\u2069\u2068\u2067\u2066\u00a0]/g, "")
        .replace(/\s+/g, " ");
      if (!merchantsByCategory[category]) merchantsByCategory[category] = {};
      if (!merchantsByCategory[category][merchantKey]) {
        merchantsByCategory[category][merchantKey] = { usd: 0, ils: 0, count: 0, recurringCount: 0 };
      }
      merchantsByCategory[category][merchantKey].usd += absAmount;
      merchantsByCategory[category][merchantKey].count += 1;
      if (tx.isRecurring) {
        merchantsByCategory[category][merchantKey].recurringCount += 1;
      }
      merchantsByCategory[category][merchantKey].ils += ilsEquiv;
      expensesByOwner[owner] = (expensesByOwner[owner] ?? 0) + absAmount;
      monthlyData[month].expenses += absAmount;

      if (tx.eventId) {
        eventExpenses[String(tx.eventId)] =
          (eventExpenses[String(tx.eventId)] ?? 0) + absAmount;
        eventTxCounts[String(tx.eventId)] = (eventTxCounts[String(tx.eventId)] ?? 0) + 1;
        eventExpensesILS[String(tx.eventId)] =
          (eventExpensesILS[String(tx.eventId)] ?? 0) + ilsEquiv;
      } else {
        normalExpenses += absAmount;
        normalExpensesILS += ilsEquiv;
        if (tx.isRecurring) {
          recurringExpenses += absAmount;
          recurringByCategory[category] = (recurringByCategory[category] ?? 0) + absAmount;
          monthlyData[month].recurring += absAmount;
        } else {
          nonRecurringExpenses += absAmount;
          nonRecurringByCategory[category] = (nonRecurringByCategory[category] ?? 0) + absAmount;
          monthlyData[month].nonRecurring += absAmount;
        }
      }
    } else {
      totalTransactionIncome += amount;
      monthlyData[month].income += amount;
      const incIlsEquiv = isILS ? rawAmount : rawAmount * (usdToIlsRates.get(tx.date) ?? 0);
      monthlyData[month].incomeILS += incIlsEquiv;
      incomeBySourceILS["deposits"] =
        (incomeBySourceILS["deposits"] ?? 0) + incIlsEquiv;
      incomeBySource["deposits"] =
        (incomeBySource["deposits"] ?? 0) + amount;
      incomeByOwner[owner] = (incomeByOwner[owner] ?? 0) + amount;
    }
  }

  const totalIncome = totalManualIncome + totalTransactionIncome;
  const totalSaved = totalIncome - totalExpenses;
  const savingsRate = totalIncome > 0 ? (totalSaved / totalIncome) * 100 : 0;

  const totalIncomeILS = totalManualIncomeILS + totalTransactionIncomeILS;
  const totalSavedILS = totalIncomeILS - totalExpensesILS;
  const weightedExchangeRate =
    totalRawILS > 0 ? totalUSDFromILS / totalRawILS : 0;

  // Compute top 20 merchants per category + total merchant count
  type MerchantEntry = { name: string; usd: number; ils: number; count: number; avgUsd: number; isRecurring: boolean; category: string };
  const topMerchantsByCategory: Record<string, MerchantEntry[]> = {};
  const merchantCountByCategory: Record<string, number> = {};
  const txCountByCategory: Record<string, number> = {};
  const allMerchantEntries: MerchantEntry[] = [];
  for (const [cat, merchants] of Object.entries(merchantsByCategory)) {
    const all = Object.entries(merchants)
      .map(([name, totals]) => ({
        name,
        usd: totals.usd,
        ils: totals.ils,
        count: totals.count,
        avgUsd: totals.usd / totals.count,
        isRecurring: totals.recurringCount > totals.count / 2,
        category: cat,
      }))
      .sort((a, b) => b.usd - a.usd);
    merchantCountByCategory[cat] = all.length;
    txCountByCategory[cat] = all.reduce((sum, m) => sum + m.count, 0);
    topMerchantsByCategory[cat] = all.slice(0, 20);
    allMerchantEntries.push(...all);
  }

  const recurringMerchants = allMerchantEntries
    .filter((m) => m.isRecurring)
    .sort((a, b) => b.usd - a.usd);
  const nonRecurringTopMerchants = allMerchantEntries
    .filter((m) => !m.isRecurring)
    .sort((a, b) => b.usd - a.usd)
    .slice(0, 20);

  // Top 10 largest individual non-recurring expense transactions
  const topExpenseTransactions = txns
    .filter((tx) => parseFloat(tx.amount) < 0 && !tx.isRecurring && !tx.eventId)
    .map((tx) => {
      const rawAmount = parseFloat(tx.amount);
      let usdAmount = Math.abs(rawAmount);
      if (tx.currency === "ILS") {
        const rate = ilsRates.get(tx.date) ?? 1;
        usdAmount = Math.abs(rawAmount * rate);
      }
      return {
        date: tx.date,
        description: tx.description,
        amount: rawAmount,
        currency: tx.currency,
        usdAmount,
        category: tx.category ?? "Uncategorized",
        accountId: tx.accountId,
        owner: accountMap[tx.accountId]?.owner ?? "Unknown",
      };
    })
    .sort((a, b) => b.usdAmount - a.usdAmount)
    .slice(0, 10);

  const eventDetails = Object.entries(eventExpenses).map(([id, usd]) => {
    const evt = eventMap[parseInt(id)];
    return {
      id: parseInt(id),
      name: evt?.name ?? `Event #${id}`,
      type: evt?.type ?? "other",
      startDate: evt?.startDate ?? "",
      endDate: evt?.endDate ?? null,
      totalUsd: usd,
      totalIls: eventExpensesILS[id] ?? 0,
      txCount: eventTxCounts[id] ?? 0,
    };
  }).sort((a, b) => b.totalUsd - a.totalUsd);

  const monthlyTrend = Object.entries(monthlyData)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, data]) => ({
      month,
      income: data.income,
      expenses: data.expenses,
      recurring: data.recurring,
      nonRecurring: data.nonRecurring,
      incomeILS: data.incomeILS,
      expensesILS: data.expensesILS,
      usdFromILS: data.usdFromILS,
    }));

  return NextResponse.json({
    totalIncome,
    totalExpenses,
    totalSaved,
    savingsRate,
    totalIncomeILS,
    totalExpensesILS,
    totalSavedILS,
    weightedExchangeRate,
    incomeBySourceILS,
    expensesByCategory,
    expensesByCategoryILS,
    expensesByOwner,
    incomeBySource,
    incomeByOwner,
    eventExpenses,
    eventExpensesILS,
    normalExpenses,
    normalExpensesILS,
    recurringExpenses,
    nonRecurringExpenses,
    monthlyTrend,
    topMerchantsByCategory,
    merchantCountByCategory,
    txCountByCategory,
    recurringByCategory,
    nonRecurringByCategory,
    recurringMerchants,
    nonRecurringTopMerchants,
    eventDetails,
    topExpenseTransactions,
  });
}
