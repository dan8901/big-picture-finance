import type { Parser, ParsedTransaction } from "./types";
import { parseCSVLine } from "./csv-utils";

export const interactiveBrokersParser: Parser = {
  name: "Interactive Brokers",
  institution: "interactive-brokers",
  supportedFormats: ["csv"],
  async parse(file: Buffer, filename: string): Promise<ParsedTransaction[]> {
    const text = file.toString("utf-8");
    const lines = text.split("\n");
    const transactions: ParsedTransaction[] = [];

    // Find Transaction History data rows
    // Header: Transaction History,Header,Date,Account,Description,Transaction Type,Symbol,Quantity,Price,Price Currency,Gross Amount,Commission,Net Amount
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;

      const fields = parseCSVLine(line);

      // Only process Transaction History Data rows
      if (fields[0] !== "Transaction History" || fields[1] !== "Data") continue;

      const dateStr = fields[2]; // YYYY-MM-DD
      const description = fields[4];
      const transactionType = fields[5];
      const symbol = fields[6];
      const netAmountStr = fields[12];

      if (!dateStr || !description) continue;

      const match = dateStr.match(/^(\d{4})-(\d{2})-(\d{2})$/);
      if (!match) continue;

      const netAmount = parseFloat(netAmountStr);
      if (isNaN(netAmount)) continue;

      const date = new Date(
        parseInt(match[1]),
        parseInt(match[2]) - 1,
        parseInt(match[3])
      );

      // Build a descriptive label
      let fullDescription = description;
      if (symbol && symbol !== "-") {
        fullDescription = `[${symbol}] ${description}`;
      }
      if (transactionType && transactionType !== "-") {
        fullDescription += ` (${transactionType})`;
      }

      // Auto-exclude non-income/expense transactions
      const excludedTypes = new Set([
        "Buy",
        "Sell",
        "Forex Trade Component",
        "Cash Settlement",
        "Cash Transfer",
        "Adjustment",
      ]);
      const excluded = excludedTypes.has(transactionType);

      // Net amount is already signed: positive = money in, negative = money out
      transactions.push({
        date,
        amount: netAmount,
        currency: "USD",
        description: fullDescription,
        category: transactionType,
        excluded,
      });
    }

    return transactions;
  },
};
