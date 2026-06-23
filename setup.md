# Robo Flow — Setup Guide

Robo Flow is a robotics workflow automation platform built with **Next.js** and **Supabase**.

This guide covers local development setup. The UI is not yet implemented — this scaffold provides the project structure, database schema, and configuration.

---

## Prerequisites

| Tool | Version | Notes |
|------|---------|-------|
| Node.js | 20+ | LTS recommended |
| npm | 10+ | Or pnpm / yarn |
| Docker | Latest | Required for local Supabase |
| Supabase CLI | 2.x | `npm install -g supabase` |

---

## 1. Clone and install

```bash
git clone https://github.com/adeeltariq6480/robo_flow.git
cd robo_flow
npm install
```

---

## 2. Environment variables

Copy the example files and fill in your values:

```bash
cp .env.example .env
cp .env.local.example .env.local
```

| Variable | Description |
|----------|-------------|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Public anon key (safe for client) |
| `SUPABASE_SERVICE_ROLE_KEY` | Service role key — **server only** |
| `NEXT_PUBLIC_APP_URL` | App base URL (e.g. `http://localhost:3000`) |
| `ROBOT_AGENT_API_KEY` | Optional key for robot/agent webhook auth |

For local development, use the values printed by `supabase start` (see step 3).

---

## 3. Supabase — local development

### Start local Supabase

```bash
supabase init   # only needed once if config.toml is missing
supabase start
```

After startup, the CLI prints your local API URL and keys. Paste them into `.env.local`.

### Apply the schema

Run the schema against your local database:

```bash
supabase db reset
```

Or, to apply only `schema.sql` without resetting:

```bash
psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -f supabase/schema.sql
```

### Generate TypeScript types

```bash
npm run db:types
```

This writes typed definitions to `src/lib/types/database.ts`.

---

## 4. Supabase — cloud (production / staging)

1. Create a project at [supabase.com](https://supabase.com).
2. Open **SQL Editor** and paste the contents of `supabase/schema.sql`, then run it.
3. Copy your project URL and keys from **Settings → API** into `.env`.
4. (Optional) Link the CLI for migrations:

   ```bash
   supabase login
   supabase link --project-ref your-project-ref
   supabase db push
   ```

---

## 5. Run the dev server

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). You should see the placeholder home page.

---

## Project structure

```
robo_flow/
├── .env.example              # Environment variable template
├── .env.local.example        # Local dev overrides template
├── setup.md                  # This file
├── package.json
├── next.config.ts
├── tsconfig.json
├── supabase/
│   ├── schema.sql            # Full database schema + RLS
│   └── migrations/           # Future migration files
├── public/                   # Static assets
└── src/
    ├── app/                  # Next.js App Router
    │   ├── layout.tsx        # Root layout (placeholder)
    │   ├── page.tsx          # Home page (placeholder)
    │   └── globals.css
    ├── components/           # UI components (to be built)
    ├── hooks/                # React hooks (to be built)
    ├── lib/
    │   ├── supabase/         # Supabase client helpers
    │   └── types/
    │       └── database.ts   # Generated DB types
    └── middleware.ts         # Auth session refresh
```

---

## Database overview

| Table | Purpose |
|-------|---------|
| `profiles` | User profiles (auto-created on signup) |
| `organizations` | Workspaces / tenants |
| `organization_members` | Membership and roles |
| `robots` | Registered robots and agents |
| `flows` | Workflow definitions |
| `flow_versions` | Versioned flow graphs (nodes + edges JSON) |
| `triggers` | Manual, schedule, webhook, or robot-event triggers |
| `flow_runs` | Execution instances |
| `flow_run_logs` | Per-step run logs |
| `credentials` | Integration secret references (vault IDs) |
| `flow_templates` | Reusable public flow templates |

All tenant-scoped tables use **Row Level Security** so users only access data within their organizations.

---

## Next steps

- [ ] Implement authentication UI (sign up / sign in)
- [ ] Build organization and robot management screens
- [ ] Add visual flow editor
- [ ] Wire up flow execution engine and robot agents
- [ ] Add real-time run status via Supabase Realtime

---

## Useful commands

```bash
npm run dev          # Start Next.js dev server
npm run build        # Production build
npm run lint         # ESLint
npm run db:types     # Regenerate Supabase TypeScript types
supabase start       # Start local Supabase stack
supabase stop        # Stop local Supabase stack
supabase status      # Show local URLs and keys
```
