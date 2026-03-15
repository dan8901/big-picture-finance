# Big Picture Finance

Annual financial review app for a dual-country (US/Israel) household with ~14 accounts across different institutions, countries, and people. Used once a year to upload reports, enter manual data, and see the big picture.

## Tech Stack

- **Next.js 16** (App Router) + **React 19** + **TypeScript**
- **shadcn/ui** + **Tailwind CSS v4** + **Recharts** for UI/charts
- **Drizzle ORM** + **Neon Postgres** (serverless)
- **SheetJS** (xlsx) + custom CSV parsers for file parsing
- **@dnd-kit** (core + sortable + utilities) for drag-and-drop goal reordering
- **canvas-confetti** for celebration animations
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
│   ├── goals/page.tsx              # Goals — budget caps, savings targets, streaks, gamification
│   ├── categories/page.tsx         # Category management + migration wizard
│   ├── merchants/page.tsx          # Merchant management — display names, merge, category editing
│   ├── insights/page.tsx           # AI Insights — 5 pre-built insight cards generated in parallel
│   ├── settings/page.tsx           # LLM provider config + API usage/cost tracking
│   ├── about/page.tsx              # About page — version display, update checker, update instructions
│   └── api/
│       ├── dashboard/route.ts      # Analytics: totals, breakdowns, trends, events, top txns
│       ├── transactions/route.ts   # GET (filtered), POST (bulk import w/ dedup + logging), DELETE
│       ├── transactions/bulk/route.ts # PATCH: bulk category/event/exclude updates
│       ├── upload/route.ts         # Parse files via parser registry
│       ├── accounts/route.ts       # CRUD
│       ├── app-config/route.ts     # GET/PUT app-level config (e.g., All button start date)
│       ├── income/route.ts         # CRUD + PUT for editing
│       ├── net-worth/route.ts      # CRUD with account joins
│       ├── events/route.ts         # CRUD for trip/event tagging
│       ├── exchange-rates/route.ts # GET (needed dates) + POST (fetch & cache rates)
│       ├── categories/route.ts     # Category CRUD, reorder, migration wizard endpoint
│       ├── merchants/route.ts      # Merchant display names: GET/PATCH/POST (merge)
│       ├── categorize/route.ts     # AI categorization + normalization + recurring detection
│       ├── chat/route.ts           # AI chatbot SSE endpoint (tool-calling loop)
│       ├── chat/tools.ts           # 11 query tools for chatbot (transactions, categories, trends, etc.)
│       ├── insights/route.ts      # AI Insights SSE endpoint — 5 curated prompts with tool-calling
│       ├── goals/route.ts          # CRUD + progress computation for goals
│       ├── goals/evaluate/route.ts # Evaluate goals for past periods, record achievements
│       ├── goals/reorder/route.ts  # PATCH: persist drag-and-drop goal ordering
│       ├── settings/route.ts       # GET (read config) / PUT (save config) / POST (test connection)
│       ├── cron/sync-rates/route.ts # Vercel cron: daily exchange rate sync
│       └── import-history/route.ts # GET: recent import logs with account names
├── components/
│   ├── sidebar.tsx                 # Nav sidebar with SVG icons, collapsible, sync rates button
│   └── ui/                         # shadcn/ui components (don't edit directly)
├── db/
│   ├── schema.ts                   # All Drizzle table definitions
│   └── index.ts                    # Lazy DB singleton (Neon serverless)
└── lib/
    ├── utils.ts                    # cn() helper
    ├── categories.ts               # Category DB reader, cache, seeding, CATEGORY_MAP
    ├── exchange.ts                 # Exchange rate DB cache reader
    ├── llm.ts                      # Unified LLM abstraction (OpenAI + Anthropic clients)
    ├── chat-system-prompt.ts       # Shared system prompt for chat + insights
    ├── llm-presets.ts              # Provider presets, model lists, cost estimation
    ├── evaluate-goals.ts           # Shared goal evaluation logic (auto-evaluate on data change + stale check)
    ├── version.ts                  # APP_VERSION, REPO_URL, REPO_API_URL constants
    ├── auth-utils.ts               # getAuthSecret(), getCronSecret() — derive from DATABASE_URL if env var not set
    ├── accounts.ts                 # TRANSACTION_ACCOUNT_TYPES constant
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
        ├── max.ts                  # ✅ Max credit card (XLSX, Hebrew, 2 sheets)
        └── pepper.ts               # ✅ Pepper Bank (PDF via pdftotext)
