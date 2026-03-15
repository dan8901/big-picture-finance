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
  const { name, type, startDate, endDate, destination } = body;

  if (!name || !type || !startDate) {
    return NextResponse.json(
      { error: "name, type, and startDate are required" },
      { status: 400 }
    );
  }

  const [event] = await db
    .insert(events)
    .values({ name, type, startDate, endDate: endDate || null, destination: destination || null })
    .returning();

  return NextResponse.json(event, { status: 201 });
}

export async function PUT(request: NextRequest) {
  const body = await request.json();
  const { id, name, startDate, endDate, destination } = body;

  if (!id) {
    return NextResponse.json({ error: "id is required" }, { status: 400 });
  }

  const updates: Record<string, unknown> = {};
  if (name !== undefined) updates.name = name;
  if (startDate !== undefined) updates.startDate = startDate;
  if (endDate !== undefined) updates.endDate = endDate || null;
  if (destination !== undefined) updates.destination = destination || null;

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: "No fields to update" }, { status: 400 });
  }

  const [updated] = await db
    .update(events)
    .set(updates)
    .where(eq(events.id, id))
    .returning();

  if (!updated) {
    return NextResponse.json({ error: "Event not found" }, { status: 404 });
  }

  return NextResponse.json(updated);
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
