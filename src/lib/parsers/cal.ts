import * as XLSX from "xlsx";
import type { Parser, ParsedTransaction } from "./types";
import { mapCurrencySymbol } from "./currency-utils";

function excelDateToJS(serial: number): Date {
  return new Date((serial - 25569) * 86400000);
}

export const calParser: Parser = {
  name: "Cal",
  institution: "cal",
  supportedFormats: ["xlsx"],
  async parse(file: Buffer, filename: string): Promise<ParsedTransaction[]> {
    const wb = XLSX.read(file, { type: "buffer" });
    const ws = wb.Sheets[wb.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1 });

    const transactions: ParsedTransaction[] = [];

    // Row 0: title, Row 1: headers, Row 2+: data
    // Columns: [date, merchant, amount, card, chargeDate, type, digitalWalletId, discount, notes]
    for (let i = 2; i < rows.length; i++) {
      const row = rows[i];
      if (!row || !Array.isArray(row)) continue;

      const dateVal = row[0];
      const description = row[1];
      const amount = row[2];
      const notes = row[8];

      // Skip empty rows, summary rows, and footer text
      if (typeof dateVal !== "number" || typeof amount !== "number") continue;
      if (typeof description !== "string" || !description) continue;

      const date = excelDateToJS(dateVal);

      // Check notes for foreign currency info (e.g. "סכום העסקה הוא 61.63 $")
      let originalCurrency: string | undefined;
      let originalAmount: number | undefined;
      if (typeof notes === "string") {
        const foreignMatch = notes.match(/סכום העסקה הוא\s+([\d.]+)\s*([$€£])/);
        if (foreignMatch) {
          const mapped = mapCurrencySymbol(foreignMatch[2]);
          if (mapped && mapped !== "ILS") {
            originalCurrency = mapped;
            originalAmount = -parseFloat(foreignMatch[1]); // negative for expenses
          }
        }
      }

      // Amounts are positive for charges, negative for credits/refunds
      // We store expenses as negative, so flip the sign
      transactions.push({
        date,
        amount: -amount,
        currency: "ILS",
        description: description.trim(),
        ...(originalCurrency ? { originalCurrency, originalAmount } : {}),
      });
    }

    return transactions;
  },
};
