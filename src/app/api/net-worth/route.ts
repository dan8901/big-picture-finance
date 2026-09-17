import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { netWorthSnapshots, accounts } from "@/db/schema";
import { eq, desc, sql } from "drizzle-orm";

export async function GET() {
  const snapshots = await db
    .select({
      id: netWorthSnapshots.id,
      accountId: netWorthSnapshots.accountId,
      balance: netWorthSnapshots.balance,
      currency: netWorthSnapshots.currency,
      snapshotDate: netWorthSnapshots.snapshotDate,
      accountName: accounts.name,
      accountType: accounts.type,
      accountOwner: accounts.owner,
    })
    .from(netWorthSnapshots)
    .innerJoin(accounts, eq(netWorthSnapshots.accountId, accounts.id))
    .orderBy(desc(netWorthSnapshots.snapshotDate));

  return NextResponse.json(snapshots);
}

export async function POST(request: NextRequest) {
  const body = await request.json();
  const { entries, snapshotDate } = body as {
    entries: Array<{
      accountId: number;
      balance: number;
      currency: string;
    }>;
    snapshotDate: string;
  };

  if (!entries || !snapshotDate) {
    return NextResponse.json(
      { error: "entries and snapshotDate are required" },
      { status: 400 }
    );
  }

  const values = entries
    .filter((e) => e.balance !== null && e.balance !== undefined)
    .map((e) => ({
      accountId: e.accountId,
      balance: String(e.balance),
      currency: e.currency as "USD" | "ILS",
      snapshotDate,
    }));

  if (values.length > 0) {
    // One row per account per day: re-recording updates the existing row
    // (enforced by the unique index on account_id + snapshot_date).
    await db
      .insert(netWorthSnapshots)
      .values(values)
      .onConflictDoUpdate({
        target: [netWorthSnapshots.accountId, netWorthSnapshots.snapshotDate],
        set: {
          balance: sql`excluded.balance`,
          currency: sql`excluded.currency`,
          createdAt: sql`now()`,
        },
      });
  }

  return NextResponse.json({ created: values.length }, { status: 201 });
}

export async function DELETE(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id");

  if (!id) {
    return NextResponse.json({ error: "ID is required" }, { status: 400 });
  }

  await db
    .delete(netWorthSnapshots)
    .where(eq(netWorthSnapshots.id, parseInt(id)));
  return NextResponse.json({ success: true });
}
