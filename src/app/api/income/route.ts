import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { manualIncomeEntries } from "@/db/schema";
import { eq } from "drizzle-orm";

export async function GET() {
  const entries = await db
    .select()
    .from(manualIncomeEntries)
    .orderBy(manualIncomeEntries.startDate);
  return NextResponse.json(entries);
}

export async function POST(request: NextRequest) {
  const body = await request.json();
  const { source, label, monthlyAmount, currency, startDate, owner } = body;

  if (!source || !monthlyAmount || !currency || !startDate || !owner) {
    return NextResponse.json(
      { error: "source, monthlyAmount, currency, startDate, and owner are required" },
      { status: 400 }
    );
  }

  const [entry] = await db
    .insert(manualIncomeEntries)
    .values({ source, label, monthlyAmount, currency, startDate, owner })
    .returning();

  return NextResponse.json(entry, { status: 201 });
}

export async function PUT(request: NextRequest) {
  const body = await request.json();
  const { id, source, label, monthlyAmount, currency, startDate, owner } = body;

  if (!id) {
    return NextResponse.json({ error: "ID is required" }, { status: 400 });
  }

  await db
    .update(manualIncomeEntries)
    .set({ source, label, monthlyAmount, currency, startDate, owner })
    .where(eq(manualIncomeEntries.id, parseInt(id)));

  return NextResponse.json({ success: true });
}

export async function DELETE(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id");

  if (!id) {
    return NextResponse.json({ error: "ID is required" }, { status: 400 });
  }

  await db
    .delete(manualIncomeEntries)
    .where(eq(manualIncomeEntries.id, parseInt(id)));
  return NextResponse.json({ success: true });
}
