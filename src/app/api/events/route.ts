import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { events, transactions } from "@/db/schema";
import { eq } from "drizzle-orm";

export async function GET() {
  const allEvents = await db.select().from(events).orderBy(events.startDate);
  return NextResponse.json(allEvents);
}

export async function POST(request: NextRequest) {
  const body = await request.json();
  const { name, type, startDate, endDate } = body;

  if (!name || !type || !startDate) {
    return NextResponse.json(
      { error: "name, type, and startDate are required" },
      { status: 400 }
    );
  }

  const [event] = await db
    .insert(events)
    .values({ name, type, startDate, endDate: endDate || null })
    .returning();

  return NextResponse.json(event, { status: 201 });
}

export async function DELETE(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id");

  if (!id) {
    return NextResponse.json({ error: "ID is required" }, { status: 400 });
  }

  // Remove event reference from transactions first
  await db
    .update(transactions)
    .set({ eventId: null })
    .where(eq(transactions.eventId, parseInt(id)));

  await db.delete(events).where(eq(events.id, parseInt(id)));
  return NextResponse.json({ success: true });
}
