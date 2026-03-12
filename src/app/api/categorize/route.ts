import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { transactions, merchantCategories } from "@/db/schema";
import { eq, isNull, sql, and } from "drizzle-orm";
import OpenAI from "openai";

const STANDARD_CATEGORIES = [
  "Food & Dining",
  "Transportation",
  "Housing & Utilities",
  "Health & Insurance",
  "Shopping & Clothing",
  "Entertainment & Leisure",
  "Transfers",
  "Government & Taxes",
  "Other",
];

// Map existing parser categories to standard ones
const CATEGORY_MAP: Record<string, string> = {
  // Old standard categories → new consolidated
  "Food & Groceries": "Food & Dining",
  "Restaurants & Cafes": "Food & Dining",
  "Health & Medical": "Health & Insurance",
  Insurance: "Health & Insurance",
  Subscriptions: "Other",
  Education: "Other",
  // Discover
  Merchandise: "Shopping & Clothing",
  Services: "Other",
  "Restaurants/Dining": "Food & Dining",
  Restaurants: "Food & Dining",
  Supermarkets: "Food & Dining",
  "Department Stores": "Shopping & Clothing",
  "Travel/ Entertainment": "Entertainment & Leisure",
  "Payments and Credits": "Transfers",
  "Awards and Rebate Credits": "Other",
  Fees: "Other",
  "Government Services": "Government & Taxes",
  // Max (Hebrew)
  "מזון וצריכה": "Food & Dining",
  "מסעדות, קפה וברים": "Food & Dining",
  "תחבורה ורכבים": "Transportation",
  "רפואה ובתי מרקחת": "Health & Insurance",
  "פנאי, בידור וספורט": "Entertainment & Leisure",
  אופנה: "Shopping & Clothing",
  "קוסמטיקה וטיפוח": "Shopping & Clothing",
  "חשמל ומחשבים": "Shopping & Clothing",
  "העברת כספים": "Transfers",
  שונות: "Other",
  "עירייה וממשלה": "Government & Taxes",
  ביטוח: "Health & Insurance",
  "דלק, חשמל וגז": "Housing & Utilities",
  "טיסות ותיירות": "Entertainment & Leisure",
  "עיצוב הבית": "Shopping & Clothing",
  "ספרים ודפוס": "Other",
  "שירותי תקשורת": "Other",
  // SDFCU
  Transfers: "Transfers",
  "Other Expenses": "Other",
  "Service Charges/Fees": "Other",
  // IBKR
  Dividend: "Other",
  "Credit Interest": "Other",
  "Debit Interest": "Other",
  Withdrawal: "Transfers",
  Deposit: "Transfers",
  "Payment in Lieu": "Other",
};

// GET: return categorization status
export async function GET() {
  const uncategorized = await db
    .select({ count: sql<number>`count(*)` })
    .from(transactions)
    .where(and(isNull(transactions.category), eq(transactions.excluded, 0)));

  const total = await db
    .select({ count: sql<number>`count(*)` })
    .from(transactions)
    .where(eq(transactions.excluded, 0));

  return NextResponse.json({
    uncategorized: Number(uncategorized[0].count),
    total: Number(total[0].count),
  });
}

// POST: run categorization
export async function POST(request: NextRequest) {
  const body = await request.json();
  const { action, descriptions } = body as {
    action: "categorize" | "normalize" | "detect-recurring" | "get-uncategorized" | "categorize-batch";
    descriptions?: string[];
  };

  if (action === "normalize") {
    return normalizeCategories();
  }

  if (action === "detect-recurring") {
    return detectRecurring();
  }

  if (action === "get-uncategorized") {
    return getUncategorizedDescriptions();
  }

  if (action === "categorize-batch" && descriptions) {
    return categorizeBatch(descriptions);
  }

  return categorizeWithLLM();
}

