/**
 * Parse a single CSV line handling quoted fields.
 * @param trim - whether to trim whitespace from each field (default: true)
 */
export function parseCSVLine(line: string, trim = true): string[] {
  const fields: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      inQuotes = !inQuotes;
    } else if (ch === "," && !inQuotes) {
      fields.push(trim ? current.trim() : current);
      current = "";
    } else {
      current += ch;
    }
  }
  fields.push(trim ? current.trim() : current);
  return fields;
}
