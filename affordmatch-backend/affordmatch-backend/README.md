# AffordMatch API (backend)

Express REST API — auth, affordability, matching, leads/offers, admin.
Database is external (Supabase Postgres), not bundled with this repo.

This is one half of a two-repo split: deploy this independently from
`affordmatch-frontend`. See that repo's README for the dashboards.

## 1. Set up Supabase

1. Create a project at [supabase.com](https://supabase.com).
2. Go to **Project Settings → Database → Connection string**, and copy the
   **Session pooler** string (port `5432`) — not the direct connection.
   This app is a persistent Node server holding a connection pool open
   (not a serverless function), and most hosts — including Render — only
   support outbound IPv4, while Supabase's *direct* connection defaults to
   IPv6-only. The session pooler is IPv4-compatible and behaves like a
   normal Postgres connection in every other way.
3. The username on that string looks like `postgres.<project-ref>`, not
   just `postgres` — copy it exactly as shown, don't retype it.
4. Paste it into `DATABASE_URL` in your `.env` (see `.env.example`).
   Supabase requires SSL, which is on by default here (`DB_SSL=true`).

## 2. Run migrations and seed demo data

```bash
npm install
cp .env.example .env    # then paste your real Supabase connection string in
npm run migrate         # applies db/migrations/*.sql — safe to re-run
npm run seed            # creates demo admin/buyer/provider accounts + inventory
```

Open your Supabase project's **Table Editor** afterward — you should see
four schemas in the schema dropdown: `identity`, `afford`, `catalog`,
`deals` (Supabase's UI defaults to showing `public`; switch schemas from
the dropdown at the top of the Table Editor).

## 3. Run it locally

```bash
npm start                 # http://localhost:4000
node tests/integration.smoke.js   # optional: full deal-loop smoke test
```

## 4. Deploy to Render

This repo includes `render.yaml`. In Render: **New + → Blueprint →**
connect this repo. It'll prompt you to paste in `DATABASE_URL` (marked
`sync: false` so Render asks rather than guesses), and generates a
`JWT_SECRET` for you. Migrations + seed run automatically before each
deploy via `preDeployCommand`.

Since this repo is now backend-only, there's no monorepo path ambiguity
— `dockerfilePath: Dockerfile` and `dockerContext: .` both point at this
repo's own root, which is where they actually are.

Once deployed, note the service's public URL (e.g.
`https://affordmatch-api.onrender.com`) — the frontend needs it.

## Demo logins

Password for all: `Password123!`

| Role | Email |
|---|---|
| Admin | `admin@affordmatch.dev` |
| Buyer | `buyer@affordmatch.dev` |
| Provider (auto) | `johannesburg-toyota@affordmatch.dev` |
| Provider (property) | `sandton-realty-group@affordmatch.dev` |

## Testing

```bash
npm test                          # unit tests on the matching engine
node src/index.js &               # start the API
node tests/integration.smoke.js   # full HTTP deal-loop test
```

## Project layout

```
├── db/migrations/       4 SQL migrations (identity, afford, catalog, deals schemas)
├── src/
│   ├── config/db.js             Postgres pool, SSL-aware for Supabase
│   ├── middleware/               JWT auth + role guard, error handler
│   ├── services/matchingEngine.js   pure affordability + scoring math (unit tested)
│   ├── controllers/              auth, affordability, listings, leads, admin
│   ├── routes/                   auth/buyer/provider/admin/public routers
│   ├── validators/schemas.js     Zod request validation
│   └── utils/                    jwt, password hashing, migrate.js, seed.js
├── tests/                        unit tests + full HTTP integration smoke test
├── Dockerfile
└── render.yaml
```