async function getUncategorizedDescriptions() {
  // Load cached merchant→category mappings
  const cached = await db.select().from(merchantCategories);
  const cachedMap = new Set(
    cached.map((r) => r.merchantName.toLowerCase().trim())
  );

  // Find uncategorized, non-excluded transactions
  const uncategorized = await db
    .select({
      description: transactions.description,
    })
    .from(transactions)
    .where(and(isNull(transactions.category), eq(transactions.excluded, 0)));

  // Get unique descriptions not in cache
  const unique = [
    ...new Set(uncategorized.map((t) => t.description.toLowerCase().trim())),
  ].filter((d) => !cachedMap.has(d));

  // Apply cached ones first
  const cachedEntries = await db.select().from(merchantCategories);
  const cacheMap = new Map(
    cachedEntries.map((r) => [r.merchantName.toLowerCase().trim(), r.category])
  );

  let cachedApplied = 0;
  for (const tx of uncategorized) {
    const key = tx.description.toLowerCase().trim();
    const cat = cacheMap.get(key);
    if (cat) {
      await db
        .update(transactions)
        .set({ category: cat })
        .where(
          and(
            sql`lower(trim(${transactions.description})) = lower(trim(${tx.description}))`,
            isNull(transactions.category)
          )
        );
      cachedApplied++;
    }
  }

  return NextResponse.json({
    descriptions: unique,
    total: unique.length,
    cachedApplied,
  });
}

async function categorizeBatch(descriptions: string[]) {
  const client = new OpenAI({
    apiKey: process.env.NVIDIA_API_KEY,
    baseURL: process.env.NVIDIA_BASE_URL,
  });

  const numbered = descriptions.map((d, idx) => `${idx + 1}. ${d}`).join("\n");

  const response = await client.chat.completions.create({
    model: process.env.NVIDIA_MODEL ?? "aws/anthropic/bedrock-claude-opus-4-6",
    max_tokens: 4096,
    messages: [
      {
        role: "user",
        content: `Categorize these transaction descriptions into one of these categories:
${STANDARD_CATEGORIES.join(", ")}

The descriptions may be in Hebrew or English. They are from Israeli and American bank/credit card statements.

Return ONLY a JSON object mapping the number to the category. Example: {"1": "Food & Groceries", "2": "Transportation"}

Descriptions:
${numbered}`,
      },
    ],
  });

  const text = response.choices[0]?.message?.content ?? "";
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    return NextResponse.json({ categorized: 0, error: "No JSON in response" });
  }

  let categorized = 0;
  try {
    const mapping = JSON.parse(jsonMatch[0]) as Record<string, string>;

    for (const [numStr, category] of Object.entries(mapping)) {
      const idx = parseInt(numStr) - 1;
      if (idx < 0 || idx >= descriptions.length) continue;
      if (!STANDARD_CATEGORIES.includes(category)) continue;

      const desc = descriptions[idx];

      // Update all matching uncategorized transactions
      await db
        .update(transactions)
        .set({ category })
        .where(
          and(
            sql`lower(trim(${transactions.description})) = lower(trim(${desc}))`,
            isNull(transactions.category)
          )
        );

      // Cache the mapping
      try {
        await db
          .insert(merchantCategories)
          .values({
            merchantName: desc,
            category,
            isUserOverride: 0,
          })
          .onConflictDoNothing();
      } catch {
        // Ignore duplicates
      }

      categorized++;
    }
  } catch {
    // Skip malformed JSON
  }

  return NextResponse.json({ categorized });
}

async function normalizeCategories() {
  let updated = 0;

  for (const [from, to] of Object.entries(CATEGORY_MAP)) {
    const result = await db
      .update(transactions)
      .set({ category: to })
      .where(eq(transactions.category, from));
    updated += result.rowCount ?? 0;
  }

  return NextResponse.json({ normalized: updated });
}

