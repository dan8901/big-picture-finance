import { readFileSync } from "fs";

interface PdfTextItem { str: string; dir: string; transform: number[]; width: number; }

async function extractTextWithLayout(buffer: Buffer): Promise<string> {
  const pdfjsLib = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const data = new Uint8Array(buffer);
  const doc = await (pdfjsLib as any).getDocument({ data, useSystemFonts: true }).promise;
  const allLines: string[] = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    const items = content.items.filter((item: any) => "str" in item && item.str.length > 0) as PdfTextItem[];
    const lineMap = new Map<number, PdfTextItem[]>();
    for (const item of items) {
      const y = Math.round(item.transform[5]);
      let matched = false;
      for (const [key, group] of lineMap) { if (Math.abs(y - key) < 3) { group.push(item); matched = true; break; } }
      if (!matched) lineMap.set(y, [item]);
    }
    const sortedLines = [...lineMap.entries()].sort(([a], [b]) => b - a);
    for (const [, lineItems] of sortedLines) {
      lineItems.sort((a, b) => b.transform[4] - a.transform[4]);
      let lineText = "";
      let prevLeftEdge = 0;
      let first = true;
      for (const item of lineItems) {
        const x = item.transform[4];
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

async function main() {
  const pdfPath = "/Users/dnissim/Downloads/דוח תנועות בחשבון.pdf";
  const buffer = readFileSync(pdfPath);
  const text = await extractTextWithLayout(buffer);

  const clean = text.replace(/[\u200f\u200e\u202a\u202b\u202c\u2069\u2068\u2067\u2066]/g, "");
  const lines = clean.split("\n");
  const dateRe = /(\d{1,2}\.\d{1,2}\.\d{4})/;
  const amountRe = /([-\d,.]+)₪/g;

  const parsed: { date: string; amount: number; description: string }[] = [];
  for (const line of lines) {
    const dateMatch = line.match(dateRe);
    if (!dateMatch) continue;
    const amounts = [...line.matchAll(amountRe)].map((m) => parseFloat(m[1].replace(/,/g, "")));
    if (amounts.length < 2) continue;
    const description = line.replace(dateRe, "").replace(/[-\d,.]+₪/g, "").replace(/\d{4,}/g, "").replace(/\s+/g, " ").trim();
    if (!description) continue;
    const [dayStr, monthStr, yearStr] = dateMatch[1].split(".");
    const date = new Date(parseInt(yearStr), parseInt(monthStr) - 1, parseInt(dayStr));
    const dateStr = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
    const amount = amounts[0];
    if (isNaN(amount)) continue;
    parsed.push({ date: dateStr, amount, description });
  }

  console.log("Count:", parsed.length);
  for (const t of parsed) {
    console.log(`${t.date} | ${t.amount} | ILS | ${t.description}`);
  }
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