```

## Key Conventions

### Account Types
- **Transaction accounts** (`bank`, `credit_card`): upload statements via parsers, transactions appear on dashboard
- **Balance-only accounts** (`brokerage`, `pension`, `keren_hishtalmut`): net worth snapshots + manual income entries (distributions), no statement uploads
- `TRANSACTION_ACCOUNT_TYPES` constant in `src/lib/accounts.ts` — used by dashboard API (date range calculation) and upload page (account filtering)
- Upload page only shows transaction accounts in the dropdown
- Dashboard "All" button date is computed from transaction accounts only (max of each account's earliest transaction)

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
- Categories are **user-configurable** — stored in `categories` DB table, managed via `/categories` page
- 9 default categories seeded on first access: Food & Dining, Transportation, Housing & Utilities, Health & Insurance, Shopping & Clothing, Entertainment & Leisure, Transfers, Government & Taxes, Other
- **Migration wizard**: `/categories` page has a "Reconfigure" wizard (4-step: define → map → handle goals → review & apply) for renaming, adding, removing, or merging categories with cascading updates to transactions, merchant cache, and goals
- Category list is fetched dynamically from `/api/categories` by transactions page, goals page, and AI categorization
- Shared library `src/lib/categories.ts`: `getCategories()`, `getCategoryNames()`, `getCategoryMap()` with 60s in-memory cache
- `CATEGORY_MAP` in `src/lib/categories.ts` normalizes parser-specific categories (including Hebrew) to standard set
- AI categorization via configured LLM provider (OpenAI-compatible endpoint)
- Category mappings cached in `merchant_categories` table (auto-applied on future imports)
- User overrides (`isUserOverride = 1`) take precedence over AI
- Recurring detection: transactions appearing in 3+ months flagged via `isRecurring` column

### Transaction Notes
- Per-transaction `note` column (nullable text) for adding context ("check - rent", "panda - mattress")
- Click-to-edit on transactions page (click "+ note" on hover, click existing note to edit)
- Searchable: note text included in the transactions page search filter
- Included in CSV export and chat tool results

### Merchant Display Names & Consolidation
- `displayName` column on `merchant_categories` table — presentation-only, does not affect dedup or exclusion rules
- When set, dashboard/chat analytics group by displayName instead of raw description
- Inline editing on transactions page: click description to set display name (applies to all matching transactions)
- Dedicated `/merchants` page: list, rename, merge merchants, edit categories
- Merge: select multiple merchants → set shared displayName + category → all matching transactions updated
- `GET /api/merchants?mapOnly=1` returns lightweight displayName map for client-side rendering
- Display names do NOT affect: deduplication (uses raw description), exclusion rules, AI categorization

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

14 tables defined in `src/db/schema.ts`:
- `accounts` — financial accounts with type, institution (nullable — only for transaction accounts), currency, owner
- `transactions` — imported transactions with category, event, excluded, isRecurring flags, optional note
- `exchange_rates` — cached daily currency rates (unique on date+pair)
- `manual_income_entries` — recurring income with start month + monthly amount
- `net_worth_snapshots` — point-in-time balance per account
- `events` — trips/one-time expenses for transaction grouping
- `exclusion_rules` — account+description pairs to auto-exclude on import
- `merchant_categories` — merchant→category mappings (AI + user overrides) + optional displayName for consolidation
- `import_logs` — audit log of file imports (account, filename, parser, row counts, timestamp)
- `llm_config` — LLM provider configuration (single-row, provider/apiKey/baseUrl/model)
- `llm_usage_logs` — per-request token usage and estimated cost tracking (feature, model, tokens, cost)
- `categories` — user-configurable category list with sortOrder, isDefault flag; auto-seeded with 9 defaults
- `goals` — financial goals (budget_cap, savings_target, savings_amount) with scope, owner, period
- `goal_achievements` — per-period achievement records for streak/history tracking (unique on goalId+period)
- `app_config` — single-row app configuration (e.g., `allStartDate` override for dashboard "All" button)

DB connection is lazy-initialized via Proxy in `src/db/index.ts` to avoid build-time errors.

## Commands

```bash
npm run dev          # Start dev server (http://localhost:3000)
npm run build        # Production build (runs drizzle-kit push + next build)
npx drizzle-kit push # Push schema changes to Neon DB (also runs automatically in build)
```

### AI Chatbot
- `/chat` page with conversational UI — users ask natural language questions about their finances
- Uses **tool-calling pattern**: LLM gets 11 pre-built query tools, API route executes them server-side, loops up to 5 rounds
- Tools: `query_transactions` (with aggregation modes), `get_spending_by_category`, `get_monthly_trend`, `get_accounts`, `get_income_entries`, `get_events`, `get_top_merchants`, `get_net_worth_history`, `get_financial_summary`, `get_goals`, `get_goal_achievements`
- **SSE streaming**: `POST /api/chat` returns `text/event-stream` with event types: `status` (tool execution), `delta` (text tokens), `done`, `error`
- Tools handle ILS→USD conversion internally via `getExchangeRatesForDates()`
- Row results capped at 20-50 per tool call to prevent token overflow
- Conversation history stored in client React state only (ephemeral, not persisted)
- Uses shared LLM abstraction (`src/lib/llm.ts`) — supports OpenAI-compatible providers + native Anthropic API
- Frontend parses SSE with `response.body.getReader()` — no external SSE library needed

### AI Insights
- `/insights` page with 5 pre-built insight cards: Smart Savings, Fun Facts, Monthly Pulse, Goal Check-in, Year in Review
- "Generate Insights" button fires all 5 cards in parallel via SSE — results stream in as each completes
- Reuses same tool-calling infrastructure as chat: `getSystemPrompt()` (shared via `src/lib/chat-system-prompt.ts`), `executeTool()`, `getLLMClient("chat")`
- Each card has individual regenerate button after first generation
- `POST /api/insights` accepts `{ type }` — same SSE event format as chat (`status`, `delta`, `done`, `error`)
- Curated prompts per insight type guide the LLM to use appropriate query tools and format responses as markdown

### LLM Configuration
- Provider config stored in `llm_config` table (single row, UI-configurable at `/settings`)
- Supports: OpenAI, Anthropic (native SDK), NVIDIA, DeepSeek, OpenRouter, Custom (any OpenAI-compatible)
- `src/lib/llm.ts` provides `getLLMClient()` factory — used by both `categorize` and `chat` routes
- `addToolResult()` helper builds tool-result messages in the unified format
- Config cached in-memory for 60s to avoid DB query per LLM call; `clearConfigCache()` invalidates on save
- Token usage logged to `llm_usage_logs` table after every LLM call; cost estimated from model pricing map in `llm-presets.ts`
- Anthropic client handles message format conversion (system→param, tool results→user content blocks, role alternation)
- Settings API: `GET /api/settings` (masked config + usage stats), `PUT` (save), `POST ?action=test` (connection test)

## Environment Variables (.env.local)

```
DATABASE_URL=postgresql://...@...neon.tech/neondb?sslmode=require
AUTH_PASSWORD=...           # Single password for login
```

### Dashboard Features
- **Drill-down**: clicking pie chart segments or "View txns" links navigates to `/transactions?category=X&startDate=Y&endDate=Z`
- **YoY comparison**: automatically fetches previous year's data for side-by-side comparison (only shows if prev year has data)
- **Monthly trend**: includes savings line (income - expenses) alongside income/expenses/recurring/non-recurring
- **Events table**: dedicated breakdown of trip/event spending with names, dates, totals
- **Top one-time expenses**: 10 largest non-recurring transactions for spotting anomalies
- **Loading skeleton**: summary cards show animated skeleton placeholders while fetching
- **Welcome card**: first-run experience when no data exists — guides users to add accounts, upload statements, configure AI

### Import System
- Upload page shows import history at the bottom (from `import_logs` table)
- Each import logs: account, filename(s), parser, total/imported/duplicate row counts
- CSV export available on transactions page — exports current filtered view
- Transactions page reads URL query params on mount (`category`, `startDate`, `endDate`) to support drill-down from dashboard

### Goals & Gamification
- **Annual-only goals** — all goals are defined as annual targets; monthly tracking is derived automatically
- Three goal types: `budget_cap` (spend under $X/yr), `savings_target` (save X% of income), `savings_amount` (save $X/yr)
- Monthly targets derived: budget_cap and savings_amount use `targetAmount / 12`, savings_target (%) stays the same
- Scope: overall or category-specific (e.g. budget cap on "Restaurants & Cafes"), optional owner filter
- Progress computed live from transactions (same queries as dashboard), not stored — only achievements are persisted
- Achievements stored in `goal_achievements` table for streak persistence (unique on goalId+period)
- Both monthly ("2025-09") and annual ("2025") achievements are evaluated and stored
- **Auto-evaluation**: achievements are evaluated automatically (no manual button) — triggered by: stale check on page load (once/month), goal creation, goal target edit, transaction import
- Shared evaluation logic in `src/lib/evaluate-goals.ts` — used by goals GET (stale check), goals POST/PUT, transactions POST, and evaluate API route
- Monthly evaluation uses derived target (/12); annual evaluation uses full annual target
- Streaks count consecutive **monthly** achievements (not annual)
- Celebrations: canvas-confetti on achievements + streak milestones (3, 6, 12 months)
- Gamification: streak counters, report card grade (A/B/C/D based on achievement ratio), owner leaderboard
- Status thresholds: `achieved` (>=100% of target), `on_track` (>=95%), `at_risk` (>=70%), `exceeded`/`missed` (<70%)
- Drag-and-drop reordering of active goals via @dnd-kit (sortOrder column, PATCH `/api/goals/reorder`)
- Currency display: ILS goals show ₪, USD goals show $
- Achievement history table shows both monthly columns and annual columns (separated by border)

## Important Notes

- **Never tell the user to run commands** — always execute them directly (builds, schema pushes, installs, etc.)

- Drizzle `eq()` on enum columns requires exact type — use `sql` template for dynamic string values (see `chat/tools.ts` income source filter)
- OpenAI SDK `ChatCompletionMessageToolCall` is a union type — filter with `tc.type === "function"` before accessing `tc.function`
- Password-protected single household app
- shadcn/ui components in `src/components/ui/` are generated — don't edit them
- The `drizzle.config.ts` loads `.env.local` explicitly via dotenv (not auto-loaded)
- All pages are client components (`"use client"`) — dashboard home page included
- `useSearchParams()` requires a `<Suspense>` boundary (see transactions page pattern)
- Recharts tooltip `formatter` must use `(value) => format(Number(value))` to avoid type errors
- Pepper parser requires `pdftotext` system binary (poppler) — not available on Vercel serverless
- Net worth recording skips credit card accounts (assumed paid in full monthly)
- Dashboard YTD default end date is last day of previous month
- After adding/changing DB tables, always run `npx drizzle-kit push` to sync schema to Neon — never tell the user to run commands, always execute them directly
- `AUTH_SECRET` and `CRON_SECRET` are auto-derived from `DATABASE_URL` via HMAC if env vars not set (`src/lib/auth-utils.ts`)
- Build script runs `drizzle-kit push` before `next build` — tables auto-created on first deploy
- Deploy button in README uses Vercel's Neon integration for auto-provisioning
- **Version bumping**: before every commit/push, increment `APP_VERSION` and `APP_VERSION_DATE` in `src/lib/version.ts` and `version` in `package.json` (keep in sync). Patch bump for fixes, minor bump for features.
- About page (`/about`) checks GitHub releases API for updates — unauthenticated, 60 req/hr rate limit
