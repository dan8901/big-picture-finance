import { db } from "@/db";
import { exchangeRates } from "@/db/schema";
import { and, eq } from "drizzle-orm";

/**
 * Get all cached exchange rates for a currency pair.
 * Returns a Map of date → rate. Only reads from DB — call
 * POST /api/exchange-rates first to populate.
 */
export async function getExchangeRatesForDates(
  dates: string[],
  from: string,
  to: string
): Promise<Map<string, number>> {
  if (from === to) {
    return new Map(dates.map((d) => [d, 1]));
  }

  const rateMap = new Map<string, number>();

  // Load all cached rates for this pair
  const cached = await db
    .select()
    .from(exchangeRates)
    .where(
      and(
        eq(exchangeRates.fromCurrency, from),
        eq(exchangeRates.toCurrency, to)
      )
    )
    .orderBy(exchangeRates.date);

  for (const row of cached) {
    rateMap.set(row.date, parseFloat(row.rate));
  }

  // For dates without an exact match, find nearest previous rate
  const sortedCachedDates = [...rateMap.keys()].sort();

  for (const date of dates) {
    if (rateMap.has(date)) continue;

    // Find nearest previous date
    for (let i = sortedCachedDates.length - 1; i >= 0; i--) {
      if (sortedCachedDates[i] <= date) {
        rateMap.set(date, rateMap.get(sortedCachedDates[i])!);
        break;
      }
    }
  }

  return rateMap;
}
