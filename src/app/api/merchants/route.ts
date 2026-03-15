import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { merchantCategories, transactions } from "@/db/schema";
import { eq, sql, inArray } from "drizzle-orm";

// GET: list all merchants with stats
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const mapOnly = searchParams.get("mapOnly") === "1";

  // Lightweight mode: just return displayName map
  if (mapOnly) {
    const rows = await db
      .select({
        merchantName: merchantCategories.merchantName,
        displayName: merchantCategories.displayName,
      })
      .from(merchantCategories)
      .where(sql`${merchantCategories.displayName} IS NOT NULL`);
    return NextResponse.json({ displayNames: Object.fromEntries(rows.map((r) => [r.merchantName, r.displayName!])) });
  }

  // Full mode: all merchants from both merchant_categories and transactions
  const mcRows = await db
    .select({
      id: merchantCategories.id,
      merchantName: merchantCategories.merchantName,
      displayName: merchantCategories.displayName,
      category: merchantCategories.category,
      isUserOverride: merchantCategories.isUserOverride,
    })
    .from(merchantCategories)
    .orderBy(merchantCategories.merchantName);

  const mcMap = new Map(mcRows.map((r) => [r.merchantName, r]));

  // Get all unique merchants from transactions with counts
  const txCounts = await db
    .select({
      description: sql<string>`lower(trim(${transactions.description}))`,
      count: sql<number>`count(*)`,
      totalAmount: sql<string>`sum(abs(${transactions.amount}::numeric))`,
      category: sql<string>`(array_agg(${transactions.category}) FILTER (WHERE ${transactions.category} IS NOT NULL))[1]`,
    })
    .from(transactions)
    .where(eq(transactions.excluded, 0))
    .groupBy(sql`lower(trim(${transactions.description}))`);

  // Merge: merchant_categories data + transaction stats
  const seen = new Set<string>();
  const merchants = [];

  for (const tx of txCounts) {
    seen.add(tx.description);
    const mc = mcMap.get(tx.description);
    merchants.push({
      id: mc?.id ?? 0,
      merchantName: tx.description,
      displayName: mc?.displayName ?? null,
      category: mc?.category ?? tx.category ?? "Uncategorized",
      isUserOverride: mc?.isUserOverride === 1,
      txCount: Number(tx.count),
      totalAmount: parseFloat(tx.totalAmount ?? "0"),
    });
  }

  // Include merchant_categories entries with no matching transactions (rare but possible)
  for (const mc of mcRows) {
    if (!seen.has(mc.merchantName)) {
      merchants.push({
        id: mc.id,
        merchantName: mc.merchantName,
        displayName: mc.displayName,
        category: mc.category,
        isUserOverride: mc.isUserOverride === 1,
        txCount: 0,
        totalAmount: 0,
      });
    }
  }

  return NextResponse.json({ merchants });
}

// PATCH: update display name and/or category for a merchant
export async function PATCH(request: NextRequest) {
  const body = await request.json();
  const { id, merchantName, displayName, category } = body as {
    id?: number;
    merchantName?: string;
    displayName?: string | null;
    category?: string;
  };

  if (!id && !merchantName) {
    return NextResponse.json({ error: "id or merchantName required" }, { status: 400 });
  }

  const updates: Record<string, unknown> = {};
  if (displayName !== undefined) updates.displayName = displayName;
  if (category !== undefined) updates.category = category;

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
  }

  if (id) {
    await db.update(merchantCategories).set(updates).where(eq(merchantCategories.id, id));
  } else if (merchantName) {
    const key = merchantName.toLowerCase().trim();
    // Upsert: if no entry exists yet, create one
    const existing = await db
      .select()
      .from(merchantCategories)
      .where(eq(merchantCategories.merchantName, key))
      .limit(1);

    if (existing.length > 0) {
      await db.update(merchantCategories).set(updates).where(eq(merchantCategories.merchantName, key));
    } else {
      await db.insert(merchantCategories).values({
        merchantName: key,
        category: (category as string) ?? "Other",
        displayName: displayName as string | undefined,
        isUserOverride: 0,
      });
    }
  }

  // If category was updated, also update matching transactions
  if (category && (id || merchantName)) {
    const key = merchantName?.toLowerCase().trim();
    const mcRow = id
      ? (await db.select().from(merchantCategories).where(eq(merchantCategories.id, id)).limit(1))[0]
      : null;
    const finalKey = key ?? mcRow?.merchantName;

    if (finalKey) {
      await db
        .update(transactions)
        .set({ category })
        .where(sql`lower(trim(${transactions.description})) = ${finalKey}`);
    }
  }

  return NextResponse.json({ success: true });
}

// POST: merge merchants
export async function POST(request: NextRequest) {
  const url = new URL(request.url);
  const action = url.searchParams.get("action");

  if (action !== "merge") {
    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  }

  const body = await request.json();
  const { merchantNames, displayName, category } = body as {
    merchantNames: string[];
    displayName: string;
    category: string;
  };

  if (!merchantNames?.length || !displayName || !category) {
    return NextResponse.json({ error: "merchantNames, displayName, and category are required" }, { status: 400 });
  }

  const keys = merchantNames.map((n) => n.toLowerCase().trim());

  // Update all matching merchant_categories entries
  for (const key of keys) {
    const existing = await db
      .select()
      .from(merchantCategories)
      .where(eq(merchantCategories.merchantName, key))
      .limit(1);

    if (existing.length > 0) {
      await db
        .update(merchantCategories)
        .set({ displayName, category })
        .where(eq(merchantCategories.merchantName, key));
    } else {
      await db.insert(merchantCategories).values({
        merchantName: key,
        category,
        displayName,
        isUserOverride: 0,
      });
    }
  }

  // Update all matching transactions' categories
  await db
    .update(transactions)
    .set({ category })
    .where(
      sql`lower(trim(${transactions.description})) IN (${sql.join(
        keys.map((k) => sql`${k}`),
        sql`, `
      )})`
    );

  return NextResponse.json({ success: true, merged: keys.length });
}
