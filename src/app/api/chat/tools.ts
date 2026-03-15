import { db } from "@/db";
import {
  transactions,
  accounts,
  manualIncomeEntries,
  events,
  netWorthSnapshots,
  goals,
  goalAchievements,
  merchantCategories,
} from "@/db/schema";
import { eq, and, gte, lte, sql, isNull, desc, asc } from "drizzle-orm";
import { getExchangeRatesForDates } from "@/lib/exchange";
import type { ChatCompletionTool } from "openai/resources/chat/completions";

// ── Tool definitions for OpenAI function calling ──

export const toolDefinitions: ChatCompletionTool[] = [
  {
    type: "function",
    function: {
      name: "query_transactions",
      description:
        "Search, filter, and aggregate transactions. Use aggregation modes to get summaries instead of raw rows. Expenses are negative amounts, income is positive. Excluded transactions are hidden by default.",
      parameters: {
        type: "object",
        properties: {
          startDate: { type: "string", description: "Start date (YYYY-MM-DD)" },
          endDate: { type: "string", description: "End date (YYYY-MM-DD)" },
          category: { type: "string", description: "Filter by category name" },
          accountId: { type: "number", description: "Filter by account ID" },
          owner: { type: "string", description: "Filter by account owner name" },
          description: {
            type: "string",
            description: "Search description (case-insensitive substring match)",
          },
          isRecurring: { type: "boolean", description: "Filter recurring (true) or non-recurring (false)" },
          includeExcluded: {
            type: "boolean",
            description: "Include excluded transactions (default false)",
          },
          limit: { type: "number", description: "Max rows to return (default 20)" },
          sortBy: {
            type: "string",
            enum: ["date", "amount"],
            description: "Sort field (default date)",
          },
          sortDir: {
            type: "string",
            enum: ["asc", "desc"],
            description: "Sort direction (default desc)",
          },
          aggregation: {
            type: "string",
            enum: [
              "none",
              "sum",
              "count",
              "group_by_category",
              "group_by_month",
              "group_by_description",
            ],
            description:
              "Aggregation mode. 'none' returns individual transactions. Others return summaries.",
          },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_spending_by_category",
      description:
        "Get expense breakdown by category for a date range, with USD and ILS totals. Only includes non-excluded expense transactions.",
      parameters: {
        type: "object",
        properties: {
          startDate: { type: "string", description: "Start date (YYYY-MM-DD)" },
          endDate: { type: "string", description: "End date (YYYY-MM-DD)" },
          owner: { type: "string", description: "Filter by account owner" },
        },
        required: ["startDate", "endDate"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_monthly_trend",
      description:
        "Get monthly income and expense totals over a date range. Includes manual income (salary, RSU, ESPP, pension, etc.) and transaction-based income/expenses.",
      parameters: {
        type: "object",
        properties: {
          startDate: { type: "string", description: "Start date (YYYY-MM-DD)" },
          endDate: { type: "string", description: "End date (YYYY-MM-DD)" },
          owner: { type: "string", description: "Filter by account owner" },
        },
        required: ["startDate", "endDate"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_accounts",
      description: "List all financial accounts with their institution, type, currency, and owner.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "get_income_entries",
      description:
        "Get manual income entries (salary, RSU, ESPP, pension, keren_hishtalmut). Each entry has a source, monthly amount, currency, start date (YYYY-MM), and owner.",
      parameters: {
        type: "object",
        properties: {
          owner: { type: "string", description: "Filter by owner" },
          source: { type: "string", description: "Filter by source (salary, rsu, espp, pension, keren_hishtalmut, other)" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_events",
      description:
        "Get trips and events with their total spending. Each event/trip includes destination, category breakdown, and per-day average spending in USD.",
      parameters: {
        type: "object",
        properties: {
          startDate: { type: "string", description: "Filter events starting after this date" },
          endDate: { type: "string", description: "Filter events starting before this date" },
          type: { type: "string", description: "Filter by event type (e.g. 'trip')" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_top_merchants",
      description:
        "Get top merchants/descriptions by total spending for a date range.",
      parameters: {
        type: "object",
        properties: {
          startDate: { type: "string", description: "Start date (YYYY-MM-DD)" },
          endDate: { type: "string", description: "End date (YYYY-MM-DD)" },
          category: { type: "string", description: "Filter by category" },
          isRecurring: { type: "boolean", description: "Filter recurring only" },
          limit: { type: "number", description: "Max results (default 20)" },
        },
        required: ["startDate", "endDate"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_net_worth_history",
      description: "Get net worth snapshots over time, optionally filtered by account.",
      parameters: {
        type: "object",
        properties: {
          accountId: { type: "number", description: "Filter by account ID" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_financial_summary",
      description:
        "Get a comprehensive financial overview for a date range. Returns totals, top categories, monthly trend, top recurring and one-time expenses, events, and income breakdown. Use this as the FIRST tool for broad questions like 'give me insights', 'how are my finances', or 'point out anything interesting'.",
      parameters: {
        type: "object",
        properties: {
          startDate: {
            type: "string",
            description: "Start date (YYYY-MM-DD). Defaults to Jan 1 of current year.",
          },
          endDate: {
            type: "string",
            description: "End date (YYYY-MM-DD). Defaults to Dec 31 of current year.",
          },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_goals",
      description:
        "Get financial goals (budget caps, savings targets, savings amounts). Returns goal config, streak count, and recent achievement history. Use this to understand what goals exist and how they are performing.",
      parameters: {
        type: "object",
        properties: {
          type: {
            type: "string",
            enum: ["budget_cap", "savings_target", "savings_amount"],
            description: "Filter by goal type",
          },
          category: { type: "string", description: "Filter by category (e.g. 'Food & Groceries')" },
          owner: { type: "string", description: "Filter by owner" },
          activeOnly: {
            type: "boolean",
            description: "Only return active goals (default true)",
          },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_goal_achievements",
      description:
        "Get goal achievement history — whether goals were met or missed in each period, with actual vs target amounts. Use this to analyze goal performance over time. Periods are formatted as 'YYYY-MM' for monthly goals and 'YYYY' for annual goals.",
      parameters: {
        type: "object",
        properties: {
          goalId: { type: "number", description: "Filter to a specific goal by ID" },
          goalName: { type: "string", description: "Filter by goal name (case-insensitive substring match)" },
          startPeriod: { type: "string", description: "Start period (e.g. '2025-01' or '2025')" },
          endPeriod: { type: "string", description: "End period" },
          achievedOnly: { type: "boolean", description: "Filter to achieved (true) or missed (false) only" },
          limit: { type: "number", description: "Max results (default 20)" },
        },
      },
    },
  },
];

// ── Helper: convert ILS amounts to USD ──

async function convertToUSD(
  rows: Array<{ date: string; amount: number; currency: string }>
): Promise<Array<{ date: string; amount: number; currency: string; amountUSD: number }>> {
  const ilsDates = rows.filter((r) => r.currency === "ILS").map((r) => r.date);
  const rates =
    ilsDates.length > 0
      ? await getExchangeRatesForDates(ilsDates, "ILS", "USD")
      : new Map<string, number>();

  return rows.map((r) => ({
    ...r,
    amountUSD:
      r.currency === "ILS"
        ? r.amount * (rates.get(r.date) ?? 0.27)
        : r.amount,
  }));
}

// ── Helper: get account lookup map ──

async function getAccountMap() {
  const accts = await db.select().from(accounts);
  const map: Record<number, (typeof accts)[0]> = {};
  for (const a of accts) map[a.id] = a;
  return { accts, map };
}

// ── Tool executors ──

type ToolParams = Record<string, unknown>;

export async function executeTool(
  name: string,
  params: ToolParams
): Promise<unknown> {
  switch (name) {
    case "query_transactions":
      return queryTransactions(params);
    case "get_spending_by_category":
      return getSpendingByCategory(params);
    case "get_monthly_trend":
      return getMonthlyTrend(params);
    case "get_accounts":
      return getAccounts();
    case "get_income_entries":
      return getIncomeEntries(params);
    case "get_events":
      return getEvents(params);
    case "get_top_merchants":
      return getTopMerchants(params);
    case "get_net_worth_history":
      return getNetWorthHistory(params);
    case "get_financial_summary":
      return getFinancialSummary(params);
    case "get_goals":
      return getGoals(params);
    case "get_goal_achievements":
      return getGoalAchievements(params);
    default:
      return { error: `Unknown tool: ${name}` };
  }
}

async function queryTransactions(params: ToolParams) {
  const {
    startDate,
    endDate,
    category,
    accountId,
    owner,
    description,
    isRecurring,
    includeExcluded,
    limit = 20,
    sortBy = "date",
    sortDir = "desc",
    aggregation = "none",
  } = params as {
    startDate?: string;
    endDate?: string;
    category?: string;
    accountId?: number;
    owner?: string;
    description?: string;
    isRecurring?: boolean;
    includeExcluded?: boolean;
    limit?: number;
    sortBy?: string;
    sortDir?: string;
    aggregation?: string;
  };

  const { map: accountMap } = await getAccountMap();

  // Build conditions
  const conditions = [];
  if (!includeExcluded) conditions.push(eq(transactions.excluded, 0));
  if (startDate) conditions.push(gte(transactions.date, startDate));
  if (endDate) conditions.push(lte(transactions.date, endDate));
  if (category) conditions.push(eq(transactions.category, category));
  if (accountId) conditions.push(eq(transactions.accountId, accountId));
  if (isRecurring !== undefined)
    conditions.push(eq(transactions.isRecurring, isRecurring ? 1 : 0));
  if (description)
    conditions.push(
      sql`lower(${transactions.description}) like ${`%${description.toLowerCase()}%`}`
    );

  // Owner filter requires account lookup
  let ownerAccountIds: number[] | null = null;
  if (owner) {
    ownerAccountIds = Object.values(accountMap)
      .filter((a) => a.owner.toLowerCase() === owner.toLowerCase())
      .map((a) => a.id);
    if (ownerAccountIds.length > 0) {
      conditions.push(
        sql`${transactions.accountId} IN (${sql.join(
          ownerAccountIds.map((id) => sql`${id}`),
          sql`, `
        )})`
      );
    } else {
      return { rows: [], totalCount: 0, message: `No accounts found for owner "${owner}"` };
    }
  }

  const where = conditions.length > 0 ? and(...conditions) : undefined;

  // Aggregation modes
  if (aggregation === "sum") {
    const result = await db
      .select({
        totalAmount: sql<string>`sum(amount::numeric)`,
        count: sql<number>`count(*)`,
      })
      .from(transactions)
      .where(where);
    return { total: parseFloat(result[0].totalAmount ?? "0"), count: Number(result[0].count) };
  }

  if (aggregation === "count") {
    const result = await db
      .select({ count: sql<number>`count(*)` })
      .from(transactions)
      .where(where);
    return { count: Number(result[0].count) };
  }

  if (aggregation === "group_by_category") {
    const rows = await db
      .select({
        category: transactions.category,
        total: sql<string>`sum(amount::numeric)`,
        count: sql<number>`count(*)`,
      })
      .from(transactions)
      .where(where)
      .groupBy(transactions.category)
      .orderBy(sql`sum(amount::numeric) asc`);
    return rows.map((r) => ({
      category: r.category ?? "Uncategorized",
      total: parseFloat(r.total),
      count: Number(r.count),
    }));
  }

  if (aggregation === "group_by_month") {
    const rows = await db
      .select({
        month: sql<string>`to_char(date::date, 'YYYY-MM')`,
        total: sql<string>`sum(amount::numeric)`,
        count: sql<number>`count(*)`,
      })
      .from(transactions)
      .where(where)
      .groupBy(sql`to_char(date::date, 'YYYY-MM')`)
      .orderBy(sql`to_char(date::date, 'YYYY-MM')`);
    return rows.map((r) => ({
      month: r.month,
      total: parseFloat(r.total),
      count: Number(r.count),
    }));
  }

  if (aggregation === "group_by_description") {
    const rows = await db
      .select({
        description: sql<string>`lower(trim(description))`,
        total: sql<string>`sum(amount::numeric)`,
        count: sql<number>`count(*)`,
      })
      .from(transactions)
      .where(where)
      .groupBy(sql`lower(trim(description))`)
      .orderBy(sql`sum(amount::numeric) asc`)
      .limit(Math.min(limit as number, 50));
    return rows.map((r) => ({
      description: r.description,
      total: parseFloat(r.total),
      count: Number(r.count),
    }));
  }

  // Default: return individual rows
  const orderCol = sortBy === "amount" ? sql`amount::numeric` : transactions.date;
  const orderDir = sortDir === "asc" ? asc(orderCol) : desc(orderCol);

  const countResult = await db
    .select({ count: sql<number>`count(*)` })
    .from(transactions)
    .where(where);
  const totalCount = Number(countResult[0].count);

  const rows = await db
    .select({
      id: transactions.id,
      date: transactions.date,
      amount: transactions.amount,
      currency: transactions.currency,
      description: transactions.description,
      category: transactions.category,
      accountId: transactions.accountId,
      isRecurring: transactions.isRecurring,
      eventId: transactions.eventId,
      note: transactions.note,
    })
    .from(transactions)
    .where(where)
    .orderBy(orderDir)
    .limit(Math.min(limit as number, 50));

  const withUSD = await convertToUSD(
    rows.map((r) => ({
      date: r.date,
      amount: parseFloat(r.amount),
      currency: r.currency,
    }))
  );

  return {
    totalCount,
    rows: rows.map((r, i) => ({
      id: r.id,
      date: r.date,
      description: r.description,
      note: r.note ?? undefined,
      amount: parseFloat(r.amount),
      currency: r.currency,
      amountUSD: withUSD[i].amountUSD,
      category: r.category ?? "Uncategorized",
      account: accountMap[r.accountId]?.name ?? "Unknown",
      owner: accountMap[r.accountId]?.owner ?? "Unknown",
      isRecurring: r.isRecurring === 1,
    })),
  };
}

async function getSpendingByCategory(params: ToolParams) {
  const { startDate, endDate, owner } = params as {
    startDate: string;
    endDate: string;
    owner?: string;
  };

  const { map: accountMap } = await getAccountMap();

  const conditions = [
    eq(transactions.excluded, 0),
    gte(transactions.date, startDate),
    lte(transactions.date, endDate),
    sql`amount::numeric < 0`,
  ];

  if (owner) {
    const ids = Object.values(accountMap)
      .filter((a) => a.owner.toLowerCase() === owner.toLowerCase())
      .map((a) => a.id);
    if (ids.length > 0) {
      conditions.push(
        sql`${transactions.accountId} IN (${sql.join(
          ids.map((id) => sql`${id}`),
          sql`, `
        )})`
      );
    }
  }

  const rows = await db
    .select({
      category: transactions.category,
      total: sql<string>`sum(amount::numeric)`,
      count: sql<number>`count(*)`,
      currency: transactions.currency,
    })
    .from(transactions)
    .where(and(...conditions))
    .groupBy(transactions.category, transactions.currency);

  // Aggregate by category with currency conversion
  const byCategory: Record<string, { totalUSD: number; totalILS: number; count: number }> = {};

  const ilsRows = rows.filter((r) => r.currency === "ILS");
  const midDate = startDate.substring(0, 7) + "-15";
  const rates =
    ilsRows.length > 0
      ? await getExchangeRatesForDates([midDate], "ILS", "USD")
      : new Map<string, number>();
  const rate = rates.get(midDate) ?? 0.27;

  for (const row of rows) {
    const cat = row.category ?? "Uncategorized";
    if (!byCategory[cat]) byCategory[cat] = { totalUSD: 0, totalILS: 0, count: 0 };
    const abs = Math.abs(parseFloat(row.total));
    byCategory[cat].count += Number(row.count);
    if (row.currency === "ILS") {
      byCategory[cat].totalILS += abs;
      byCategory[cat].totalUSD += abs * rate;
    } else {
      byCategory[cat].totalUSD += abs;
    }
  }

  return Object.entries(byCategory)
    .map(([category, data]) => ({ category, ...data }))
    .sort((a, b) => b.totalUSD - a.totalUSD);
}

async function getMonthlyTrend(params: ToolParams) {
  const { startDate, endDate, owner } = params as {
    startDate: string;
    endDate: string;
    owner?: string;
  };

  const { map: accountMap } = await getAccountMap();

  // Transaction-based monthly data
  const conditions = [
    eq(transactions.excluded, 0),
    gte(transactions.date, startDate),
    lte(transactions.date, endDate),
  ];

  if (owner) {
    const ids = Object.values(accountMap)
      .filter((a) => a.owner.toLowerCase() === owner.toLowerCase())
      .map((a) => a.id);
    if (ids.length > 0) {
      conditions.push(
        sql`${transactions.accountId} IN (${sql.join(
          ids.map((id) => sql`${id}`),
          sql`, `
        )})`
      );
    }
  }

  const txRows = await db
    .select({
      month: sql<string>`to_char(date::date, 'YYYY-MM')`,
      income: sql<string>`sum(CASE WHEN amount::numeric > 0 THEN amount::numeric ELSE 0 END)`,
      expenses: sql<string>`sum(CASE WHEN amount::numeric < 0 THEN abs(amount::numeric) ELSE 0 END)`,
    })
    .from(transactions)
    .where(and(...conditions))
    .groupBy(sql`to_char(date::date, 'YYYY-MM')`)
    .orderBy(sql`to_char(date::date, 'YYYY-MM')`);

  const monthly: Record<string, { income: number; expenses: number; manualIncome: number }> = {};
  for (const r of txRows) {
    monthly[r.month] = {
      income: parseFloat(r.income ?? "0"),
      expenses: parseFloat(r.expenses ?? "0"),
      manualIncome: 0,
    };
  }

  // Add manual income
  const incomeEntries = await db.select().from(manualIncomeEntries);
  const rangeStart = new Date(startDate);
  const rangeEnd = new Date(Math.min(new Date(endDate).getTime(), Date.now()));

  // Get a mid-range rate for ILS conversion
  const midDate = startDate.substring(0, 7) + "-15";
  const rates = await getExchangeRatesForDates([midDate], "ILS", "USD");
  const rate = rates.get(midDate) ?? 0.27;

  const groups: Record<string, typeof incomeEntries> = {};
  for (const entry of incomeEntries) {
    if (owner && entry.owner.toLowerCase() !== owner.toLowerCase()) continue;
    const key = `${entry.source}-${entry.owner}`;
    if (!groups[key]) groups[key] = [];
    groups[key].push(entry);
  }

  for (const entries of Object.values(groups)) {
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
        if (!monthly[monthStr])
          monthly[monthStr] = { income: 0, expenses: 0, manualIncome: 0 };
        let amount = parseFloat(applicable.monthlyAmount);
        if (applicable.currency === "ILS") amount *= rate;
        monthly[monthStr].manualIncome += amount;
      }
    }
  }

  return Object.entries(monthly)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, data]) => ({
      month,
      transactionIncome: Math.round(data.income),
      manualIncome: Math.round(data.manualIncome),
      totalIncome: Math.round(data.income + data.manualIncome),
      expenses: Math.round(data.expenses),
      savings: Math.round(data.income + data.manualIncome - data.expenses),
    }));
}

async function getAccounts() {
  const accts = await db.select().from(accounts);
  return accts.map((a) => ({
    id: a.id,
    name: a.name,
    type: a.type,
    institution: a.institution,
    currency: a.currency,
    owner: a.owner,
  }));
}

async function getIncomeEntries(params: ToolParams) {
  const { owner, source } = params as { owner?: string; source?: string };
  const conditions = [];
  if (owner)
    conditions.push(
      sql`lower(${manualIncomeEntries.owner}) = ${owner.toLowerCase()}`
    );
  if (source)
    conditions.push(
      sql`${manualIncomeEntries.source} = ${source}`
    );

  const rows = await db
    .select()
    .from(manualIncomeEntries)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(manualIncomeEntries.source, manualIncomeEntries.startDate);

  return rows.map((r) => ({
    id: r.id,
    source: r.source,
    label: r.label,
    monthlyAmount: parseFloat(r.monthlyAmount),
    currency: r.currency,
    startDate: r.startDate,
    owner: r.owner,
  }));
}

async function getEvents(params: ToolParams) {
  const { startDate, endDate, type } = params as { startDate?: string; endDate?: string; type?: string };
  const conditions = [];
  if (startDate) conditions.push(gte(events.startDate, startDate));
  if (endDate) conditions.push(lte(events.startDate, endDate));
  if (type) conditions.push(sql`${events.type} = ${type}`);

  const evts = await db
    .select()
    .from(events)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(events.startDate));

  // Get spending per event
  const eventIds = evts.map((e) => e.id);
  if (eventIds.length === 0) return [];

  // Get per-event, per-category, per-currency spending
  const spending = await db
    .select({
      eventId: transactions.eventId,
      category: transactions.category,
      total: sql<string>`sum(abs(amount::numeric))`,
      count: sql<number>`count(*)`,
      currency: transactions.currency,
    })
    .from(transactions)
    .where(
      and(
        sql`${transactions.eventId} IN (${sql.join(
          eventIds.map((id) => sql`${id}`),
          sql`, `
        )})`,
        eq(transactions.excluded, 0)
      )
    )
    .groupBy(transactions.eventId, transactions.category, transactions.currency);

  // Get exchange rates for ILS conversion
  const ilsDates = spending.filter((s) => s.currency === "ILS").map(() => evts[0]?.startDate ?? "");
  const midDates = evts.map((e) => e.startDate);
  const rates = await getExchangeRatesForDates(midDates, "ILS", "USD");
  const fallbackRate = rates.values().next().value ?? 0.27;

  const spendMap: Record<number, { usd: number; ils: number; count: number; categories: Record<string, number> }> = {};
  for (const s of spending) {
    const eid = s.eventId!;
    if (!spendMap[eid]) spendMap[eid] = { usd: 0, ils: 0, count: 0, categories: {} };
    const amount = parseFloat(s.total);
    spendMap[eid].count += Number(s.count);
    const cat = s.category ?? "Uncategorized";
    if (s.currency === "ILS") {
      spendMap[eid].ils += amount;
      const usdEquiv = amount * (rates.get(evts.find((e) => e.id === eid)?.startDate ?? "") ?? fallbackRate);
      spendMap[eid].categories[cat] = (spendMap[eid].categories[cat] ?? 0) + usdEquiv;
    } else {
      spendMap[eid].usd += amount;
      spendMap[eid].categories[cat] = (spendMap[eid].categories[cat] ?? 0) + amount;
    }
  }

  return evts.map((e) => {
    const data = spendMap[e.id];
    const totalUSD = (data?.usd ?? 0) + (data?.ils ?? 0) * (rates.get(e.startDate) ?? fallbackRate);
    const days = e.endDate
      ? Math.max(1, Math.ceil((new Date(e.endDate).getTime() - new Date(e.startDate).getTime()) / 86400000) + 1)
      : 1;
    return {
      id: e.id,
      name: e.name,
      type: e.type,
      startDate: e.startDate,
      endDate: e.endDate,
      destination: e.destination ?? null,
      totalUSD: Math.round(totalUSD),
      totalILS: Math.round(data?.ils ?? 0),
      txCount: data?.count ?? 0,
      perDayAvgUSD: Math.round(totalUSD / days),
      categoryBreakdown: Object.fromEntries(
        Object.entries(data?.categories ?? {})
          .sort(([, a], [, b]) => b - a)
          .map(([k, v]) => [k, Math.round(v)])
      ),
    };
  });
}

async function getTopMerchants(params: ToolParams) {
  const { startDate, endDate, category, isRecurring, limit = 20 } = params as {
    startDate: string;
    endDate: string;
    category?: string;
    isRecurring?: boolean;
    limit?: number;
  };

  const conditions = [
    eq(transactions.excluded, 0),
    gte(transactions.date, startDate),
    lte(transactions.date, endDate),
    sql`amount::numeric < 0`,
  ];
  if (category) conditions.push(eq(transactions.category, category));
  if (isRecurring !== undefined)
    conditions.push(eq(transactions.isRecurring, isRecurring ? 1 : 0));

  const rows = await db
    .select({
      description: sql<string>`lower(trim(description))`,
      total: sql<string>`sum(abs(amount::numeric))`,
      count: sql<number>`count(*)`,
      category: transactions.category,
    })
    .from(transactions)
    .where(and(...conditions))
    .groupBy(sql`lower(trim(description))`, transactions.category)
    .orderBy(sql`sum(abs(amount::numeric)) desc`)
    .limit(Math.min(limit, 50));

  // Load display names for consolidation
  const dnRows = await db
    .select({ merchantName: merchantCategories.merchantName, displayName: merchantCategories.displayName })
    .from(merchantCategories)
    .where(sql`${merchantCategories.displayName} IS NOT NULL`);
  const dnMap = new Map(dnRows.map((r) => [r.merchantName, r.displayName!]));

  // Consolidate by display name
  const consolidated = new Map<string, { displayName: string | null; total: number; count: number; category: string }>();
  for (const r of rows) {
    const dn = dnMap.get(r.description);
    const key = dn ?? r.description;
    const existing = consolidated.get(key);
    if (existing) {
      existing.total += parseFloat(r.total);
      existing.count += Number(r.count);
    } else {
      consolidated.set(key, {
        displayName: dn ?? null,
        total: parseFloat(r.total),
        count: Number(r.count),
        category: r.category ?? "Uncategorized",
      });
    }
  }

  return [...consolidated.entries()]
    .sort(([, a], [, b]) => b.total - a.total)
    .slice(0, Math.min(limit, 50))
    .map(([name, d]) => ({
      description: name,
      displayName: d.displayName,
      total: d.total,
      count: d.count,
      category: d.category,
    }));
}

async function getNetWorthHistory(params: ToolParams) {
  const { accountId } = params as { accountId?: number };
  const { map: accountMap } = await getAccountMap();

  const conditions = [];
  if (accountId) conditions.push(eq(netWorthSnapshots.accountId, accountId));

  const rows = await db
    .select()
    .from(netWorthSnapshots)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(netWorthSnapshots.snapshotDate));

  return rows.map((r) => ({
    date: r.snapshotDate,
    account: accountMap[r.accountId]?.name ?? "Unknown",
    owner: accountMap[r.accountId]?.owner ?? "Unknown",
    balance: parseFloat(r.balance),
    currency: r.currency,
  }));
}

async function getFinancialSummary(params: ToolParams) {
  const now = new Date();
  const year = now.getFullYear();
  const {
    startDate = `${year}-01-01`,
    endDate = `${year}-12-31`,
  } = params as { startDate?: string; endDate?: string };

  const { map: accountMap } = await getAccountMap();

  // Get a mid-range rate for ILS conversion
  const midDate = startDate.substring(0, 7) + "-15";
  const rates = await getExchangeRatesForDates([midDate], "ILS", "USD");
  const ilsToUsd = rates.get(midDate) ?? 0.27;

  // ── 1. Transaction totals by category ──
  const catRows = await db
    .select({
      category: transactions.category,
      currency: transactions.currency,
      totalExpense: sql<string>`sum(CASE WHEN amount::numeric < 0 THEN abs(amount::numeric) ELSE 0 END)`,
      totalIncome: sql<string>`sum(CASE WHEN amount::numeric > 0 THEN amount::numeric ELSE 0 END)`,
      count: sql<number>`count(*)`,
    })
    .from(transactions)
    .where(
      and(
        eq(transactions.excluded, 0),
        gte(transactions.date, startDate),
        lte(transactions.date, endDate)
      )
    )
    .groupBy(transactions.category, transactions.currency);

  let totalExpensesUSD = 0;
  let totalTxIncomeUSD = 0;
  const byCat: Record<string, { usd: number; count: number }> = {};

  for (const r of catRows) {
    const exp = parseFloat(r.totalExpense ?? "0");
    const inc = parseFloat(r.totalIncome ?? "0");
    const mult = r.currency === "ILS" ? ilsToUsd : 1;
    totalExpensesUSD += exp * mult;
    totalTxIncomeUSD += inc * mult;
    const cat = r.category ?? "Uncategorized";
    if (!byCat[cat]) byCat[cat] = { usd: 0, count: 0 };
    byCat[cat].usd += exp * mult;
    byCat[cat].count += Number(r.count);
  }

  const topCategories = Object.entries(byCat)
    .map(([category, d]) => ({ category, totalUSD: Math.round(d.usd), txCount: d.count }))
    .sort((a, b) => b.totalUSD - a.totalUSD)
    .slice(0, 8);

  // ── 2. Manual income ──
  const incomeEntries = await db.select().from(manualIncomeEntries);
  let totalManualIncomeUSD = 0;
  const incomeBySource: Record<string, number> = {};
  const rangeStart = new Date(startDate);
  const rangeEnd = new Date(Math.min(new Date(endDate).getTime(), Date.now()));

  const incGroups: Record<string, typeof incomeEntries> = {};
  for (const entry of incomeEntries) {
    const key = `${entry.source}-${entry.owner}`;
    if (!incGroups[key]) incGroups[key] = [];
    incGroups[key].push(entry);
  }

  for (const entries of Object.values(incGroups)) {
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
        if (applicable.currency === "ILS") amount *= ilsToUsd;
        totalManualIncomeUSD += amount;
        incomeBySource[applicable.source] =
          (incomeBySource[applicable.source] ?? 0) + amount;
      }
    }
  }

  const totalIncomeUSD = totalManualIncomeUSD + totalTxIncomeUSD;
  const totalSavedUSD = totalIncomeUSD - totalExpensesUSD;
  const savingsRate = totalIncomeUSD > 0 ? (totalSavedUSD / totalIncomeUSD) * 100 : 0;

  // ── 3. Monthly trend (condensed) ──
  const monthlyRows = await db
    .select({
      month: sql<string>`to_char(date::date, 'YYYY-MM')`,
      expenses: sql<string>`sum(CASE WHEN amount::numeric < 0 THEN abs(amount::numeric) ELSE 0 END)`,
      income: sql<string>`sum(CASE WHEN amount::numeric > 0 THEN amount::numeric ELSE 0 END)`,
      currency: transactions.currency,
    })
    .from(transactions)
    .where(
      and(
        eq(transactions.excluded, 0),
        gte(transactions.date, startDate),
        lte(transactions.date, endDate)
      )
    )
    .groupBy(sql`to_char(date::date, 'YYYY-MM')`, transactions.currency)
    .orderBy(sql`to_char(date::date, 'YYYY-MM')`);

  const monthlyMap: Record<string, { income: number; expenses: number }> = {};
  for (const r of monthlyRows) {
    const mult = r.currency === "ILS" ? ilsToUsd : 1;
    if (!monthlyMap[r.month]) monthlyMap[r.month] = { income: 0, expenses: 0 };
    monthlyMap[r.month].expenses += parseFloat(r.expenses ?? "0") * mult;
    monthlyMap[r.month].income += parseFloat(r.income ?? "0") * mult;
  }

  const monthlyTrend = Object.entries(monthlyMap)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, d]) => ({
      month,
      income: Math.round(d.income),
      expenses: Math.round(d.expenses),
      savings: Math.round(d.income - d.expenses),
    }));

  // ── 4. Top recurring merchants ──
  const recurringRows = await db
    .select({
      description: sql<string>`lower(trim(description))`,
      total: sql<string>`sum(abs(amount::numeric))`,
      count: sql<number>`count(*)`,
      category: transactions.category,
    })
    .from(transactions)
    .where(
      and(
        eq(transactions.excluded, 0),
        eq(transactions.isRecurring, 1),
        gte(transactions.date, startDate),
        lte(transactions.date, endDate),
        sql`amount::numeric < 0`
      )
    )
    .groupBy(sql`lower(trim(description))`, transactions.category)
    .orderBy(sql`sum(abs(amount::numeric)) desc`)
    .limit(10);

  const topRecurring = recurringRows.map((r) => ({
    description: r.description,
    total: Math.round(parseFloat(r.total)),
    count: Number(r.count),
    category: r.category ?? "Uncategorized",
  }));

  // ── 5. Top one-time expenses ──
  const bigExpenses = await db
    .select({
      date: transactions.date,
      description: transactions.description,
      amount: transactions.amount,
      currency: transactions.currency,
      category: transactions.category,
      accountId: transactions.accountId,
    })
    .from(transactions)
    .where(
      and(
        eq(transactions.excluded, 0),
        eq(transactions.isRecurring, 0),
        gte(transactions.date, startDate),
        lte(transactions.date, endDate),
        sql`amount::numeric < 0`
      )
    )
    .orderBy(sql`amount::numeric asc`)
    .limit(10);

  const topOneTimeExpenses = bigExpenses.map((r) => {
    const raw = parseFloat(r.amount);
    const usd = r.currency === "ILS" ? Math.abs(raw) * ilsToUsd : Math.abs(raw);
    return {
      date: r.date,
      description: r.description,
      amount: raw,
      currency: r.currency,
      amountUSD: Math.round(usd),
      category: r.category ?? "Uncategorized",
      owner: accountMap[r.accountId]?.owner ?? "Unknown",
    };
  });

  // ── 6. Events ──
  const evts = await db
    .select()
    .from(events)
    .where(
      and(gte(events.startDate, startDate), lte(events.startDate, endDate))
    );

  const eventIds = evts.map((e) => e.id);
  let eventSummaries: Array<{ name: string; type: string; destination: string | null; totalUSD: number }> = [];
  if (eventIds.length > 0) {
    const evtSpending = await db
      .select({
        eventId: transactions.eventId,
        total: sql<string>`sum(abs(amount::numeric))`,
        currency: transactions.currency,
      })
      .from(transactions)
      .where(
        and(
          sql`${transactions.eventId} IN (${sql.join(
            eventIds.map((id) => sql`${id}`),
            sql`, `
          )})`,
          eq(transactions.excluded, 0)
        )
      )
      .groupBy(transactions.eventId, transactions.currency);

    const evtMap: Record<number, number> = {};
    for (const s of evtSpending) {
      const eid = s.eventId!;
      const mult = s.currency === "ILS" ? ilsToUsd : 1;
      evtMap[eid] = (evtMap[eid] ?? 0) + parseFloat(s.total) * mult;
    }

    eventSummaries = evts.map((e) => ({
      name: e.name,
      type: e.type,
      destination: e.destination ?? null,
      totalUSD: Math.round(evtMap[e.id] ?? 0),
    }));
  }

  // ── 7. Account owners ──
  const owners = [...new Set(Object.values(accountMap).map((a) => a.owner))];

  return {
    period: { startDate, endDate },
    totals: {
      incomeUSD: Math.round(totalIncomeUSD),
      expensesUSD: Math.round(totalExpensesUSD),
      savedUSD: Math.round(totalSavedUSD),
      savingsRate: Math.round(savingsRate * 10) / 10,
    },
    incomeBySource: Object.fromEntries(
      Object.entries(incomeBySource).map(([k, v]) => [k, Math.round(v)])
    ),
    transactionIncome: Math.round(totalTxIncomeUSD),
    topCategories,
    monthlyTrend,
    topRecurringExpenses: topRecurring,
    topOneTimeExpenses,
    events: eventSummaries,
    owners,
  };
}

async function getGoals(params: ToolParams) {
  const {
    type,
    category,
    owner,
    activeOnly = true,
  } = params as {
    type?: string;
    category?: string;
    owner?: string;
    activeOnly?: boolean;
  };

  const conditions = [];
  if (activeOnly) conditions.push(eq(goals.isActive, 1));
  if (type) conditions.push(sql`${goals.type} = ${type}`);
  if (category) conditions.push(sql`lower(${goals.category}) = ${category.toLowerCase()}`);
  if (owner) conditions.push(sql`lower(${goals.owner}) = ${owner.toLowerCase()}`);

  const allGoals = await db
    .select()
    .from(goals)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(goals.sortOrder, desc(goals.createdAt))
    .limit(20);

  const results = [];
  for (const goal of allGoals) {
    const achievements = await db
      .select()
      .from(goalAchievements)
      .where(eq(goalAchievements.goalId, goal.id))
      .orderBy(desc(goalAchievements.period));

    // Compute streak (consecutive achieved from most recent)
    let streak = 0;
    for (const a of achievements) {
      if (a.achieved === 1) streak++;
      else break;
    }

    const recentHistory = achievements.slice(0, 6).map((a) => ({
      period: a.period,
      achieved: a.achieved === 1,
      actualAmount: parseFloat(a.actualAmount),
    }));

    const targetAmt = parseFloat(goal.targetAmount);
    const monthlyTarget = goal.type === "savings_target" ? targetAmt : targetAmt / 12;

    results.push({
      id: goal.id,
      name: goal.name,
      type: goal.type,
      scope: goal.scope,
      category: goal.category,
      owner: goal.owner,
      targetAmount: targetAmt,
      monthlyTarget: Math.round(monthlyTarget * 100) / 100,
      currency: goal.currency,
      isActive: goal.isActive === 1,
      streak,
      recentHistory,
    });
  }

  return results;
}

async function getGoalAchievements(params: ToolParams) {
  const {
    goalId,
    goalName,
    startPeriod,
    endPeriod,
    achievedOnly,
    limit = 20,
  } = params as {
    goalId?: number;
    goalName?: string;
    startPeriod?: string;
    endPeriod?: string;
    achievedOnly?: boolean;
    limit?: number;
  };

  const conditions = [];
  if (goalId) conditions.push(eq(goalAchievements.goalId, goalId));
  if (startPeriod) conditions.push(gte(goalAchievements.period, startPeriod));
  if (endPeriod) conditions.push(lte(goalAchievements.period, endPeriod));
  if (achievedOnly === true) conditions.push(eq(goalAchievements.achieved, 1));
  if (achievedOnly === false) conditions.push(eq(goalAchievements.achieved, 0));
  if (goalName) {
    conditions.push(
      sql`${goalAchievements.goalId} IN (SELECT id FROM goals WHERE lower(name) LIKE ${`%${goalName.toLowerCase()}%`})`
    );
  }

  const rows = await db
    .select({
      id: goalAchievements.id,
      goalId: goalAchievements.goalId,
      period: goalAchievements.period,
      achieved: goalAchievements.achieved,
      actualAmount: goalAchievements.actualAmount,
      goalName: goals.name,
      goalType: goals.type,
      category: goals.category,
      targetAmount: goals.targetAmount,
      currency: goals.currency,
    })
    .from(goalAchievements)
    .innerJoin(goals, eq(goalAchievements.goalId, goals.id))
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(goalAchievements.period))
    .limit(Math.min(limit, 50));

  return rows.map((r) => {
    const actual = parseFloat(r.actualAmount);
    const target = parseFloat(r.targetAmount);
    // Positive variance = good. For budget_cap, under budget is good. For savings, over target is good.
    const variance = r.goalType === "budget_cap" ? target - actual : actual - target;

    return {
      goalId: r.goalId,
      goalName: r.goalName,
      goalType: r.goalType,
      category: r.category,
      period: r.period,
      achieved: r.achieved === 1,
      actualAmount: actual,
      targetAmount: target,
      currency: r.currency,
      variance: Math.round(variance * 100) / 100,
    };
  });
}
