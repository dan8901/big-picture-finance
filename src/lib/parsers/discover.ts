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

export const discoverParser: Parser = {
  name: "Discover",
  institution: "discover",
  supportedFormats: ["csv"],
  async parse(file: Buffer, filename: string): Promise<ParsedTransaction[]> {
    const text = file.toString("utf-8");
    const lines = text.split("\n");
    const transactions: ParsedTransaction[] = [];

    // Row 0: headers (Trans. Date,Post Date,Description,Amount,Category)
    for (let i = 1; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;

      const fields = parseCSVLine(line);
      if (fields.length < 5) continue;

      const dateStr = fields[0]; // MM/DD/YYYY
      const description = fields[2];
      const amount = parseFloat(fields[3]);
      const category = fields[4];

      if (!dateStr || isNaN(amount)) continue;

      const match = dateStr.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
      if (!match) continue;

      const date = new Date(
        parseInt(match[3]),
        parseInt(match[1]) - 1,
        parseInt(match[2])
      );

      // Discover: positive = charge, negative = payment/credit
      // We store expenses as negative, so flip the sign
      transactions.push({
        date,
        amount: -amount,
        currency: "USD",
        description,
        category,
      });
    }

    return transactions;
  },
};
