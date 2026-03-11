import type { Parser } from "./types";
import { isracardParser } from "./isracard";
import { calParser } from "./cal";
import { maxParser } from "./max";
import { discoverParser } from "./discover";
import { sdfcuParser } from "./sdfcu";
import { fidelityParser } from "./fidelity";
import { bankHapoalimParser } from "./bank-hapoalim";
import { pepperParser } from "./pepper";
import { interactiveBrokersParser } from "./interactive-brokers";
import { meitavParser } from "./meitav";
import { harelParser } from "./harel";

export const parsers: Record<string, Parser> = {
  isracard: isracardParser,
  cal: calParser,
  max: maxParser,
  discover: discoverParser,
  sdfcu: sdfcuParser,
  fidelity: fidelityParser,
  "bank-hapoalim": bankHapoalimParser,
  pepper: pepperParser,
  "interactive-brokers": interactiveBrokersParser,
  meitav: meitavParser,
  harel: harelParser,
};

export function getParser(institution: string): Parser | undefined {
  return parsers[institution];
}

export function listParsers(): Parser[] {
  return Object.values(parsers);
}
