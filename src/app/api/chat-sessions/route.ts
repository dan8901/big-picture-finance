import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { chatSessions } from "@/db/schema";
import { eq, desc } from "drizzle-orm";

// GET: list all chat sessions
export async function GET() {
  const sessions = await db
    .select({
      id: chatSessions.id,
      title: chatSessions.title,
      updatedAt: chatSessions.updatedAt,
      messages: chatSessions.messages,
    })
    .from(chatSessions)
    .orderBy(desc(chatSessions.updatedAt));

  return NextResponse.json(
    sessions.map((s) => ({
      id: s.id,
      title: s.title,
      updatedAt: s.updatedAt,
      messageCount: s.messages.length,
    }))
  );
}

// POST: create or update a chat session
export async function POST(request: NextRequest) {
  const body = await request.json();
  const { id, messages } = body as {
    id?: number;
    messages: Array<{ role: string; content: string }>;
  };

  if (!messages || messages.length === 0) {
    return NextResponse.json({ error: "No messages" }, { status: 400 });
  }

  if (id) {
    // Update existing session
    await db
      .update(chatSessions)
      .set({ messages, updatedAt: new Date() })
      .where(eq(chatSessions.id, id));
    return NextResponse.json({ id });
  }

  // Create new session — title from first user message
  const firstUserMsg = messages.find((m) => m.role === "user");
  const title = firstUserMsg
    ? firstUserMsg.content.slice(0, 60) + (firstUserMsg.content.length > 60 ? "..." : "")
    : "New Chat";

  const result = await db
    .insert(chatSessions)
    .values({ title, messages })
    .returning({ id: chatSessions.id, title: chatSessions.title });

  return NextResponse.json(result[0]);
}

// DELETE: delete a chat session
export async function DELETE(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id");

  if (!id) {
    return NextResponse.json({ error: "Missing id" }, { status: 400 });
  }

  await db.delete(chatSessions).where(eq(chatSessions.id, parseInt(id)));
  return NextResponse.json({ deleted: true });
}

// PUT: load a specific session's messages
export async function PUT(request: NextRequest) {
  const body = await request.json();
  const { id } = body as { id: number };

  const rows = await db
    .select()
    .from(chatSessions)
    .where(eq(chatSessions.id, id));

  if (rows.length === 0) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return NextResponse.json({
    id: rows[0].id,
    title: rows[0].title,
    messages: rows[0].messages,
  });
}
