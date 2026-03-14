import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { llmConfig, llmUsageLogs } from "@/db/schema";
import { desc, sql, gte } from "drizzle-orm";
import { clearConfigCache, createLLMClientFromConfig } from "@/lib/llm";
import type { ProviderKey } from "@/lib/llm-presets";

// GET: return current config (masked) + optional usage stats
export async function GET(request: NextRequest) {
  const showUsage = request.nextUrl.searchParams.get("usage") === "true";
  const period = request.nextUrl.searchParams.get("period") ?? "all";

  // Get config
  const rows = await db.select().from(llmConfig).orderBy(desc(llmConfig.id)).limit(1);
  const config = rows[0] ?? null;

  const result: Record<string, unknown> = {};

  if (config) {
    result.configured = true;
    result.provider = config.provider;
    result.apiKey = config.apiKey.length > 4
      ? "•".repeat(config.apiKey.length - 4) + config.apiKey.slice(-4)
      : "••••";
    result.baseUrl = config.baseUrl;
    result.model = config.model;
    result.updatedAt = config.updatedAt;
  } else {
    result.configured = false;
  }

  if (showUsage) {
    let dateFilter;
    if (period === "7d") {
      dateFilter = gte(llmUsageLogs.createdAt, new Date(Date.now() - 7 * 86400000));
    } else if (period === "30d") {
      dateFilter = gte(llmUsageLogs.createdAt, new Date(Date.now() - 30 * 86400000));
    }

    const conditions = dateFilter ? sql`WHERE ${dateFilter}` : sql``;

    // Total stats
    const totals = await db
      .select({
        totalCalls: sql<number>`count(*)`,
        totalInputTokens: sql<number>`coalesce(sum(${llmUsageLogs.inputTokens}), 0)`,
        totalOutputTokens: sql<number>`coalesce(sum(${llmUsageLogs.outputTokens}), 0)`,
        totalCost: sql<string>`coalesce(sum(${llmUsageLogs.estimatedCost}), 0)`,
      })
      .from(llmUsageLogs)
      .where(dateFilter);

    // Breakdown by feature
    const byFeature = await db
      .select({
        feature: llmUsageLogs.feature,
        calls: sql<number>`count(*)`,
        inputTokens: sql<number>`coalesce(sum(${llmUsageLogs.inputTokens}), 0)`,
        outputTokens: sql<number>`coalesce(sum(${llmUsageLogs.outputTokens}), 0)`,
        cost: sql<string>`coalesce(sum(${llmUsageLogs.estimatedCost}), 0)`,
      })
      .from(llmUsageLogs)
      .where(dateFilter)
      .groupBy(llmUsageLogs.feature);

    result.usage = {
      ...totals[0],
      totalCost: parseFloat(String(totals[0]?.totalCost ?? "0")),
      byFeature: byFeature.map((f) => ({
        ...f,
        cost: parseFloat(String(f.cost)),
      })),
    };
  }

  return NextResponse.json(result);
}

// PUT: save config
export async function PUT(request: NextRequest) {
  const body = await request.json();
  const { provider, apiKey, baseUrl, model } = body as {
    provider: string;
    apiKey: string;
    baseUrl: string | null;
    model: string;
  };

  if (!provider || !model) {
    return NextResponse.json({ error: "Provider and model are required" }, { status: 400 });
  }

  // Get existing config for apiKey preservation
  const existing = await db.select().from(llmConfig).orderBy(desc(llmConfig.id)).limit(1);

  const resolvedApiKey = apiKey === "__UNCHANGED__" && existing[0]
    ? existing[0].apiKey
    : apiKey;

  if (!resolvedApiKey) {
    return NextResponse.json({ error: "API key is required" }, { status: 400 });
  }

  // Delete old config and insert new (upsert pattern for single-row table)
  await db.delete(llmConfig);
  await db.insert(llmConfig).values({
    provider: provider as ProviderKey,
    apiKey: resolvedApiKey,
    baseUrl: provider === "anthropic" ? null : (baseUrl ?? null),
    model,
  });

  clearConfigCache();

  return NextResponse.json({ success: true });
}

// POST: test connection
export async function POST(request: NextRequest) {
  const action = request.nextUrl.searchParams.get("action");
  if (action !== "test") {
    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  }

  const body = await request.json();
  const { provider, apiKey, baseUrl, model } = body as {
    provider: string;
    apiKey: string;
    baseUrl: string | null;
    model: string;
  };

  // Resolve __UNCHANGED__ key
  let resolvedApiKey = apiKey;
  if (apiKey === "__UNCHANGED__") {
    const existing = await db.select().from(llmConfig).orderBy(desc(llmConfig.id)).limit(1);
    resolvedApiKey = existing[0]?.apiKey ?? "";
  }

  if (!resolvedApiKey) {
    return NextResponse.json({ error: "API key is required" }, { status: 400 });
  }

  try {
    const client = createLLMClientFromConfig(provider, resolvedApiKey, baseUrl ?? null, model);
    const result = await client.complete({
      messages: [{ role: "user", content: "Say hello in one word." }],
      maxTokens: 10,
    });

    return NextResponse.json({
      success: true,
      response: result.content,
      usage: result.usage,
    });
  } catch (err) {
    return NextResponse.json({
      success: false,
      error: err instanceof Error ? err.message : "Connection failed",
    }, { status: 400 });
  }
}
