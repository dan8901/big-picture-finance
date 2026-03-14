import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { appConfig } from "@/db/schema";

export async function GET() {
  const rows = await db.select().from(appConfig);
  const config = rows[0] ?? { allStartDate: null };
  return NextResponse.json({ allStartDate: config.allStartDate });
}

export async function PUT(request: NextRequest) {
  const body = await request.json();
  const { allStartDate } = body;

  await db.delete(appConfig);
  if (allStartDate) {
    await db.insert(appConfig).values({ allStartDate });
  }

  return NextResponse.json({ allStartDate: allStartDate ?? null });
}
