import type { Parser, ParsedTransaction } from "./types";
import { parseCSVLine } from "./csv-utils";

function parseDollarAmount(str: string): number | null {
  // Handle "$1,000.00" or "-$5.00"
  const cleaned = str.replace(/[$,]/g, "");
  const num = parseFloat(cleaned);
  return isNaN(num) ? null : num;
}

export const sdfcuParser: Parser = {
  name: "State Department FCU",
  institution: "sdfcu",
  supportedFormats: ["csv"],
  async parse(file: Buffer, filename: string): Promise<ParsedTransaction[]> {
    const text = file.toString("utf-8");
    const lines = text.split("\n");
    const transactions: ParsedTransaction[] = [];

    // Header: Account ID, Transaction ID, Date, Description, Check Number, Category, Tags, Amount, Balance
    for (let i = 1; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;

      const fields = parseCSVLine(line);
      if (fields.length < 9) continue;

      const dateStr = fields[2]; // MM/DD/YY
      const description = fields[3];
      const category = fields[5];
      const amountStr = fields[7];

      const match = dateStr.match(/^(\d{2})\/(\d{2})\/(\d{2})$/);
      if (!match) continue;

      const amount = parseDollarAmount(amountStr);
      if (amount === null) continue;

      const year = 2000 + parseInt(match[3]);
      const date = new Date(year, parseInt(match[1]) - 1, parseInt(match[2]));

      // Amount is already signed: positive = deposit, negative = withdrawal
      transactions.push({
        date,
        amount,
        currency: "USD",
        description: description.trim(),
        category: category || undefined,
      });
    }

    return transactions;
  },
};
