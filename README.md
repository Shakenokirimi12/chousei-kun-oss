# Chosei-kun (OSS)

An open-source scheduling application built with Next.js and Cloudflare D1.

This repository is the generic, self-hostable template. Any specific production
instance (custom domain, feedback address, university portal integration, error
tracker, etc.) is just this template with its own `.env` / `wrangler.jsonc`
filled in — conceptually a fork, not a separately maintained codebase.

## Prerequisites

- Node.js (v18 or later recommended)
- Cloudflare Account
- Wrangler CLI (`npm install -g wrangler`)

## Getting Started

### 1. Simple Setup Script (Recommended)

You can run the interactive setup script which will automatically install dependencies, set up the Cloudflare D1 database, and deploy the application.

```bash
./setup.sh
```

### 1 (Manual). Install Dependencies

```bash
pnpm install
```

### 2. Configure Cloudflare D1 Database

First, create a new D1 database:

```bash
pnpm exec wrangler d1 create chosei-kun-db
```

This command will output a `database_id`. Copy this ID and paste it into the `d1_databases` section in `wrangler.jsonc` replacing `<YOUR_D1_DATABASE_ID>`.

もし、大学のポータルシステム（Campus Square等）から時間割をインポートする機能を有効にしたい場合は、以下の環境変数を設定してください。

```plaintext
NEXT_PUBLIC_ENABLE_CAMPUS_SQUARE=true
CAMPUS_SQUARE_BASE_URL=https://your-university-domain/campusweb
CAMPUS_SQUARE_LOGIN_WFID=nwf_PTW0000002_login
CAMPUS_SQUARE_CALENDAR_FLOWID=POW2401000-flow
CAMPUS_SQUARE_TIMEZONE_OFFSET=+09:00
```

### 3. Run Database Migrations

Apply the existing migrations to your local and remote databases:

```bash
# For local development
pnpm exec wrangler d1 migrations apply chosei-kun-db --local

# For remote deployment
pnpm exec wrangler d1 migrations apply chosei-kun-db --remote
```

### 4. Local Development

Run the Next.js development server:

```bash
pnpm run dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

## Deployment

Deploy the application to Cloudflare Workers using OpenNext:

```bash
pnpm run deploy
```

> Note: You need to be logged into Wrangler (`wrangler login`) to deploy.

## Self-hosting checklist

Everything below has a working default or is optional — the app runs without
any of it configured, just with reduced functionality. Fill in what you need:

| Setting | Required? | Purpose |
|---|---|---|
| `d1_databases[].database_id` (wrangler.jsonc) | **Required** | Your D1 database (see step 2 above) |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` / `GOOGLE_REDIRECT_URI` | Optional | Google Calendar import/export, invite emails |
| `TOKEN_ENC_KEY` | Recommended | Encrypts stored Google OAuth tokens at rest |
| `PII_ENC_KEY` | Recommended | Encrypts participant name/comment/email at rest |
| `ADMIN_OPS_TOKEN` | Only if you rotate `PII_ENC_KEY` later | Auth for the `/api/admin/backfill-pii` maintenance endpoint |
| `NEXT_PUBLIC_APP_URL` | Optional | Your deployment's public URL (footer/metadata) |
| `NEXT_PUBLIC_FEEDBACK_EMAIL` | Optional | Where the in-app "ヘルプ" feedback button sends mail |
| `NEXT_PUBLIC_WANA_DSN` | Optional | Error reporting to your own Sentry-compatible endpoint |
| `NEXT_PUBLIC_ENABLE_CAMPUS_SQUARE` + `CAMPUS_SQUARE_*` | Optional | Import from a university portal system (see step 2 above) — only relevant if your institution runs a compatible portal |
| `flagship` binding (wrangler.jsonc) | Optional | Remote maintenance-mode toggle; without it, maintenance mode simply stays off |

See `.env.example` and `wrangler.jsonc.example` for the exact variable names and generation commands.

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.
