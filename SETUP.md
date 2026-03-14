# Setting Up Your Own Big Picture Finance Instance

A step-by-step guide to fork, configure, and deploy your own instance.

## Prerequisites

- **Node.js 18+** — [Download](https://nodejs.org/)
- **GitHub account** — to fork the repo
- **Neon account** (free tier) — for the PostgreSQL database
- **Vercel account** (free tier) — for hosting
- **NVIDIA API account** — for AI-powered transaction categorization and chatbot

---

## Step 1: Fork & Clone

1. Go to the GitHub repo and click **Fork**
2. Clone your fork:
   ```bash
   git clone https://github.com/YOUR_USERNAME/big-picture-finance.git
   cd big-picture-finance
   ```
3. Install dependencies:
   ```bash
   npm install
   ```

---

## Step 2: Create a Neon Database

1. Go to [neon.tech](https://neon.tech) and sign up (free tier is fine)
2. Create a new project (name it anything, e.g. "big-picture-finance")
3. In the project dashboard, copy the **connection string** — it looks like:
   ```
   postgresql://username:password@ep-something.us-east-2.aws.neon.tech/neondb?sslmode=require
   ```
4. Keep this string handy — you'll need it in the next step

---

## Step 3: Set Up NVIDIA API Access

The app uses NVIDIA's API (which hosts Claude) for two features:
- **AI transaction categorization** — automatically categorizes your transactions
- **AI chatbot** — ask natural language questions about your finances

To get access:
1. Go to [build.nvidia.com](https://build.nvidia.com)
2. Create an account and generate an API key
3. The default model is `aws/anthropic/bedrock-claude-opus-4-6` — you can use any model available on the platform

> **Note:** The app works without this — you just won't have AI categorization or the chatbot. You can always add it later.

---

## Step 4: Create Environment Variables

Create a `.env.local` file in the project root:

```bash
# Database (from Step 2)
DATABASE_URL=postgresql://username:password@ep-something.us-east-2.aws.neon.tech/neondb?sslmode=require

# Authentication (choose your own values)
AUTH_PASSWORD=your-chosen-password
AUTH_SECRET=generate-a-random-64-char-hex-string

# AI Features (from Step 3 — optional)
NVIDIA_API_KEY=your-nvidia-api-key
NVIDIA_BASE_URL=https://inference-api.nvidia.com/v1
NVIDIA_MODEL=aws/anthropic/bedrock-claude-opus-4-6

# Cron job secret (protects the auto-sync endpoint)
CRON_SECRET=generate-a-random-32-char-hex-string
```

**Generating secrets:**
```bash
# Run these in your terminal to generate random secrets:
openssl rand -hex 32   # for AUTH_SECRET
openssl rand -hex 16   # for CRON_SECRET
```

**What these do:**
| Variable | Required | Purpose |
|----------|----------|---------|
| `DATABASE_URL` | Yes | Neon PostgreSQL connection string |
| `AUTH_PASSWORD` | Yes | Password to access the app (single-user, no signup) |
| `AUTH_SECRET` | Yes | Secret key for signing auth cookies |
| `NVIDIA_API_KEY` | No | Enables AI categorization + chatbot |
| `NVIDIA_BASE_URL` | No | API endpoint (use the default) |
| `NVIDIA_MODEL` | No | Which model to use (use the default) |
| `CRON_SECRET` | No | Protects the daily exchange rate sync endpoint |

---

## Step 5: Initialize the Database

Push the schema to your Neon database:

```bash
npx drizzle-kit push
```

This creates all the required tables (accounts, transactions, exchange rates, etc.).

---

## Step 6: Run Locally

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). You'll see the login page — enter the `AUTH_PASSWORD` you set.

---

## Step 7: Deploy to Vercel

1. Go to [vercel.com](https://vercel.com) and sign up (connect your GitHub account)
2. Click **"Add New Project"** and import your forked repo
3. In the project settings, add **Environment Variables** — the same 7 variables from your `.env.local`:
   - `DATABASE_URL`
   - `AUTH_PASSWORD`
   - `AUTH_SECRET`
   - `NVIDIA_API_KEY`
   - `NVIDIA_BASE_URL`
   - `NVIDIA_MODEL`
   - `CRON_SECRET`
4. Click **Deploy**
5. Your app will be live at `https://your-project-name.vercel.app`
6. Exchange rates are synced automatically once daily via a Vercel cron job. You can also manually sync via the "Sync Rates" button in the sidebar.

---

## First-Use Walkthrough

Once the app is running:

### 1. Create Your Accounts
Go to the **Accounts** page and add your financial accounts. For each account, specify:
- **Name** (e.g. "Chase Checking", "Cal Credit Card")
- **Institution** — must match a supported parser (see below)
- **Currency** (USD or ILS)
- **Owner** (e.g. your name — useful for multi-person households)

### 2. Upload Your First File
Go to the **Upload** page:
1. Select the account
2. Upload the bank/credit card export file (CSV, XLSX, or PDF depending on the institution)
3. Preview the parsed transactions
4. Click Import

### 3. Sync Exchange Rates
If you have accounts in both USD and ILS:
1. In the **sidebar**, click **"Sync Rates"**
2. This fetches daily ILS/USD exchange rates for all your transaction dates
3. The dashboard needs these to convert and compare amounts

### 4. Categorize Transactions
On the **Transactions** page:
- Click **"Categorize"** to run AI categorization on uncategorized transactions (requires NVIDIA API)
- You can also manually set categories by clicking on a transaction's category cell
- Manual overrides are remembered for future imports of the same merchant

### 5. Add Manual Income (Optional)
If your bank statements don't include salary/income deposits, go to the **Income** page to add manual income entries (salary, RSU, ESPP, pension, etc.). These are used for savings calculations.

---

## Supported Parsers

The app comes with parsers for these institutions:

| Institution | Format | Notes |
|-------------|--------|-------|
| Cal | XLSX | Israeli credit card, Hebrew |
| Isracard | XLSX | Israeli credit card, Hebrew |
| Max | XLSX | Israeli credit card, Hebrew, 2 sheets |
| Bank Hapoalim | CSV | Israeli bank, Hebrew |
| Pepper | PDF | Israeli bank, parsed via pdfjs-dist |
| Discover | CSV | US credit card |
| State Dept FCU | CSV | US bank |
| Fidelity | CSV | US cash management |
| Interactive Brokers | CSV | Auto-excludes trades/forex |

### Adding Your Own Parser

If your bank isn't listed, you can add a custom parser:

1. Create a new file in `src/lib/parsers/` (e.g. `my-bank.ts`)
2. Implement the `Parser` interface:
   ```typescript
   import { Parser, ParsedTransaction } from "./types";

   export const myBankParser: Parser = {
     name: "My Bank",
     institution: "my-bank",
     supportedFormats: ["csv"],  // or ["xlsx"], ["pdf"]
     async parse(buffer: Buffer, filename: string): Promise<ParsedTransaction[]> {
       // Parse the file and return transactions
       // Each transaction needs: date, amount, currency, description
       // Expenses should be NEGATIVE, income POSITIVE
       return [];
     },
   };
   ```
3. Register it in `src/lib/parsers/index.ts`:
   ```typescript
   import { myBankParser } from "./my-bank";
   // Add to the parsers object:
   "my-bank": myBankParser,
   ```
4. The institution name you use here is what you'll select when creating an account

---

## Key Concepts

- **Expenses are negative, income is positive** — this convention is used everywhere
- **Amounts stored in original currency** — the dashboard converts using daily exchange rates
- **Excluded transactions** — internal transfers, trades, etc. are hidden from totals but not deleted
- **Recurring detection** — transactions appearing in 3+ different months are flagged as recurring
- **Deduplication** — re-importing the same file won't create duplicates (matched by date + amount + description)

---

## Troubleshooting

**"Sync Rates" not working:**
The exchange rate API (frankfurter.dev) may be temporarily down. Try again later.

**AI categorization fails:**
Check that your `NVIDIA_API_KEY` is valid and `NVIDIA_BASE_URL` is correct.

**Schema changes after pulling updates:**
If you pull new code that changes the database schema, run:
```bash
npx drizzle-kit push
```

**Build errors:**
```bash
npx next build
```
This type-checks everything — read the error messages for specifics.
