import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { accounts, transactions, netWorthSnapshots } from "@/db/schema";
import { eq } from "drizzle-orm";

export async function GET() {
  const allAccounts = await db.select().from(accounts).orderBy(accounts.name);
  return NextResponse.json(allAccounts);
}

import { TRANSACTION_ACCOUNT_TYPES } from "@/lib/accounts";

const INSTITUTION_LABELS: Record<string, string> = {
  isracard: "Isracard",
  cal: "Cal",
  max: "Max",
  discover: "Discover",
  sdfcu: "State Dept FCU",
  fidelity: "Fidelity",
  "bank-hapoalim": "Bank Hapoalim",
  pepper: "Pepper Bank",
};

export async function POST(request: NextRequest) {
  const body = await request.json();
  const { name, type, institution, currency, owner } = body;

  const isTransaction = (TRANSACTION_ACCOUNT_TYPES as readonly string[]).includes(type);

  if (!type || !currency || !owner) {
    return NextResponse.json(
      { error: "Type, currency, and owner are required" },
      { status: 400 }
    );
  }

  if (isTransaction && !institution) {
    return NextResponse.json(
      { error: "Institution is required for transaction accounts" },
      { status: 400 }
    );
  }

  if (!isTransaction && !name?.trim()) {
    return NextResponse.json(
      { error: "Name is required for balance-only accounts" },
      { status: 400 }
    );
  }

  const resolvedName = name?.trim()
    || (institution ? `${INSTITUTION_LABELS[institution] ?? institution} - ${owner}` : type);

  const [newAccount] = await db
    .insert(accounts)
    .values({
      name: resolvedName,
      type,
      institution: isTransaction ? institution : null,
      currency,
      owner,
    })
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
