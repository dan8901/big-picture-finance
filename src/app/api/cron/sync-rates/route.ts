import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { exchangeRates } from "@/db/schema";
import { eq, and, desc } from "drizzle-orm";

const BATCH_SIZE = 30;

async function fetchWithRetry(
  date: string,
  retries = 3
): Promise<{ date: string; rate: number | undefined }> {
  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      const url = `https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@${date}/v1/currencies/ils.json`;
      const res = await fetch(url);
      if (res.ok) {
        const data = await res.json();
        return { date, rate: data.ils?.usd as number | undefined };
      }
      if (res.status === 404) break;
    } catch {
      if (attempt < retries - 1) {
        await new Promise((r) => setTimeout(r, 500 * (attempt + 1)));
      }
    }
  }
  return { date, rate: undefined };
}

export async function GET(request: NextRequest) {
  // Verify cron secret (Vercel sets this automatically for cron routes)
  const authHeader = request.headers.get("authorization");
  if (
    process.env.CRON_SECRET &&
    authHeader !== `Bearer ${process.env.CRON_SECRET}`
  ) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Generate all weekday dates for the past 3 years up to yesterday
  const today = new Date();
  const threeYearsAgo = new Date(today);
  threeYearsAgo.setFullYear(today.getFullYear() - 3);
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);

  const allDates: string[] = [];
  for (
    let d = new Date(threeYearsAgo);
    d <= yesterday;
    d.setDate(d.getDate() + 1)
  ) {
    const day = d.getDay();
    if (day !== 0 && day !== 6) {
      allDates.push(d.toISOString().split("T")[0]);
    }
  }

  // Get already cached dates
  const cached = await db
    .select({ date: exchangeRates.date })
    .from(exchangeRates)
    .where(
      and(
        eq(exchangeRates.fromCurrency, "ILS"),
        eq(exchangeRates.toCurrency, "USD")
      )
    );
  const cachedSet = new Set(cached.map((r) => r.date));
  const neededDates = allDates.filter((d) => !cachedSet.has(d));

  if (neededDates.length === 0) {
    return NextResponse.json({ synced: 0, message: "All rates up to date" });
  }

  // Fetch in batches
  let totalSynced = 0;

  for (let i = 0; i < neededDates.length; i += BATCH_SIZE) {
    const batch = neededDates.slice(i, i + BATCH_SIZE);
    const results = await Promise.all(batch.map((d) => fetchWithRetry(d)));

    results.sort((a, b) => a.date.localeCompare(b.date));

    // Get last known rate for gap filling
    const lastCached = await db
      .select({ rate: exchangeRates.rate })
      .from(exchangeRates)
      .where(
        and(
          eq(exchangeRates.fromCurrency, "ILS"),
          eq(exchangeRates.toCurrency, "USD")
        )
      )
      .orderBy(desc(exchangeRates.date))
      .limit(1);

    let lastKnownRate: number | null =
      lastCached.length > 0 ? parseFloat(lastCached[0].rate) : null;

    const toInsert: Array<{
      date: string;
      fromCurrency: string;
      toCurrency: string;
      rate: string;
    }> = [];

    for (const { date, rate } of results) {
      if (rate) lastKnownRate = rate;
      const useRate = rate ?? lastKnownRate;
      if (useRate) {
        toInsert.push({
          date,
          fromCurrency: "ILS",
          toCurrency: "USD",
          rate: String(useRate),
        });
      }
    }

    if (toInsert.length > 0) {
      try {
        await db
          .insert(exchangeRates)
          .values(toInsert)
          .onConflictDoNothing();
        totalSynced += toInsert.length;
      } catch {
        // Ignore conflicts
      }
    }
  }

  return NextResponse.json({ synced: totalSynced });
}
