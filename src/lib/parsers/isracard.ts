import * as XLSX from "xlsx";
import type { Parser, ParsedTransaction } from "./types";
import { mapCurrencySymbol } from "./currency-utils";

export const isracardParser: Parser = {
  name: "Isracard",
  institution: "isracard",
  supportedFormats: ["xlsx"],
  async parse(file: Buffer, filename: string): Promise<ParsedTransaction[]> {
    const wb = XLSX.read(file, { type: "buffer" });
    const ws = wb.Sheets[wb.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1 });

    const transactions: ParsedTransaction[] = [];

    // Find the header row (contains "תאריך רכישה")
    let headerIdx = -1;
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      if (Array.isArray(row) && row[0] === "תאריך רכישה") {
        headerIdx = i;
        break;
      }
    }

    if (headerIdx === -1) {
      throw new Error("Could not find header row in Isracard file");
    }

    // Columns: [תאריך רכישה, שם בית עסק, סכום עסקה, מטבע עסקה, סכום חיוב, מטבע חיוב, מס' שובר, פירוט נוסף]
    for (let i = headerIdx + 1; i < rows.length; i++) {
      const row = rows[i];
      if (!row || !Array.isArray(row)) continue;

      const dateStr = row[0];
      const description = row[1];
      const origAmount = row[2]; // סכום עסקה (original amount)
      const origCurrencyRaw = row[3]; // מטבע עסקה (original currency)
      const chargeAmount = row[4]; // סכום חיוב (in ILS)
      const chargeCurrency = row[5]; // מטבע חיוב

      // Skip empty rows, summary rows, and footer
      if (typeof dateStr !== "string" || !dateStr) continue;
      if (typeof description !== "string" || !description) continue;
      if (typeof chargeAmount !== "number") continue;
      // Skip summary row (e.g. "סה"כ לחיוב")
      if (description.includes("סה\"כ")) continue;
      if (chargeAmount === 0) continue;

      // Parse date DD.MM.YY
      const match = dateStr.match(/^(\d{2})\.(\d{2})\.(\d{2})$/);
      if (!match) continue;

      const day = parseInt(match[1]);
      const month = parseInt(match[2]) - 1;
      const year = 2000 + parseInt(match[3]);
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
        ...(hasForeignCurrency ? { originalCurrency: origCurrency, originalAmount: -origAmount } : {}),
      });
    }

    return transactions;
  },
};
