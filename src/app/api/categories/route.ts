import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { categories, transactions, merchantCategories, goals } from "@/db/schema";
import { eq, sql } from "drizzle-orm";
import { getCategories, clearCategoryCache, getCategoryNames } from "@/lib/categories";
import { getLLMClient } from "@/lib/llm";

// GET: return all categories with transaction/goal counts
export async function GET() {
  const cats = await getCategories();

  // Get transaction counts per category
  const txCounts = await db
    .select({
      category: transactions.category,
      count: sql<number>`count(*)`,
    })
    .from(transactions)
    .where(sql`${transactions.category} IS NOT NULL`)
    .groupBy(transactions.category);

  const categoryCounts: Record<string, number> = {};
  for (const row of txCounts) {
    if (row.category) categoryCounts[row.category] = Number(row.count);
  }

  // Get goal counts per category
  const goalCounts = await db
    .select({
      category: goals.category,
      count: sql<number>`count(*)`,
    })
    .from(goals)
    .where(sql`${goals.category} IS NOT NULL AND ${goals.isActive} = 1`)
    .groupBy(goals.category);

  const goalCountMap: Record<string, number> = {};
  for (const row of goalCounts) {
    if (row.category) goalCountMap[row.category] = Number(row.count);
  }

  return NextResponse.json({ categories: cats, categoryCounts, goalCounts: goalCountMap });
}

// POST: add a new category or reorder
export async function POST(request: NextRequest) {
  const url = new URL(request.url);
  const action = url.searchParams.get("action");

  if (action === "reorder") {
    const { orderedIds } = (await request.json()) as { orderedIds: number[] };
    for (let i = 0; i < orderedIds.length; i++) {
      await db
        .update(categories)
        .set({ sortOrder: i })
        .where(eq(categories.id, orderedIds[i]));
    }
    clearCategoryCache();
    return NextResponse.json({ success: true });
  }

  const { name } = (await request.json()) as { name: string };
  if (!name?.trim()) {
    return NextResponse.json({ error: "Name is required" }, { status: 400 });
  }

  // Get max sortOrder
  const existing = await getCategories();
  const maxSort = existing.reduce((max, c) => Math.max(max, c.sortOrder), -1);

  try {
    await db.insert(categories).values({
      name: name.trim(),
      isDefault: 0,
      sortOrder: maxSort + 1,
    });
  } catch {
    return NextResponse.json({ error: "Category already exists" }, { status: 409 });
  }

  clearCategoryCache();
  return NextResponse.json({ success: true });
}

// DELETE: remove a category (only if no transactions/goals reference it)
export async function DELETE(request: NextRequest) {
  const { id } = (await request.json()) as { id: number };

  const cat = (await getCategories()).find((c) => c.id === id);
  if (!cat) {
    return NextResponse.json({ error: "Category not found" }, { status: 404 });
  }

  // Check references
  const txCount = await db
    .select({ count: sql<number>`count(*)` })
    .from(transactions)
    .where(eq(transactions.category, cat.name));

  const goalCount = await db
    .select({ count: sql<number>`count(*)` })
    .from(goals)
    .where(eq(goals.category, cat.name));

  if (Number(txCount[0].count) > 0 || Number(goalCount[0].count) > 0) {
    return NextResponse.json(
      { error: "Category has transactions or goals. Use the migration wizard to reassign first." },
      { status: 409 }
    );
  }

  await db.delete(categories).where(eq(categories.id, id));
  clearCategoryCache();
  return NextResponse.json({ success: true });
}

// PUT: apply migration or rename
export async function PUT(request: NextRequest) {
  const url = new URL(request.url);
  const action = url.searchParams.get("action");

  if (action === "apply-migration") {
    return applyMigration(request);
  }

  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}

