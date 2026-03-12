# Big Picture Finance

Annual financial review app for a dual-country (US/Israel) household with ~14 accounts across different institutions, countries, and people. Used once a year to upload reports, enter manual data, and see the big picture.

## Tech Stack

- **Next.js 16** (App Router) + **React 19** + **TypeScript**
- **shadcn/ui** + **Tailwind CSS v4** + **Recharts** for UI/charts
- **Drizzle ORM** + **Neon Postgres** (serverless)
- **SheetJS** (xlsx) + custom CSV parsers for file parsing
- **frankfurter.dev** API for daily ILS↔USD exchange rates (cached in DB)

## Project Structure

```
src/
├── app/
│   ├── page.tsx                    # Dashboard — income/expense/savings summary + charts
│   ├── layout.tsx                  # Root layout with sidebar nav
│   ├── upload/page.tsx             # File upload → parse → preview → import + history
│   ├── transactions/page.tsx       # Browse, filter, categorize, exclude, export transactions
│   ├── accounts/page.tsx           # Account CRUD
│   ├── income/page.tsx             # Manual income entries (salary, RSU, ESPP, pension)
│   ├── net-worth/page.tsx          # Prompted balance entry + net worth tracking
│   ├── excluded/page.tsx           # View and manage excluded transactions
│   ├── chat/page.tsx               # AI chatbot — ask natural language questions about finances
│   └── api/
│       ├── dashboard/route.ts      # Analytics: totals, breakdowns, trends, events, top txns
│       ├── transactions/route.ts   # GET (filtered), POST (bulk import w/ dedup + logging), DELETE
│       ├── transactions/bulk/route.ts # PATCH: bulk category/event/exclude updates
│       ├── upload/route.ts         # Parse files via parser registry
│       ├── accounts/route.ts       # CRUD
│       ├── income/route.ts         # CRUD + PUT for editing
│       ├── net-worth/route.ts      # CRUD with account joins
│       ├── events/route.ts         # CRUD for trip/event tagging
│       ├── exchange-rates/route.ts # GET (needed dates) + POST (fetch & cache rates)
│       ├── categorize/route.ts     # AI categorization + normalization + recurring detection
│       ├── chat/route.ts           # AI chatbot SSE endpoint (tool-calling loop)
│       ├── chat/tools.ts           # 8 query tools for chatbot (transactions, categories, trends, etc.)
│       └── import-history/route.ts # GET: recent import logs with account names
├── components/
│   ├── sidebar.tsx                 # Nav sidebar with SVG icons, collapsible, sync rates button
│   └── ui/                         # shadcn/ui components (don't edit directly)
├── db/
│   ├── schema.ts                   # All Drizzle table definitions
│   └── index.ts                    # Lazy DB singleton (Neon serverless)
└── lib/
    ├── utils.ts                    # cn() helper
    ├── exchange.ts                 # Exchange rate DB cache reader
    └── parsers/
        ├── types.ts                # ParsedTransaction, Parser interfaces
        ├── index.ts                # Parser registry (getParser, listParsers)
        ├── csv-utils.ts            # Shared parseCSVLine() for CSV parsers
        ├── cal.ts                  # ✅ Cal credit card (XLSX, Hebrew)
        ├── isracard.ts             # ✅ Isracard credit card (XLSX, Hebrew)
        ├── bank-hapoalim.ts        # ✅ Bank Hapoalim (CSV, Hebrew)
        ├── discover.ts             # ✅ Discover credit card (CSV)
        ├── sdfcu.ts                # ✅ State Dept FCU (CSV)
        ├── fidelity.ts             # ✅ Fidelity cash management (CSV)
        ├── interactive-brokers.ts  # ✅ IBKR (CSV, auto-excludes Buy/Sell/Forex)
        ├── max.ts                  # ✅ Max credit card (XLSX, Hebrew, 2 sheets)
        ├── pepper.ts               # ✅ Pepper Bank (PDF via pdftotext)
        ├── meitav.ts               # ❌ Stub
        └── harel.ts                # ❌ Stub
```

## Key Conventions

### Amounts
- **Expenses are negative, income is positive** throughout the entire codebase
- Parsers normalize to this convention regardless of source format
- Stored as `numeric(12,2)` in original currency (USD or ILS)

