import type { Parser, ParsedTransaction } from "./types";

export const bankHapoalimParser: Parser = {
  name: "Bank Hapoalim",
  institution: "bank-hapoalim",
  supportedFormats: ["csv"],
  async parse(file: Buffer, filename: string): Promise<ParsedTransaction[]> {
    const text = file.toString("utf-8");
    const lines = text.split("\n");
    const transactions: ParsedTransaction[] = [];

    // Row 0: headers (תאריך,תיאור הפעולה,פרטים,חשבון,אסמכתא,תאריך ערך,חובה,זכות,יתרה לאחר פעולה,)
    // Row 1+: data
    for (let i = 1; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;

      // Parse CSV - fields may contain commas inside descriptions
      // Format: date, description, details, account, reference, valueDate, debit, credit, balance,
      const parts = line.split(",");
      if (parts.length < 9) continue;

      const dateStr = parts[0].trim();
      const description = parts[1].trim();
      const details = parts[2].trim();
      // parts[3] = account, parts[4] = reference, parts[5] = value date
      const debitStr = parts[6].trim();
      const creditStr = parts[7].trim();

      // Validate date format YYYY-MM-DD
      if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) continue;

      const date = new Date(dateStr);
      if (isNaN(date.getTime())) continue;

      // Debit = money out (expense), Credit = money in (income)
      let amount: number;
      if (debitStr && parseFloat(debitStr)) {
        amount = -parseFloat(debitStr); // Expense: store as negative
      } else if (creditStr && parseFloat(creditStr)) {
        amount = parseFloat(creditStr); // Income: store as positive
      } else {
        continue; // No amount
      }

      // Combine description and details for more context
      const fullDescription = details
        ? `${description} - ${details}`
        : description;

      transactions.push({
        date,
        amount,
        currency: "ILS",
        description: fullDescription,
      });
    }

    return transactions;
  },
};
