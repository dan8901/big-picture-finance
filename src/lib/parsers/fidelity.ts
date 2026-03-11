import type { Parser, ParsedTransaction } from "./types";

function parseCSVLine(line: string): string[] {
  const fields: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      inQuotes = !inQuotes;
    } else if (ch === "," && !inQuotes) {
      fields.push(current.trim());
      current = "";
    } else {
      current += ch;
    }
  }
  fields.push(current.trim());
  return fields;
}

export const fidelityParser: Parser = {
  name: "Fidelity",
  institution: "fidelity",
  supportedFormats: ["csv"],
  async parse(file: Buffer, filename: string): Promise<ParsedTransaction[]> {
    const text = file.toString("utf-8");
    const lines = text.split("\n");
    const transactions: ParsedTransaction[] = [];

    // Find the header row (starts with "Run Date")
    let headerIdx = -1;
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].trim().startsWith("Run Date")) {
        headerIdx = i;
        break;
      }
    }

    if (headerIdx === -1) {
      throw new Error("Could not find header row in Fidelity file");
    }

    // Headers: Run Date, Action, Symbol, Description, Type, Price ($), Quantity, Commission ($), Fees ($), Accrued Interest ($), Amount ($), Cash Balance ($), Settlement Date
    for (let i = headerIdx + 1; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;

      const fields = parseCSVLine(line);
      if (fields.length < 12) continue;

      const dateStr = fields[0]; // MM/DD/YYYY
      const action = fields[1];
      const amountStr = fields[10];

      // Stop at footer (lines starting with quotes that aren't data)
      if (dateStr.startsWith('"') && !dateStr.match(/^\d/)) break;

      const match = dateStr.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
      if (!match) continue;

      const amount = parseFloat(amountStr);
      if (isNaN(amount)) continue;

      const date = new Date(
        parseInt(match[3]),
        parseInt(match[1]) - 1,
        parseInt(match[2])
      );

      // Amount is already signed: positive = money in, negative = money out
      transactions.push({
        date,
        amount,
        currency: "USD",
        description: action.replace(/\s*\(Cash\)\s*$/, "").trim(),
      });
    }

    return transactions;
  },
};