### Currency
- All amounts stored in original currency
- Dashboard converts ILS→USD using daily rates from fawazahmed0 currency API (CDN-cached)
- Rates cached in `exchange_rates` table — "Sync Rates" button in sidebar fetches missing dates
- `src/lib/exchange.ts` reads from DB cache only (no runtime API calls)
- Dashboard shows both USD and ILS totals using weighted average exchange rate

### Transaction Exclusion
- `excluded` column (0/1) on transactions table
- Excluded transactions are hidden from dashboard totals
- Visible on transactions page when "Show excluded" is checked (40% opacity, strikethrough)
- IBKR parser auto-excludes Buy, Sell, Forex Trade, Cash Settlement, Cash Transfer, Adjustment
- Users can "Exclude all with this description" (scoped to account)
- Exclusion rules saved in `exclusion_rules` table — auto-applied on future imports
- Dedicated `/excluded` page to review and un-exclude

### Categorization
- 13 standard categories: Food & Groceries, Restaurants & Cafes, Transportation, Housing & Utilities, Health & Medical, Shopping & Clothing, Entertainment & Leisure, Subscriptions, Insurance, Education, Transfers, Government & Taxes, Other
- AI categorization via NVIDIA-hosted Claude API (OpenAI-compatible endpoint)
- Category mappings cached in `merchant_categories` table (auto-applied on future imports)
- User overrides (`isUserOverride = 1`) take precedence over AI
- `CATEGORY_MAP` in `categorize/route.ts` normalizes parser-specific categories to standard set
- Recurring detection: transactions appearing in 3+ months flagged via `isRecurring` column

### Parsers
- Each institution has its own file in `src/lib/parsers/`
- All implement `Parser` interface: `{ name, institution, supportedFormats, parse(buffer, filename) }`
- `parse()` returns `ParsedTransaction[]` with: date, amount, currency, description, category?, excluded?
- Registry in `index.ts` maps institution string → parser
- To add a new parser: create the file, add to registry imports and `parsers` object
- CSV parsers must use `parseCSVLine()` from `csv-utils.ts` (not inline copies)
- Date formatting: use `getFullYear()/getMonth()/getDate()` (NOT `toISOString()`) to avoid timezone off-by-one
- Pepper parser uses `pdftotext -layout` (requires poppler: `brew install poppler`)

### API Routes
- Standard REST: GET/POST/DELETE on resource routes
- PUT for editing (income entries)
- Filters via query params (accountId, startDate, endDate, sortBy, sortDir)
- Bulk operations via PATCH on `/api/transactions/bulk`
- All return `NextResponse.json()`
- Transaction sorting by amount converts ILS→USD using exchange rate on transaction date

### Manual Income
- Supports mid-year raises: multiple entries per source with different `startDate` (YYYY-MM)
- Dashboard picks the applicable entry for each month (last entry before that month)
- Dashboard caps manual income at today (no future months counted)
- Sources: salary, rsu, espp, pension, keren_hishtalmut, other

### Deduplication
- On import, matches existing transactions by: date + amount (2 decimal) + description (lowercase trim)
- Duplicates are skipped, count reported to user
- Zero-amount transactions filtered out during upload

### Performance Patterns (Transactions Page)
- **No per-row Select/DropdownMenu components** — they create massive DOM bloat (14 items × N rows)
- Category editing: click-to-edit pattern (only 1 Select mounted at a time via `editingCategoryId` state)
- Row actions: shared Dialog triggered by `actionsForTx` state (not per-row DropdownMenu)
- Description tooltips: native `title` attribute (not React state-based tooltips)
- Account lookups: memoized Map (`useMemo`) instead of `array.find()` per row
- Filtering/sorting: `useMemo` with proper dependency arrays
- Mutations: optimistic local updates (`setTransactions(prev => prev.map(...))`) for known-ID operations; full re-fetch only for description-based bulk operations

## Database

