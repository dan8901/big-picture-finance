import * as XLSX from "xlsx";
import type { Parser, ParsedTransaction } from "./types";
import { mapCurrencySymbol } from "./currency-utils";

export const maxParser: Parser = {
  name: "Max",
  institution: "max",
  supportedFormats: ["xlsx"],
  async parse(file: Buffer, filename: string): Promise<ParsedTransaction[]> {
    const wb = XLSX.read(file, { type: "buffer" });
    const transactions: ParsedTransaction[] = [];

    // Process all sheets (domestic + foreign transactions)
    for (const sheetName of wb.SheetNames) {
      const ws = wb.Sheets[sheetName];
      const rows = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1 });

      // Find header row (contains "תאריך עסקה")
      let headerIdx = -1;
      for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        if (Array.isArray(row) && row[0] === "תאריך עסקה") {
          headerIdx = i;
          break;
        }
      }

      if (headerIdx === -1) continue;

      // Columns: [תאריך עסקה, שם בית העסק, קטגוריה, 4 ספרות, סוג עסקה, סכום חיוב, מטבע חיוב, סכום מקורי, מטבע מקורי, תאריך חיוב, הערות, ...]
      for (let i = headerIdx + 1; i < rows.length; i++) {
        const row = rows[i];
        if (!row || !Array.isArray(row)) continue;

        const dateStr = row[0]; // DD-MM-YYYY
        const description = row[1];
        const category = row[2];
        const chargeAmount = row[5]; // סכום חיוב (in ILS)
        const origAmount = row[7]; // סכום עסקה מקורי
        const origCurrencyRaw = row[8]; // מטבע עסקה מקורי

        // Skip empty rows, summary rows
        if (typeof dateStr !== "string" || !dateStr) continue;
        if (typeof description !== "string" || !description) continue;
        if (typeof chargeAmount !== "number") continue;
        if (description === "סך הכל") continue;

        // Parse date DD-MM-YYYY
        const match = dateStr.match(/^(\d{2})-(\d{2})-(\d{4})$/);
        if (!match) continue;

        const day = parseInt(match[1]);
        const month = parseInt(match[2]) - 1;
        const year = parseInt(match[3]);
        const date = new Date(year, month, day);

        // Detect foreign currency
        const origCurrency = mapCurrencySymbol(typeof origCurrencyRaw === "string" ? origCurrencyRaw.trim() : "");
        const hasForeignCurrency = origCurrency && origCurrency !== "ILS" && typeof origAmount === "number";

        // chargeAmount is positive for charges, negative for credits
        // Store expenses as negative
        transactions.push({
          date,
          amount: -chargeAmount,
          currency: "ILS",
          description: description.trim(),
          category: typeof category === "string" ? category : undefined,
          ...(hasForeignCurrency ? { originalCurrency: origCurrency, originalAmount: -origAmount } : {}),
        });
      }
    }

    return transactions;
  },
};
