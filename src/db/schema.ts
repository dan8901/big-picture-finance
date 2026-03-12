import {
  pgTable,
  serial,
  text,
  timestamp,
  numeric,
  date,
  integer,
  uniqueIndex,
} from "drizzle-orm/pg-core";

export const accounts = pgTable("accounts", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  type: text("type", {
    enum: [
      "bank",
      "credit_card",
      "brokerage",
      "pension",
      "keren_hishtalmut",
    ],
  }).notNull(),
  institution: text("institution").notNull(),
  currency: text("currency", { enum: ["USD", "ILS"] }).notNull(),
  owner: text("owner").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const categories = pgTable("categories", {
  id: serial("id").primaryKey(),
  name: text("name").notNull().unique(),
  parentCategory: text("parent_category"),
  isDefault: integer("is_default").default(0).notNull(),
});

export const events = pgTable("events", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  type: text("type", { enum: ["trip", "one_time", "other"] }).notNull(),
  startDate: date("start_date").notNull(),
  endDate: date("end_date"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const transactions = pgTable("transactions", {
  id: serial("id").primaryKey(),
  accountId: integer("account_id")
    .references(() => accounts.id)
    .notNull(),
  date: date("date").notNull(),
  amount: numeric("amount", { precision: 12, scale: 2 }).notNull(),
  currency: text("currency", { enum: ["USD", "ILS"] }).notNull(),
  description: text("description").notNull(),
  category: text("category"),
  eventId: integer("event_id").references(() => events.id),
  sourceFile: text("source_file"),
  excluded: integer("excluded").default(0).notNull(),
  isRecurring: integer("is_recurring").default(0).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const exchangeRates = pgTable(
  "exchange_rates",
  {
    id: serial("id").primaryKey(),
    date: date("date").notNull(),
    fromCurrency: text("from_currency").notNull(),
    toCurrency: text("to_currency").notNull(),
    rate: numeric("rate", { precision: 12, scale: 6 }).notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("exchange_rate_date_pair_idx").on(
      table.date,
      table.fromCurrency,
      table.toCurrency
    ),
  ]
);

export const manualIncomeEntries = pgTable("manual_income_entries", {
  id: serial("id").primaryKey(),
  source: text("source", {
    enum: ["salary", "rsu", "espp", "pension", "keren_hishtalmut", "other"],
  }).notNull(),
  label: text("label"),
  monthlyAmount: numeric("monthly_amount", {
    precision: 12,
    scale: 2,
  }).notNull(),
  currency: text("currency", { enum: ["USD", "ILS"] }).notNull(),
  startDate: text("start_date").notNull(), // YYYY-MM format
  owner: text("owner").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const netWorthSnapshots = pgTable("net_worth_snapshots", {
  id: serial("id").primaryKey(),
  accountId: integer("account_id")
    .references(() => accounts.id)
    .notNull(),
  balance: numeric("balance", { precision: 14, scale: 2 }).notNull(),
  currency: text("currency", { enum: ["USD", "ILS"] }).notNull(),
  snapshotDate: date("snapshot_date").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const exclusionRules = pgTable(
  "exclusion_rules",
  {
    id: serial("id").primaryKey(),
    accountId: integer("account_id")
      .references(() => accounts.id)
      .notNull(),
    description: text("description").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("exclusion_rule_idx").on(table.accountId, table.description),
  ]
);

export const merchantCategories = pgTable(
  "merchant_categories",
  {
    id: serial("id").primaryKey(),
    merchantName: text("merchant_name").notNull(),
    category: text("category").notNull(),
    isUserOverride: integer("is_user_override").default(0).notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [uniqueIndex("merchant_name_idx").on(table.merchantName)]
);

export const importLogs = pgTable("import_logs", {
  id: serial("id").primaryKey(),
  accountId: integer("account_id")
    .references(() => accounts.id)
    .notNull(),
  filename: text("filename").notNull(),
  parser: text("parser").notNull(),
  totalRows: integer("total_rows").notNull(),
  importedRows: integer("imported_rows").notNull(),
  duplicateRows: integer("duplicate_rows").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});
