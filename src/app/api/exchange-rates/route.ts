import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { exchangeRates, transactions } from "@/db/schema";
import { eq, and, desc } from "drizzle-orm";

// GET: return list of dates in past 3 years not yet cached
export async function GET() {
  // Generate every date for the past 3 years
  const today = new Date();
  const threeYearsAgo = new Date(today);
  threeYearsAgo.setFullYear(today.getFullYear() - 3);

  // Only include weekdays (Mon-Fri) up to yesterday (today's rate may not exist yet)
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

  // Get latest rate for convenience
  const latestRows = await db
    .select({ rate: exchangeRates.rate, date: exchangeRates.date })
    .from(exchangeRates)
    .where(
      and(
        eq(exchangeRates.fromCurrency, "ILS"),
        eq(exchangeRates.toCurrency, "USD")
      )
    )
    .orderBy(desc(exchangeRates.date))
    .limit(1);
  const latestRate = latestRows[0] ?? null;

  return NextResponse.json({
    cached: cached.length,
    needed: neededDates,
    total: allDates.length,
    latestRate: latestRate ? parseFloat(latestRate.rate) : null,
    latestRateDate: latestRate?.date ?? null,
  });
}

// POST: fetch and store a batch of dates (fetched in parallel)
export async function POST(request: NextRequest) {
  const body = await request.json();
  const { dates } = body as { dates: string[] };

  if (!dates || dates.length === 0) {
    return NextResponse.json({ fetched: 0 });
  }

  // Fetch all dates in parallel with retries
  async function fetchWithRetry(date: string, retries = 3): Promise<{ date: string; rate: number | undefined }> {
    for (let attempt = 0; attempt < retries; attempt++) {
      try {
        const url = `https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@${date}/v1/currencies/ils.json`;
        const res = await fetch(url);
        if (res.ok) {
          const data = await res.json();
          return { date, rate: data.ils?.usd as number | undefined };
        }
        if (res.status === 404) break; // No point retrying a 404
      } catch {
        if (attempt < retries - 1) {
          await new Promise((r) => setTimeout(r, 500 * (attempt + 1)));
        }
      }
    }
    return { date, rate: undefined };
  }

  const results = await Promise.all(dates.map((date) => fetchWithRetry(date)));

  // Sort by date so we can fill gaps forward
  results.sort((a, b) => a.date.localeCompare(b.date));

  // Get last cached rate as starting fallback
  const lastCached = await db
    .select({ rate: exchangeRates.rate })
    .from(exchangeRates)
    .where(
      and(
        eq(exchangeRates.fromCurrency, "ILS"),
        eq(exchangeRates.toCurrency, "USD")
      )
    )
    .orderBy(exchangeRates.date)
    .limit(1);

  let lastKnownRate: number | null =
    lastCached.length > 0 ? parseFloat(lastCached[0].rate) : null;

  // Build insert list — every date gets a rate (fill gaps with last known)
  const toInsert: Array<{
    date: string;
    fromCurrency: string;
    toCurrency: string;
    rate: string;
  }> = [];

  for (const { date, rate } of results) {
    if (rate) {
      lastKnownRate = rate;
    }
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
      await db.insert(exchangeRates).values(toInsert).onConflictDoNothing();
    } catch {
      // Ignore conflicts
    }
  }

  return NextResponse.json({ fetched: toInsert.length });
}
