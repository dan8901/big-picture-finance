import { NextResponse } from "next/server";
import { db } from "@/db";
import { importLogs, accounts } from "@/db/schema";
import { desc, eq } from "drizzle-orm";

export async function GET() {
  const logs = await db
    .select({
      id: importLogs.id,
      accountId: importLogs.accountId,
      accountName: accounts.name,
      filename: importLogs.filename,
      parser: importLogs.parser,
      totalRows: importLogs.totalRows,
      importedRows: importLogs.importedRows,
      duplicateRows: importLogs.duplicateRows,
      createdAt: importLogs.createdAt,
    })
    .from(importLogs)
    .innerJoin(accounts, eq(importLogs.accountId, accounts.id))
    .orderBy(desc(importLogs.createdAt))
    .limit(50);

  return NextResponse.json(logs);
}
