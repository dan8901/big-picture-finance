const CURRENCY_SYMBOL_MAP: Record<string, string> = {
  "$": "USD",
  "€": "EUR",
  "£": "GBP",
  "₪": "ILS",
};

/** Map a currency symbol (e.g. "$", "€") to its ISO code. Returns null for ILS or unknown symbols. */
export function mapCurrencySymbol(symbol: string): string | null {
  return CURRENCY_SYMBOL_MAP[symbol] ?? null;
}
