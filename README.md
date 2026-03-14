# Big Picture Finance

Annual financial review app for households with accounts across multiple institutions, countries, and people. Upload bank statements, categorize transactions, track net worth, and see the big picture.

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2Fdan8901%2Fbig-picture-finance&env=AUTH_PASSWORD&envDescription=Choose%20a%20password%20to%20log%20into%20the%20app&stores=[{"type":"integration","integrationSlug":"neon","productSlug":"neon","protocol":"storage"}])

## Features

- **Multi-account support** — 14+ parsers for US and Israeli banks (CSV, XLSX, PDF)
- **Dashboard** — income/expense/savings summary, category breakdowns, monthly trends, YoY comparison
- **AI categorization** — automatic transaction categorization via configurable LLM provider
- **AI chatbot** — ask natural language questions about your finances
- **Goals & gamification** — budget caps, savings targets, streaks, achievements
- **Net worth tracking** — point-in-time balance snapshots across all accounts
- **Multi-currency** — ILS/USD with daily exchange rate sync
- **Trip/event tagging** — group transactions by trips or one-time events
- **Exclusion rules** — auto-exclude internal transfers, investments, etc.

## Deploy Your Own

Click the **Deploy with Vercel** button above. You'll be prompted to:

1. **Set `AUTH_PASSWORD`** — choose a password to log into the app
2. **Provision a Neon database** — Vercel will create one automatically

That's it. The build process runs database migrations automatically. Auth secrets are derived from your database URL, so no extra configuration is needed.

## Updating

If you deployed via the button, your repo is a GitHub fork. To get updates:

1. Go to your fork on GitHub
2. Click **"Sync fork"** → **"Update branch"**
3. Vercel will automatically redeploy with the latest changes

You can also check for updates from the **About** page inside the app.

## Local Development

```bash
# Clone the repo
git clone https://github.com/dan8901/big-picture-finance.git
cd big-picture-finance

# Install dependencies
npm install

# Set up environment variables
cp .env.example .env.local
# Edit .env.local with your DATABASE_URL and AUTH_PASSWORD

# Push database schema
npx drizzle-kit push

# Start dev server
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

### Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `DATABASE_URL` | Yes | Neon Postgres connection string |
| `AUTH_PASSWORD` | Yes | Password to log into the app |
| `AUTH_SECRET` | No | Auto-derived from DATABASE_URL if not set |
| `CRON_SECRET` | No | Auto-derived from DATABASE_URL if not set |

## Tech Stack

Next.js 16, React 19, TypeScript, shadcn/ui, Tailwind CSS v4, Drizzle ORM, Neon Postgres, Recharts
