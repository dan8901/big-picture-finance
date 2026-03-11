import type { Parser, ParsedTransaction } from "./types";

export const meitavParser: Parser = {
  name: "Meitav",
  institution: "meitav",
  supportedFormats: ["xlsx", "pdf"],
  async parse(file: Buffer, filename: string): Promise<ParsedTransaction[]> {
    // TODO: Implement with sample file
    throw new Error("Meitav parser not yet implemented");
  },
};
