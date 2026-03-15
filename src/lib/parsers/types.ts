export interface ParsedTransaction {
  date: Date;
  amount: number;
  currency: "USD" | "ILS";
  description: string;
  category?: string;
  excluded?: boolean;
  originalCurrency?: string;
  originalAmount?: number;
}

export interface Parser {
  name: string;
  institution: string;
  supportedFormats: ("csv" | "xlsx" | "pdf")[];
  parse(file: Buffer, filename: string): Promise<ParsedTransaction[]>;
}
