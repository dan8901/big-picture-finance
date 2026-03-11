import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { transactions, exclusionRules, merchantCategories } from "@/db/schema";
import { inArray, sql, and, eq } from "drizzle-orm";

export async function PATCH(request: NextRequest) {
  const body = await request.json();
  const {
    ids,
    eventId,
    category,
    excluded,
    excludeByDescription,
    includeByDescription,
    categoryByDescription,
    accountId,
  } = body as {
    ids?: number[];
    eventId?: number | null;
    category?: string | null;
    excluded?: number;
    excludeByDescription?: string;
    includeByDescription?: string;
    categoryByDescription?: { description: string; category: string };
    accountId?: number;
  };

  // Set category for all transactions matching a description (+ save rule)
  if (categoryByDescription) {
    const { description, category: cat } = categoryByDescription;
    const condition = accountId
      ? and(
          sql`lower(trim(${transactions.description})) = lower(trim(${description}))`,
          eq(transactions.accountId, accountId)
        )
      : sql`lower(trim(${transactions.description})) = lower(trim(${description}))`;

    await db.update(transactions).set({ category: cat }).where(condition);

    // Save/update merchant category rule
    const key = description.toLowerCase().trim();
    const existing = await db
      .select()
      .from(merchantCategories)
      .where(eq(merchantCategories.merchantName, key))
      .limit(1);

    if (existing.length > 0) {
      await db
        .update(merchantCategories)
        .set({ category: cat, isUserOverride: 1 })
        .where(eq(merchantCategories.merchantName, key));
    } else {
      await db.insert(merchantCategories).values({
        merchantName: key,
        category: cat,
        isUserOverride: 1,
      });
    }

    return NextResponse.json({ updated: "all matching", rule: "saved" });
  }

  // Include all transactions matching a description for an account
  if (includeByDescription !== undefined) {
    const condition = accountId
      ? and(
          sql`lower(trim(${transactions.description})) = lower(trim(${includeByDescription}))`,
          eq(transactions.accountId, accountId)
        )
      : sql`lower(trim(${transactions.description})) = lower(trim(${includeByDescription}))`;

    await db.update(transactions).set({ excluded: 0 }).where(condition);

    // Remove exclusion rule
    if (accountId) {
      await db
        .delete(exclusionRules)
        .where(
          and(
            eq(exclusionRules.accountId, accountId),
            sql`lower(trim(${exclusionRules.description})) = lower(trim(${includeByDescription}))`
          )
        );
    }

    return NextResponse.json({ updated: "all matching" });
  }

  // Exclude all transactions matching a description for an account
  if (excludeByDescription !== undefined) {
    const condition = accountId
      ? and(
          sql`lower(trim(${transactions.description})) = lower(trim(${excludeByDescription}))`,
          eq(transactions.accountId, accountId)
        )
      : sql`lower(trim(${transactions.description})) = lower(trim(${excludeByDescription}))`;

    await db.update(transactions).set({ excluded: 1 }).where(condition);

    // Save exclusion rule for future imports
    if (accountId) {
      try {
        await db
          .insert(exclusionRules)
          .values({
            accountId,
            description: excludeByDescription.toLowerCase().trim(),
          })
          .onConflictDoNothing();
      } catch {
        // Ignore duplicate
      }
    }

    return NextResponse.json({ updated: "all matching" });
  }

  if (!ids || ids.length === 0) {
    return NextResponse.json({ error: "ids are required" }, { status: 400 });
  }

  const updates: Record<string, unknown> = {};
  if (eventId !== undefined) updates.eventId = eventId;
  if (category !== undefined) updates.category = category;
  if (excluded !== undefined) updates.excluded = excluded;

  if (Object.keys(updates).length === 0) {
    return NextResponse.json(
      { error: "Nothing to update" },
      { status: 400 }
    );
  }

  await db
    .update(transactions)
    .set(updates)
    .where(inArray(transactions.id, ids));

  return NextResponse.json({ updated: ids.length });
}
