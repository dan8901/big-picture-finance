import {
  pgTable,
  serial,
  text,
  timestamp,
  numeric,
  date,
  integer,
  json,
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
  institution: text("institution"),
  currency: text("currency", { enum: ["USD", "ILS"] }).notNull(),
  owner: text("owner").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const categories = pgTable("categories", {
  id: serial("id").primaryKey(),
  name: text("name").notNull().unique(),
  parentCategory: text("parent_category"),
  isDefault: integer("is_default").default(0).notNull(),
  sortOrder: integer("sort_order").default(0).notNull(),
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
  note: text("note"),
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
    displayName: text("display_name"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [uniqueIndex("merchant_name_idx").on(table.merchantName)]
);

export const chatSessions = pgTable("chat_sessions", {
  id: serial("id").primaryKey(),
  title: text("title").notNull(),
  messages: json("messages").notNull().$type<Array<{ role: string; content: string }>>(),
  summary: text("summary"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const goals = pgTable("goals", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  type: text("type", { enum: ["budget_cap", "savings_target", "savings_amount"] }).notNull(),
  scope: text("scope", { enum: ["overall", "category"] }).notNull(),
  category: text("category"),
  owner: text("owner"),
  targetAmount: numeric("target_amount", { precision: 12, scale: 2 }).notNull(),
  currency: text("currency", { enum: ["USD", "ILS"] }).notNull(),
  period: text("period", { enum: ["monthly", "annual"] }).notNull(),
  isActive: integer("is_active").default(1).notNull(),
  sortOrder: integer("sort_order").default(0).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const goalAchievements = pgTable(
  "goal_achievements",
  {
    id: serial("id").primaryKey(),
    goalId: integer("goal_id")
      .references(() => goals.id, { onDelete: "cascade" })
      .notNull(),
    period: text("period").notNull(), // "2025-09" or "2025"
    achieved: integer("achieved").default(0).notNull(),
    actualAmount: numeric("actual_amount", { precision: 12, scale: 2 }).notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("goal_achievement_idx").on(table.goalId, table.period),
  ]
);

export const llmConfig = pgTable("llm_config", {
  id: serial("id").primaryKey(),
  provider: text("provider", {
    enum: ["openai", "anthropic", "nvidia", "deepseek", "openrouter", "ollama", "groq", "together", "fireworks", "mistral", "perplexity", "google", "cohere", "azure", "aws-bedrock", "lmstudio", "custom"],
  }).notNull(),
  apiKey: text("api_key").notNull(),
  baseUrl: text("base_url"),
  model: text("model").notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const llmUsageLogs = pgTable("llm_usage_logs", {
  id: serial("id").primaryKey(),
  feature: text("feature", { enum: ["chat", "categorize"] }).notNull(),
  model: text("model").notNull(),
  inputTokens: integer("input_tokens").notNull(),
  outputTokens: integer("output_tokens").notNull(),
  estimatedCost: numeric("estimated_cost", { precision: 10, scale: 6 }).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const appConfig = pgTable("app_config", {
  id: serial("id").primaryKey(),
  allStartDate: date("all_start_date"),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

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
