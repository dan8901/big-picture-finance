import type { Parser, ParsedTransaction } from "./types";

interface PdfTextItem {
  str: string;
  dir: string;
  transform: number[];
  width: number;
}

async function extractTextWithLayout(buffer: Buffer): Promise<string> {
  const pdfjsLib = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const data = new Uint8Array(buffer);
  const doc = await pdfjsLib.getDocument({ data, useSystemFonts: true }).promise;

  const allLines: string[] = [];

  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();

    const items = content.items.filter(
      (item) => "str" in item && (item as PdfTextItem).str.length > 0
    ) as PdfTextItem[];

    // Group by y-coordinate (tolerance ~3 units for same line)
    const lineMap = new Map<number, PdfTextItem[]>();
    for (const item of items) {
      const y = Math.round(item.transform[5]);
      let matched = false;
      for (const [key, group] of lineMap) {
        if (Math.abs(y - key) < 3) {
          group.push(item);
          matched = true;
          break;
        }
      }
      if (!matched) {
        lineMap.set(y, [item]);
      }
    }

    const sortedLines = [...lineMap.entries()].sort(([a], [b]) => b - a);

    for (const [, lineItems] of sortedLines) {
      // Sort items by x DESCENDING — right-to-left reading order for Hebrew document.
      // This naturally gives correct reading order for Hebrew descriptions and
      // proper BiDi ordering for mixed Hebrew/English text.
      lineItems.sort((a, b) => b.transform[4] - a.transform[4]);

      // Join with spacing based on right-to-left gaps.
      // Gap = previous item's left edge - current item's right edge.
      // Large gaps indicate column separators.
      let lineText = "";
      let prevLeftEdge = 0;
      let first = true;
      for (const item of lineItems) {
        const x = item.transform[4]; // left edge of this item
        const w = item.width ?? item.str.length * 5;
        const rightEdge = x + w;

        if (!first) {
          const gap = prevLeftEdge - rightEdge;
          if (gap > 5) {
            const spaces = Math.max(1, Math.round(gap / 5));
            lineText += " ".repeat(spaces);
          }
        }

        lineText += item.str;
        prevLeftEdge = x;
        first = false;
      }
      allLines.push(lineText);
    }
  }

  return allLines.join("\n");
}

export const pepperParser: Parser = {
  name: "Pepper Bank",
  institution: "pepper",
  supportedFormats: ["pdf"],
  async parse(file: Buffer, filename: string): Promise<ParsedTransaction[]> {
    const text = await extractTextWithLayout(file);

    // Clean RTL markers
    const clean = text.replace(
      /[\u200f\u200e\u202a\u202b\u202c\u2069\u2068\u2067\u2066]/g,
      ""
    );
    const lines = clean.split("\n");

    const transactions: ParsedTransaction[] = [];
    const dateRe = /(\d{1,2}\.\d{1,2}\.\d{4})/;
    // With x-descending sort, amounts appear as "75₪" (number before ₪)
    const amountRe = /([-\d,.]+)₪/g;

    for (const line of lines) {
      const dateMatch = line.match(dateRe);
      if (!dateMatch) continue;

      // Find all amounts on this line
      const amounts = [...line.matchAll(amountRe)].map((m) =>
        parseFloat(m[1].replace(/,/g, ""))
      );
      // Need both transaction amount and balance columns
      if (amounts.length < 2) continue;

      // Extract description: remove date, amounts, and reference numbers
      const description = line
        .replace(dateRe, "")
        .replace(/[-\d,.]+₪/g, "")
        .replace(/\d{4,}/g, "")
        .replace(/\s+/g, " ")
        .trim();

      if (!description) continue;

      const [dayStr, monthStr, yearStr] = dateMatch[1].split(".");
      const date = new Date(
        parseInt(yearStr),
        parseInt(monthStr) - 1,
        parseInt(dayStr)
      );

      // With x-descending, first ₪ value is the transaction amount (higher x),
      // second is the balance (lower x)
      const amount = amounts[0];
      if (isNaN(amount)) continue;

      transactions.push({
        date,
        amount,
        currency: "ILS",
        description,
      });
    }

    return transactions;
  },
};
