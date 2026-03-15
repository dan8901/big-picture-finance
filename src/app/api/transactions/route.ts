import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { transactions, exclusionRules, merchantCategories, importLogs } from "@/db/schema";
import { eq, and, sql, desc, asc } from "drizzle-orm";
import { evaluateGoals } from "@/lib/evaluate-goals";

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const accountId = searchParams.get("accountId");
  const startDate = searchParams.get("startDate");
  const endDate = searchParams.get("endDate");
  const limit = parseInt(searchParams.get("limit") ?? "200");
  const offset = parseInt(searchParams.get("offset") ?? "0");
  const sortBy = searchParams.get("sortBy") ?? "date";
  const sortDir = searchParams.get("sortDir") ?? "desc";

  // When sorting by amount, convert ILS to USD using the exchange rate on the transaction date
  const orderCol = sortBy === "amount"
    ? sql`CASE WHEN ${transactions.currency} = 'ILS'
        THEN ${transactions.amount}::numeric * COALESCE(
          (SELECT rate::numeric FROM exchange_rates
           WHERE from_currency = 'ILS' AND to_currency = 'USD'
             AND date <= ${transactions.date}
           ORDER BY date DESC LIMIT 1), 1)
        ELSE ${transactions.amount}::numeric END`
    : transactions.date;
  const order = sortDir === "asc" ? asc(orderCol) : desc(orderCol);

  const conditions = [];
  if (accountId) {
    conditions.push(eq(transactions.accountId, parseInt(accountId)));
  }
  if (startDate) {
    conditions.push(sql`${transactions.date} >= ${startDate}`);
  }
  if (endDate) {
    conditions.push(sql`${transactions.date} <= ${endDate}`);
  }

  const where = conditions.length > 0 ? and(...conditions) : undefined;

  const [result, countResult] = await Promise.all([
    where
      ? db.select().from(transactions).where(where).orderBy(order).limit(limit).offset(offset)
      : db.select().from(transactions).orderBy(order).limit(limit).offset(offset),
    where
      ? db.select({ count: sql<number>`count(*)` }).from(transactions).where(where)
      : db.select({ count: sql<number>`count(*)` }).from(transactions),
  ]);

  return NextResponse.json({
    transactions: result,
    total: Number(countResult[0].count),
    limit,
    offset,
  });
}

export async function POST(request: NextRequest) {
  const body = await request.json();
  const { items, accountId } = body as {
    items: Array<{
      date: string;
      amount: number;
      currency: string;
      description: string;
      category?: string;
      sourceFile?: string;
      excluded?: boolean;
      originalCurrency?: string;
      originalAmount?: number;
    }>;
    accountId: number;
  };

  if (!items || !accountId) {
    return NextResponse.json(
      { error: "items and accountId are required" },
      { status: 400 }
    );
  }

  // Check for duplicates
  const existing = await db
    .select({
      date: transactions.date,
      amount: transactions.amount,
      description: transactions.description,
    })
    .from(transactions)
    .where(eq(transactions.accountId, accountId));

  const existingSet = new Set(
    existing.map(
      (e) =>
        `${e.date}|${parseFloat(e.amount).toFixed(2)}|${e.description.toLowerCase().trim()}`
    )
  );

  const newItems = items.filter((item) => {
    const key = `${item.date}|${Number(item.amount).toFixed(2)}|${item.description.toLowerCase().trim()}`;
    return !existingSet.has(key);
  });

  const skipped = items.length - newItems.length;

  if (newItems.length > 0) {
    // Load exclusion rules for this account
    const rules = await db
      .select({ description: exclusionRules.description })
      .from(exclusionRules)
      .where(eq(exclusionRules.accountId, accountId));
    const excludedDescriptions = new Set(rules.map((r) => r.description));

    // Load merchant category mappings
    const catRules = await db.select().from(merchantCategories);
    const categoryMap = new Map(
      catRules.map((r) => [r.merchantName.toLowerCase().trim(), r.category])
    );

    await db.insert(transactions).values(
      newItems.map((item) => {
        const key = item.description.toLowerCase().trim();
        const isExcludedByRule = excludedDescriptions.has(key);
        const savedCategory = categoryMap.get(key);
        return {
          accountId,
          date: item.date,
          amount: String(item.amount),
          currency: item.currency as "USD" | "ILS",
          originalCurrency: item.originalCurrency ?? null,
          originalAmount: item.originalAmount != null ? String(item.originalAmount) : null,
          description: item.description,
          category: item.category ?? savedCategory ?? null,
          sourceFile: item.sourceFile ?? null,
          excluded: item.excluded || isExcludedByRule ? 1 : 0,
        };
      })
    );
  }

  // Log the import
  await db.insert(importLogs).values({
    accountId,
    filename: body.filename ?? "unknown",
    parser: body.parser ?? "unknown",
    totalRows: items.length,
    importedRows: items.length - skipped,
    duplicateRows: skipped,
  });

  // Re-evaluate goals in background (new transactions may change achievements)
  if (newItems.length > 0) {
    evaluateGoals().catch(() => {});
  }

  return NextResponse.json({
    imported: newItems.length,
    skipped,
    total: items.length,
  });
}

// Check which transactions already exist (dedup check without importing)
export async function PUT(request: NextRequest) {
  const body = await request.json();
  const { items, accountId } = body as {
    items: Array<{ date: string; amount: number; description: string }>;
    accountId: number;
  };

  if (!items || !accountId) {
    return NextResponse.json(
      { error: "items and accountId are required" },
      { status: 400 }
    );
  }

  const existing = await db
    .select({
      date: transactions.date,
      amount: transactions.amount,
      description: transactions.description,
    })
    .from(transactions)
    .where(eq(transactions.accountId, accountId));

  const existingSet = new Set(
    existing.map(
      (e) =>
        `${e.date}|${parseFloat(e.amount).toFixed(2)}|${e.description.toLowerCase().trim()}`
    )
  );

  const duplicates = items.map((item) => {
    const key = `${item.date}|${Number(item.amount).toFixed(2)}|${item.description.toLowerCase().trim()}`;
    return existingSet.has(key);
  });

  const dupCount = duplicates.filter(Boolean).length;
  return NextResponse.json({ duplicates, dupCount, newCount: items.length - dupCount });
}

export async function DELETE(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id");

  if (!id) {
    return NextResponse.json({ error: "ID is required" }, { status: 400 });
  }

  await db.delete(transactions).where(eq(transactions.id, parseInt(id)));
  return NextResponse.json({ success: true });
}
