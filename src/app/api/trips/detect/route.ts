import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { transactions, accounts } from "@/db/schema";
import { and, eq, sql, isNull } from "drizzle-orm";
import { getExchangeRatesForDates } from "@/lib/exchange";
import { getLLMClient } from "@/lib/llm";

const MAX_TRANSACTIONS_FOR_LLM = 200;

interface DetectRequest {
  startDate: string;
  endDate: string;
  destination?: string;
}

interface TransactionSuggestion {
  id: number;
  date: string;
  amount: string;
  currency: string;
  originalCurrency: string | null;
  originalAmount: string | null;
  description: string;
  category: string | null;
  accountName: string;
  suggested: boolean;
  reason: string;
  amountUsd: number;
}

export async function POST(request: NextRequest) {
  const body = (await request.json()) as DetectRequest;
  const { startDate, endDate, destination } = body;

  if (!startDate || !endDate) {
    return NextResponse.json({ error: "startDate and endDate are required" }, { status: 400 });
  }

  // Compute pre-trip window: 60 days before start
  const startDateObj = new Date(startDate);
  const preTripStart = new Date(startDateObj);
  preTripStart.setDate(preTripStart.getDate() - 60);
  const preTripStartStr = `${preTripStart.getFullYear()}-${String(preTripStart.getMonth() + 1).padStart(2, "0")}-${String(preTripStart.getDate()).padStart(2, "0")}`;

  // Query non-excluded, untagged transactions in the full window
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
    })
    .from(transactions)
    .where(
      and(
        sql`${transactions.date} >= ${preTripStartStr}`,
        sql`${transactions.date} <= ${endDate}`,
        eq(transactions.excluded, 0),
        isNull(transactions.eventId)
      )
    );

  // Get accounts for names
  const accts = await db.select().from(accounts);
  const accountMap = new Map(accts.map((a) => [a.id, a]));

  // Fetch exchange rates for ILS→USD conversion
  const ilsDates = txns.filter((tx) => tx.currency === "ILS").map((tx) => tx.date);
  const ilsRates = await getExchangeRatesForDates(ilsDates, "ILS", "USD");

  // Split into during-trip and pre-trip
  const duringTripTxns = txns.filter((tx) => tx.date >= startDate && tx.date <= endDate);
  const preTripTxns = txns.filter((tx) => tx.date < startDate);

  // Only include expenses (negative amounts)
  const duringTripExpenses = duringTripTxns.filter((tx) => parseFloat(tx.amount) < 0);
  const preTripExpenses = preTripTxns.filter((tx) => parseFloat(tx.amount) < 0);

  // Build transaction info with USD amounts
  function enrichTx(tx: typeof txns[number]) {
    const amt = parseFloat(tx.amount);
    const absAmt = Math.abs(amt);
    let amountUsd: number;
    if (tx.currency === "ILS") {
      const rate = ilsRates.get(tx.date) ?? 0;
      amountUsd = rate > 0 ? Math.round(absAmt * rate * 100) / 100 : 0;
    } else {
      amountUsd = absAmt;
    }
    const account = accountMap.get(tx.accountId);
    return {
      id: tx.id,
      date: tx.date,
      amount: tx.amount,
      currency: tx.currency,
      originalCurrency: tx.originalCurrency,
      originalAmount: tx.originalAmount,
      description: tx.description,
      category: tx.category,
      accountName: account?.name ?? "Unknown",
      amountUsd,
    };
  }

  const duringEnriched = duringTripExpenses.map(enrichTx);
  const preTripEnriched = preTripExpenses.map(enrichTx);

  // Try LLM detection
  let llmSuggestions: { duringTrip: number[]; preTripBookings: number[] } | null = null;
  let llmReasons: Map<number, string> = new Map();

  try {
    const llm = await getLLMClient("trips");

    // Build compact transaction lists for LLM
    function formatTxList(txList: ReturnType<typeof enrichTx>[]) {
      return txList
        .slice(0, MAX_TRANSACTIONS_FOR_LLM)
        .map((tx) => {
          const origCur = tx.originalCurrency ? ` (original: ${tx.originalCurrency})` : "";
          return `- ID:${tx.id} | ${tx.date} | ${Math.abs(parseFloat(tx.amount)).toFixed(2)} ${tx.currency}${origCur} | ${tx.description} | ${tx.category ?? "uncategorized"} | ${tx.accountName}`;
        })
        .join("\n");
    }

    const tripLabel = destination ? `a trip to ${destination}` : "a trip";
    const prompt = `You are analyzing bank and credit card transactions to identify which ones are related to ${tripLabel} from ${startDate} to ${endDate}.

## During-trip transactions (${startDate} to ${endDate}):
${duringEnriched.length > 0 ? formatTxList(duringEnriched) : "(none)"}

## Pre-trip window (${preTripStartStr} to the day before departure — look for flights, hotels, insurance, travel bookings):
${preTripEnriched.length > 0 ? formatTxList(preTripEnriched) : "(none)"}

Return a JSON object identifying trip-related transactions:
{
  "duringTrip": [{"id": <number>, "reason": "<brief reason>"}],
  "preTripBookings": [{"id": <number>, "reason": "<brief reason>"}]
}

Rules:
- During trip: include meals, transport, hotels, activities, shopping, tourism. EXCLUDE recurring subscriptions (Netflix, Spotify, OpenAI, Google One, etc.) and regular bills that happen to fall in the date range.
- Pre-trip: include clear travel-related bookings — flights, hotels (Booking.com, Airbnb, Expedia, Hotels.com, etc.), travel insurance, car rentals, visa fees. When a merchant name clearly matches a travel/booking platform, include it.
- Transactions in foreign currencies (marked with "original: USD/EUR/GBP") on Israeli credit cards are strong indicators of trip spending, but still exclude recurring subscriptions.
- Return ONLY valid transaction IDs from the lists above.`;

    const response = await llm.complete({
      messages: [{ role: "user", content: prompt }],
      maxTokens: 4096,
      feature: "trips",
    });

    if (response.content) {
      const jsonMatch = response.content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        const duringIds = new Set<number>();
        const preIds = new Set<number>();

        if (Array.isArray(parsed.duringTrip)) {
          for (const item of parsed.duringTrip) {
            const id = typeof item === "number" ? item : item?.id;
            if (typeof id === "number") {
              duringIds.add(id);
              if (item?.reason) llmReasons.set(id, item.reason);
            }
          }
        }
        if (Array.isArray(parsed.preTripBookings)) {
          for (const item of parsed.preTripBookings) {
            const id = typeof item === "number" ? item : item?.id;
            if (typeof id === "number") {
              preIds.add(id);
              if (item?.reason) llmReasons.set(id, item.reason);
            }
          }
        }

        // Validate IDs exist in our candidate sets
        const validDuringIds = duringEnriched.map((tx) => tx.id);
        const validPreIds = preTripEnriched.map((tx) => tx.id);

        llmSuggestions = {
          duringTrip: [...duringIds].filter((id) => validDuringIds.includes(id)),
          preTripBookings: [...preIds].filter((id) => validPreIds.includes(id)),
        };
      }
    }
  } catch {
    // LLM failed — fall back to suggesting all during-trip transactions
  }

  // Build response: all candidates with suggested flag
  const duringTripSuggested = new Set(llmSuggestions?.duringTrip ?? duringEnriched.map((tx) => tx.id));
  const preTripSuggested = new Set(llmSuggestions?.preTripBookings ?? []);

  const duringTripResult: TransactionSuggestion[] = duringEnriched.map((tx) => ({
    ...tx,
    suggested: duringTripSuggested.has(tx.id),
    reason: llmReasons.get(tx.id) ?? "",
  }));

  const preTripResult: TransactionSuggestion[] = preTripEnriched.map((tx) => ({
    ...tx,
    suggested: preTripSuggested.has(tx.id),
    reason: llmReasons.get(tx.id) ?? "",
  }));

  return NextResponse.json({
    duringTrip: duringTripResult,
    preTripBookings: preTripResult,
    llmUsed: llmSuggestions !== null,
  });
}