async function categorizeWithLLM() {
  // Load cached merchant→category mappings
  const cached = await db.select().from(merchantCategories);
  const cachedMap = new Map(
    cached.map((r) => [r.merchantName.toLowerCase().trim(), r.category])
  );

  // Find uncategorized, non-excluded transactions
  const uncategorized = await db
    .select({
      id: transactions.id,
      description: transactions.description,
    })
    .from(transactions)
    .where(and(isNull(transactions.category), eq(transactions.excluded, 0)));

  if (uncategorized.length === 0) {
    return NextResponse.json({ categorized: 0, message: "All transactions already categorized" });
  }

  // Group by unique description
  const descriptionGroups = new Map<string, number[]>();
  for (const tx of uncategorized) {
    const key = tx.description.toLowerCase().trim();
    if (!descriptionGroups.has(key)) descriptionGroups.set(key, []);
    descriptionGroups.get(key)!.push(tx.id);
  }

  // Check cache first
  const needsLLM: string[] = [];
  let cachedHits = 0;

  for (const [desc, ids] of descriptionGroups) {
    const cached = cachedMap.get(desc);
    if (cached) {
      // Apply cached category
      await db
        .update(transactions)
        .set({ category: cached })
        .where(
          sql`${transactions.id} = ANY(${ids})`
        );
      cachedHits += ids.length;
    } else {
      needsLLM.push(desc);
    }
  }

  if (needsLLM.length === 0) {
    return NextResponse.json({
      categorized: cachedHits,
      fromCache: cachedHits,
      fromLLM: 0,
      message: "All categorized from cache",
    });
  }

  // Batch LLM calls (100 descriptions per call)
  const BATCH_SIZE = 100;
  let llmCategorized = 0;

  const client = new OpenAI({
    apiKey: process.env.NVIDIA_API_KEY,
    baseURL: process.env.NVIDIA_BASE_URL,
  });

  for (let i = 0; i < needsLLM.length; i += BATCH_SIZE) {
    const batch = needsLLM.slice(i, i + BATCH_SIZE);
    const numbered = batch.map((d, idx) => `${idx + 1}. ${d}`).join("\n");

    const response = await client.chat.completions.create({
      model: process.env.NVIDIA_MODEL ?? "aws/anthropic/bedrock-claude-opus-4-6",
      max_tokens: 4096,
      messages: [
        {
          role: "user",
          content: `Categorize these transaction descriptions into one of these categories:
${STANDARD_CATEGORIES.join(", ")}

The descriptions may be in Hebrew or English. They are from Israeli and American bank/credit card statements.

Return ONLY a JSON object mapping the number to the category. Example: {"1": "Food & Groceries", "2": "Transportation"}

Descriptions:
${numbered}`,
        },
      ],
    });

    // Parse response
    const text = response.choices[0]?.message?.content ?? "";
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) continue;

    try {
      const mapping = JSON.parse(jsonMatch[0]) as Record<string, string>;

      for (const [numStr, category] of Object.entries(mapping)) {
        const idx = parseInt(numStr) - 1;
        if (idx < 0 || idx >= batch.length) continue;
        if (!STANDARD_CATEGORIES.includes(category)) continue;

        const desc = batch[idx];
        const ids = descriptionGroups.get(desc);
        if (!ids) continue;

        // Update transactions
        for (const id of ids) {
          await db
            .update(transactions)
            .set({ category })
            .where(eq(transactions.id, id));
        }

        // Cache the mapping
        try {
          await db
            .insert(merchantCategories)
            .values({
              merchantName: desc,
              category,
              isUserOverride: 0,
            })
            .onConflictDoNothing();
        } catch {
          // Ignore duplicates
        }

        llmCategorized += ids.length;
      }
    } catch {
      // Skip malformed JSON
    }
  }

  return NextResponse.json({
    categorized: cachedHits + llmCategorized,
    fromCache: cachedHits,
    fromLLM: llmCategorized,
    uniqueDescriptions: needsLLM.length,
    message: `Categorized ${cachedHits + llmCategorized} transactions`,
  });
}

async function detectRecurring() {
  // Reset all recurring flags
  await db.update(transactions).set({ isRecurring: 0 });

  // Find descriptions that appear in 3+ different months (non-excluded expenses)
  const result = await db.execute(sql`
    SELECT lower(trim(description)) as description, COUNT(DISTINCT to_char(date::date, 'YYYY-MM')) as month_count
    FROM transactions
    WHERE excluded = 0 AND amount::numeric < 0
    GROUP BY lower(trim(description))
    HAVING COUNT(DISTINCT to_char(date::date, 'YYYY-MM')) >= 3
  `);

  const recurring = (result.rows ?? result) as Array<{ description: string; month_count: string }>;

  let flagged = 0;
  for (const row of recurring) {
    await db
      .update(transactions)
      .set({ isRecurring: 1 })
      .where(
        sql`lower(trim(${transactions.description})) = ${row.description}`
      );
    flagged++;
  }

  return NextResponse.json({
    recurringDescriptions: recurring.length,
    flaggedTransactions: flagged,
    message: `Detected ${recurring.length} recurring expense patterns`,
  });
}
