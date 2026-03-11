import type { Parser, ParsedTransaction } from "./types";

export const harelParser: Parser = {
  name: "Harel",
  institution: "harel",
  supportedFormats: ["xlsx", "pdf"],
  async parse(file: Buffer, filename: string): Promise<ParsedTransaction[]> {
    // TODO: Implement with sample file
    throw new Error("Harel parser not yet implemented");
  },
};
