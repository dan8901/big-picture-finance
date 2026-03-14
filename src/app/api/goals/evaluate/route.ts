import { NextRequest, NextResponse } from "next/server";
import { evaluateGoals } from "@/lib/evaluate-goals";

export async function POST(request: NextRequest) {
  const { periods } = (await request.json()) as { periods: string[] };
  const results = await evaluateGoals(periods);
  return NextResponse.json({ results });
}
