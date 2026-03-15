import { NextResponse } from "next/server";
import { db } from "@/db";
import { events, transactions, accounts } from "@/db/schema";
import { eq, and, sql, inArray } from "drizzle-orm";
import { getExchangeRatesForDates } from "@/lib/exchange";

export async function GET() {
  // Get all trip-type events
  const trips = await db
    .select()
    .from(events)
    .where(eq(events.type, "trip"))
    .orderBy(sql`${events.startDate} DESC`);

  if (trips.length === 0) {
    return NextResponse.json({ trips: [], yearSummary: { count: 0, totalUsd: 0, totalIls: 0 } });
  }

  const tripIds = trips.map((t) => t.id);

  // Get all non-excluded transactions tagged to these trips
  const txns = await db
    .select({
      id: transactions.id,
      date: transactions.date,
      amount: transactions.amount,
      currency: transactions.currency,
      originalCurrency: transactions.originalCurrency,
      originalAmount: transactions.originalAmount,
      description: transactions.description,
      category: transactions.category,
      accountId: transactions.accountId,
      eventId: transactions.eventId,
      note: transactions.note,
    })
    .from(transactions)
    .where(
      and(
        inArray(transactions.eventId, tripIds),
        eq(transactions.excluded, 0)
      )
    );

  // Get accounts for names
  const accts = await db.select().from(accounts);
  const accountMap = new Map(accts.map((a) => [a.id, a]));

  // Fetch exchange rates for ILS transactions
  const ilsDates = txns.filter((tx) => tx.currency === "ILS").map((tx) => tx.date);
  const ilsRates = await getExchangeRatesForDates(ilsDates, "ILS", "USD");

  // Fetch USD→ILS rates for USD transactions
  const usdDates = txns.filter((tx) => tx.currency === "USD").map((tx) => tx.date);
  const usdIlsRatesRaw = await getExchangeRatesForDates(usdDates, "ILS", "USD");
  const usdToIlsRates = new Map<string, number>();
  for (const [date, rate] of usdIlsRatesRaw) {
    usdToIlsRates.set(date, rate > 0 ? 1 / rate : 0);
  }

  // Build enriched trip data
  const enrichedTrips = trips.map((trip) => {
    const tripTxns = txns.filter((tx) => tx.eventId === trip.id);
    let totalUsd = 0;
    let totalIls = 0;
    const categoryBreakdown: Record<string, number> = {};
    const tripTransactions: Array<{
      id: number;
      date: string;
      amount: string;
      currency: string;
      originalCurrency: string | null;
      originalAmount: string | null;
      description: string;
      category: string | null;
      accountName: string;
      note: string | null;
    }> = [];

    for (const tx of tripTxns) {
      const amt = parseFloat(tx.amount);
      const absAmt = Math.abs(amt);
      const account = accountMap.get(tx.accountId);

      let usdAmount: number;
      let ilsAmount: number;

      if (tx.currency === "ILS") {
        const rate = ilsRates.get(tx.date) ?? 0;
        usdAmount = rate > 0 ? absAmt * rate : 0;
        ilsAmount = absAmt;
      } else {
        usdAmount = absAmt;
        const ilsRate = usdToIlsRates.get(tx.date) ?? 0;
        ilsAmount = ilsRate > 0 ? absAmt * ilsRate : 0;
      }

      totalUsd += usdAmount;
      totalIls += ilsAmount;

      const cat = tx.category ?? "Other";
      categoryBreakdown[cat] = (categoryBreakdown[cat] ?? 0) + usdAmount;

      tripTransactions.push({
        id: tx.id,
        date: tx.date,
        amount: tx.amount,
        currency: tx.currency,
        originalCurrency: tx.originalCurrency,
        originalAmount: tx.originalAmount,
        description: tx.description,
        category: tx.category,
        accountName: account?.name ?? "Unknown",
        note: tx.note,
      });
    }

    // Calculate per-day average
    const start = new Date(trip.startDate);
    const end = trip.endDate ? new Date(trip.endDate) : start;
    const days = Math.max(1, Math.ceil((end.getTime() - start.getTime()) / 86400000) + 1);

    return {
      id: trip.id,
      name: trip.name,
      startDate: trip.startDate,
      endDate: trip.endDate,
      destination: trip.destination,
      totalUsd: Math.round(totalUsd * 100) / 100,
      totalIls: Math.round(totalIls * 100) / 100,
      categoryBreakdown,
      txCount: tripTxns.length,
      perDayAvg: Math.round((totalUsd / days) * 100) / 100,
      transactions: tripTransactions.sort((a, b) => a.date.localeCompare(b.date)),
    };
  });

  const yearSummary = {
    count: enrichedTrips.length,
    totalUsd: Math.round(enrichedTrips.reduce((s, t) => s + t.totalUsd, 0) * 100) / 100,
    totalIls: Math.round(enrichedTrips.reduce((s, t) => s + t.totalIls, 0) * 100) / 100,
  };

  return NextResponse.json({ trips: enrichedTrips, yearSummary });
}