10 tables defined in `src/db/schema.ts`:
- `accounts` — financial accounts with institution, currency, owner
- `transactions` — imported transactions with category, event, excluded, isRecurring flags
- `exchange_rates` — cached daily currency rates (unique on date+pair)
- `manual_income_entries` — recurring income with start month + monthly amount
- `net_worth_snapshots` — point-in-time balance per account
- `events` — trips/one-time expenses for transaction grouping
- `exclusion_rules` — account+description pairs to auto-exclude on import
- `merchant_categories` — merchant→category mappings (AI + user overrides)
- `import_logs` — audit log of file imports (account, filename, parser, row counts, timestamp)
- `categories` — category definitions (unused, reserved for future)

DB connection is lazy-initialized via Proxy in `src/db/index.ts` to avoid build-time errors.

## Commands

```bash
npm run dev          # Start dev server (http://localhost:3000)
npx next build       # Production build (type-checks everything)
npx drizzle-kit push # Push schema changes to Neon DB
```

### AI Chatbot
- `/chat` page with conversational UI — users ask natural language questions about their finances
- Uses **tool-calling pattern**: LLM gets 8 pre-built query tools, API route executes them server-side, loops up to 5 rounds
- Tools: `query_transactions` (with aggregation modes), `get_spending_by_category`, `get_monthly_trend`, `get_accounts`, `get_income_entries`, `get_events`, `get_top_merchants`, `get_net_worth_history`
- **SSE streaming**: `POST /api/chat` returns `text/event-stream` with event types: `status` (tool execution), `delta` (text tokens), `done`, `error`
- Tools handle ILS→USD conversion internally via `getExchangeRatesForDates()`
- Row results capped at 20-50 per tool call to prevent token overflow
- Conversation history stored in client React state only (ephemeral, not persisted)
- Same NVIDIA-hosted LLM endpoint as categorization (env vars: `NVIDIA_API_KEY`, `NVIDIA_BASE_URL`, `NVIDIA_MODEL`)
- Frontend parses SSE with `response.body.getReader()` — no external SSE library needed

## Environment Variables (.env.local)

```
DATABASE_URL=postgresql://...@...neon.tech/neondb?sslmode=require
NVIDIA_API_KEY=...          # For AI categorization + chatbot (NVIDIA-hosted Claude)
NVIDIA_BASE_URL=https://inference-api.nvidia.com/v1
NVIDIA_MODEL=aws/anthropic/bedrock-claude-opus-4-6
```

### Dashboard Features
- **Drill-down**: clicking pie chart segments or "View txns" links navigates to `/transactions?category=X&startDate=Y&endDate=Z`
- **YoY comparison**: automatically fetches previous year's data for side-by-side comparison (only shows if prev year has data)
- **Monthly trend**: includes savings line (income - expenses) alongside income/expenses/recurring/non-recurring
- **Events table**: dedicated breakdown of trip/event spending with names, dates, totals
- **Top one-time expenses**: 10 largest non-recurring transactions for spotting anomalies
- **Loading skeleton**: summary cards show animated skeleton placeholders while fetching

### Import System
- Upload page shows import history at the bottom (from `import_logs` table)
- Each import logs: account, filename(s), parser, total/imported/duplicate row counts
- CSV export available on transactions page — exports current filtered view
- Transactions page reads URL query params on mount (`category`, `startDate`, `endDate`) to support drill-down from dashboard

## Important Notes

- Drizzle `eq()` on enum columns requires exact type — use `sql` template for dynamic string values (see `chat/tools.ts` income source filter)
- OpenAI SDK `ChatCompletionMessageToolCall` is a union type — filter with `tc.type === "function"` before accessing `tc.function`
- No auth — single household app
- shadcn/ui components in `src/components/ui/` are generated — don't edit them
- The `drizzle.config.ts` loads `.env.local` explicitly via dotenv (not auto-loaded)
- All pages are client components (`"use client"`) — dashboard home page included
- `useSearchParams()` requires a `<Suspense>` boundary (see transactions page pattern)
- Recharts tooltip `formatter` must use `(value) => format(Number(value))` to avoid type errors
- Pepper parser requires `pdftotext` system binary (poppler) — not available on Vercel serverless
- Net worth recording skips credit card accounts (assumed paid in full monthly)
- Dashboard YTD default end date is last day of previous month
- After adding/changing DB tables, run `npx drizzle-kit push` to sync schema to Neon
