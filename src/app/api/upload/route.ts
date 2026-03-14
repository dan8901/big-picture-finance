import { NextRequest, NextResponse } from "next/server";
import { getParser } from "@/lib/parsers";

export async function POST(request: NextRequest) {
  const formData = await request.formData();
  const institution = formData.get("institution") as string;
  const files = formData.getAll("files") as File[];

  if (!institution || files.length === 0) {
    return NextResponse.json(
      { error: "Institution and at least one file are required" },
      { status: 400 }
    );
  }

  const parser = getParser(institution);
  if (!parser) {
    return NextResponse.json(
      { error: `No parser found for institution: ${institution}` },
      { status: 400 }
    );
  }

  const allTransactions = [];

  for (const file of files) {
    // Validate file format against parser's supported formats
    const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
    const normalizedExt = ext === "xls" ? "xlsx" : ext;
    if (!parser.supportedFormats.includes(normalizedExt as "csv" | "xlsx" | "pdf")) {
      const accepted = parser.supportedFormats.map((f) => f.toUpperCase()).join(", ");
      return NextResponse.json(
        { error: `"${file.name}" is not supported by the ${parser.name} parser. Accepted formats: ${accepted}` },
        { status: 400 }
      );
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    try {
      const transactions = await parser.parse(buffer, file.name);
      allTransactions.push(
        ...transactions
          .filter((t) => t.amount !== 0)
          .map((t) => ({
            ...t,
            date: `${t.date.getFullYear()}-${String(t.date.getMonth() + 1).padStart(2, "0")}-${String(t.date.getDate()).padStart(2, "0")}`,
            sourceFile: file.name,
          }))
      );
    } catch (error) {
      return NextResponse.json(
        {
          error: `Failed to parse ${file.name}: ${error instanceof Error ? error.message : "Unknown error"}`,
        },
        { status: 400 }
      );
    }
  }

  return NextResponse.json({
    transactions: allTransactions,
    fileCount: files.length,
    transactionCount: allTransactions.length,
  });
}
