import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { accounts, transactions, netWorthSnapshots } from "@/db/schema";
import { eq } from "drizzle-orm";

export async function GET() {
  const allAccounts = await db.select().from(accounts).orderBy(accounts.name);
  return NextResponse.json(allAccounts);
}

const INSTITUTION_LABELS: Record<string, string> = {
  isracard: "Isracard",
  cal: "Cal",
  max: "Max",
  discover: "Discover",
  sdfcu: "State Dept FCU",
  fidelity: "Fidelity",
  "bank-hapoalim": "Bank Hapoalim",
  pepper: "Pepper Bank",
  "interactive-brokers": "Interactive Brokers",
  meitav: "Meitav",
  harel: "Harel",
};

export async function POST(request: NextRequest) {
  const body = await request.json();
  const { name, type, institution, currency, owner } = body;

  if (!type || !institution || !currency || !owner) {
    return NextResponse.json(
      { error: "Type, institution, currency, and owner are required" },
      { status: 400 }
    );
  }

  const resolvedName =
    name?.trim() || `${INSTITUTION_LABELS[institution] ?? institution} - ${owner}`;

  const [newAccount] = await db
    .insert(accounts)
    .values({ name: resolvedName, type, institution, currency, owner })
    .returning();

  return NextResponse.json(newAccount, { status: 201 });
}

export async function DELETE(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id");

  if (!id) {
    return NextResponse.json({ error: "ID is required" }, { status: 400 });
  }

  const accountId = parseInt(id);

  // Delete related records first (FK constraints)
  await db.delete(transactions).where(eq(transactions.accountId, accountId));
  await db
    .delete(netWorthSnapshots)
    .where(eq(netWorthSnapshots.accountId, accountId));

  await db.delete(accounts).where(eq(accounts.id, accountId));
  return NextResponse.json({ success: true });
}