async function applyMigration(request: NextRequest) {
  const body = (await request.json()) as {
    newCategories: string[];
    mappings: Record<string, string>;
    goalActions: Record<string, { action: "reassign" | "delete"; targetCategory?: string }>;
    recategorizeCategories?: string[];
  };

  const { newCategories, mappings, goalActions, recategorizeCategories } = body;

  // Validate
  if (!newCategories?.length) {
    return NextResponse.json({ error: "At least one category required" }, { status: 400 });
  }

  const stats = {
    transactionsRemapped: 0,
    merchantCacheUpdated: 0,
    goalsReassigned: 0,
    goalsDeleted: 0,
    categoriesAdded: 0,
    categoriesRemoved: 0,
    recategorized: 0,
  };

  // 1. Apply mappings (rename/merge transactions and merchant cache)
  for (const [oldCat, newCat] of Object.entries(mappings)) {
    if (oldCat === newCat) continue;

    // Update transactions
    const txResult = await db
      .update(transactions)
      .set({ category: newCat })
      .where(eq(transactions.category, oldCat));
    stats.transactionsRemapped += txResult.rowCount ?? 0;

    // Update merchant categories cache
    const mcResult = await db
      .update(merchantCategories)
      .set({ category: newCat })
      .where(eq(merchantCategories.category, oldCat));
    stats.merchantCacheUpdated += mcResult.rowCount ?? 0;
  }

  // 2. Handle goals
  for (const [goalIdStr, goalAction] of Object.entries(goalActions)) {
    const goalId = parseInt(goalIdStr);
    if (goalAction.action === "delete") {
      await db.delete(goals).where(eq(goals.id, goalId));
      stats.goalsDeleted++;
    } else if (goalAction.action === "reassign" && goalAction.targetCategory) {
      await db
        .update(goals)
        .set({ category: goalAction.targetCategory })
        .where(eq(goals.id, goalId));
      stats.goalsReassigned++;
    }
  }

  // 3. Replace categories table
  await db.delete(categories);
  for (let i = 0; i < newCategories.length; i++) {
    await db.insert(categories).values({
      name: newCategories[i],
      isDefault: 0,
      sortOrder: i,
    });
  }
  stats.categoriesAdded = newCategories.length;

  // 4. Recategorize selected categories with LLM
  if (recategorizeCategories && recategorizeCategories.length > 0) {
    const newCatSet = new Set(newCategories);

    // Find transactions in the categories marked for AI recategorization
    const orphaned = await db
      .select({
        description: transactions.description,
      })
      .from(transactions)
      .where(
        sql`${transactions.category} IN (${sql.join(
          recategorizeCategories.map((c) => sql`${c}`),
          sql`, `
        )})`
      );

    if (orphaned.length > 0) {
      const uniqueDescs = [...new Set(orphaned.map((t) => t.description.toLowerCase().trim()))];

      // Batch LLM categorization
      try {
        const llm = await getLLMClient("categorize");
        const BATCH_SIZE = 100;

        for (let i = 0; i < uniqueDescs.length; i += BATCH_SIZE) {
          const batch = uniqueDescs.slice(i, i + BATCH_SIZE);
          const numbered = batch.map((d, idx) => `${idx + 1}. ${d}`).join("\n");

          const response = await llm.complete({
            messages: [
              {
                role: "user",
                content: `Categorize these transaction descriptions into one of these categories:
${newCategories.join(", ")}

The descriptions may be in Hebrew or English. They are from Israeli and American bank/credit card statements.

Return ONLY a JSON object mapping the number to the category. Example: {"1": "${newCategories[0]}", "2": "${newCategories[1] || newCategories[0]}"}

Descriptions:
${numbered}`,
              },
            ],
            maxTokens: 4096,
            feature: "categorize",
          });

          const text = response.content ?? "";
          const jsonMatch = text.match(/\{[\s\S]*\}/);
          if (!jsonMatch) continue;

          try {
            const mapping = JSON.parse(jsonMatch[0]) as Record<string, string>;

            for (const [numStr, category] of Object.entries(mapping)) {
              const idx = parseInt(numStr) - 1;
              if (idx < 0 || idx >= batch.length) continue;
              if (!newCatSet.has(category)) continue;

              const desc = batch[idx];
              const result = await db
                .update(transactions)
                .set({ category })
                .where(
                  sql`lower(trim(${transactions.description})) = ${desc} AND ${transactions.category} IN (${sql.join(
                    recategorizeCategories.map((c) => sql`${c}`),
                    sql`, `
                  )})`
                );
              stats.recategorized += result.rowCount ?? 0;

              // Update merchant cache too
              try {
                await db
                  .insert(merchantCategories)
                  .values({ merchantName: desc, category, isUserOverride: 0 })
                  .onConflictDoUpdate({
                    target: merchantCategories.merchantName,
                    set: { category },
                  });
              } catch {
                // ignore
              }
            }
          } catch {
            // Skip malformed JSON
          }
        }
      } catch {
        // LLM not configured — skip recategorization
      }
    }
  }

  clearCategoryCache();

  return NextResponse.json({ success: true, stats });
}
