import { NextResponse } from "next/server";
import { parsers } from "@/lib/parsers";

export async function GET() {
  const formats: Record<string, string[]> = {};
  for (const [institution, parser] of Object.entries(parsers)) {
    formats[institution] = parser.supportedFormats;
  }
  return NextResponse.json(formats);
}
