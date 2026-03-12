import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { goals } from "@/db/schema";
import { eq } from "drizzle-orm";

export async function PATCH(request: NextRequest) {
  const { orderedIds } = (await request.json()) as { orderedIds: number[] };

  await Promise.all(
    orderedIds.map((id, index) =>
      db.update(goals).set({ sortOrder: index }).where(eq(goals.id, id))
    )
  );

  return NextResponse.json({ ok: true });
}
