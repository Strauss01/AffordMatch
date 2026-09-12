# AffordMatch V1 — Architecture

> This system is split into two independently-deployed repos —
> `affordmatch-backend` (this repo) and `affordmatch-frontend` — plus
> Supabase as a managed Postgres provider. Sections below describe the
> system as a whole; see each repo's own README for deploy specifics.

## 1. System overview

```
                    ┌─────────────┐   ┌─────────────┐   ┌─────────────┐
                    │  Buyer app  │   │  Provider   │   │   Admin     │
                    │             │   │   portal    │   │  console    │
                    │             │   │             │   │             │
                    └──────┬──────┘   └──────┬──────┘   └──────┬──────┘
                           │                 │                 │
                    (affordmatch-frontend — static site, deployed separately)
                           │                 │                 │
                           └────────┬────────┴────────┬────────┘
                                    ▼                 ▼
                         ┌─────────────────────────────────┐
                         │        Express REST API          │
                         │   (affordmatch-backend)          │
                         │   /api/auth  /api/buyer          │
                         │   /api/provider  /api/admin       │
                         │   /api/public                     │
                         │                                    │
                         │   requireAuth + requireRole        │
                         │   Zod request validation           │
                         │   matchingEngine.js (pure funcs)   │
                         └──────────────────┬─────────────────┘
                                            ▼
                         ┌─────────────────────────────────┐
                         │           PostgreSQL              │
                         │        (hosted on Supabase)       │
                         │  identity | afford | catalog | deals │
                         └─────────────────────────────────┘
```

Three static single-page dashboards (buyer, provider, admin), all in the
`affordmatch-frontend` repo, talk to this API over JSON/REST. There is no
server-side rendering and no shared session state beyond a JWT held in
the browser's `localStorage`. Postgres itself lives on Supabase rather
than being self-hosted — this API connects to it exactly like any other
managed Postgres, over the session pooler connection (see this repo's
README §1 for why that specific connection mode).

## 2. Database — four schemas, not four apps

The Postgres database is a single instance, but split into four schemas
so each domain can be reasoned about, secured, and evolved independently:

| Schema     | Purpose                                                          | Key tables |
|------------|-------------------------------------------------------------------|------------|
| `identity` | Who someone is, and what they've agreed to.                       | `users`, `buyer_profiles`, `provider_profiles`, `consents` |
| `afford`   | What a buyer told us, and what we computed from it. Versioned.   | `profiles`, `snapshots` |
| `catalog`  | What's for sale, and how it scored against a buyer.               | `listings`, `match_events` |
| `deals`    | The provider-facing side: leads, offers, status, subscriptions.   | `leads`, `offers`, `status_history`, `subscriptions` |

Design decisions worth calling out:

- **Affordability is versioned, never overwritten.** Every time a buyer
  updates their income/debts/deposit, a *new* row is inserted into
  `afford.profiles`, and a computed envelope is inserted into
  `afford.snapshots`. A lead created three months ago keeps pointing at
  the snapshot that was true at the time — so "why did we show this
  buyer this listing" is always answerable, and nothing is silently
  rewritten out from under an open deal.
- **Leads carry a snapshot, not just a buyer ID.** `deals.leads.snapshot_id`
  means a provider sees the exact budget envelope a buyer had when they
  requested the offer, not their current (possibly different) numbers.
- **Status changes are append-only audited.** `deals.status_history` and
  `identity.consents` are insert-only tables — nothing is deleted or
  silently updated, which matters for dispute resolution and (in SA)
  NCA/POPIA-style record-keeping expectations.
- **Category-specific detail lives in JSONB**, not per-vertical tables
  (`catalog.listings.metadata`). Adding capital equipment as a third
  vertical is a new `category` enum value and a new metadata shape, not
  a migration that touches every existing table.

Full DDL is in `db/migrations/*.sql`, applied in order by
`server/src/utils/migrate.js` (idempotent — tracks applied files in a
`schema_migrations` table, safe to run on every deploy).

## 3. Matching algorithm

Lives in `server/src/services/matchingEngine.js` as pure, framework-free
functions — no DB or HTTP inside — so it's independently unit tested
(`server/tests/matchingEngine.test.js`) and reusable from a future
background job or mobile client.

**Affordability envelope**, given income, existing debt, deposit, rate,
and term:

1. Cap the new repayment at the *tighter* of:
   - a category-specific share of gross income (20% for auto, 30% for
     property) — protects against over-concentration in one repayment;
   - what's left of a 40%-of-income total-debt ceiling after existing
     debts — protects against overall over-indebtedness.
   This loosely mirrors a National Credit Act–style affordability check.
2. Back-solve the maximum loan principal that repayment supports, using
   the standard amortising-loan formula, then add the deposit to get a
   maximum purchase price.
3. The minimum of the range is 65% of the maximum, to give a browsable
   band rather than a single number.

**Match score** (0–100) for a listing against that envelope:

- Compute the listing's own monthly repayment (price minus deposit,
  same rate/term).
- If the repayment is within budget, score highest near 82% of the
  max allowed payment (uses the budget well without maxing it out),
  tapering off the further a listing sits from that sweet spot.
- If the repayment exceeds the max allowed payment, score drops off
  steeply — over-budget listings are penalised harder than under-using
  the budget, on purpose.

Every scoring formula is version-stamped (`afford.snapshots.engine_version`)
so future tuning doesn't retroactively change what a past lead's score
"meant."

## 4. API architecture

Plain REST over JSON, Express, organised by **who's allowed to call it**
rather than by resource:

- `POST /api/auth/register/buyer`, `POST /api/auth/register/provider`,
  `POST /api/auth/login`, `GET /api/auth/me`
- `POST|GET /api/buyer/affordability`, `GET /api/buyer/matches`,
  `POST|GET /api/buyer/leads`, `POST /api/buyer/offers/:id/respond`
- `POST|GET|PATCH /api/provider/listings`, `GET /api/provider/leads`,
  `PATCH /api/provider/leads/:id/status`, `POST /api/provider/leads/:id/offer`
- `GET /api/admin/overview`, `GET /api/admin/providers`,
  `GET /api/admin/buyers`, `GET /api/admin/leads`,
  `POST /api/admin/users/:id/deactivate`
- `GET /api/public/listings` (no auth — for a future public browse page)

Every buyer/provider/admin router is mounted behind
`requireAuth` + `requireRole(...)` middleware, so a JWT for the wrong
role gets a 403, not a 500 or a data leak (covered by an integration
test — see §6). Request bodies are validated with Zod schemas
(`server/src/validators/schemas.js`) before touching the database;
`ApiError` + a central `errorHandler` turn validation failures, Postgres
constraint violations, and auth failures into consistent JSON error
responses instead of leaking stack traces.

## 5. Authentication model

- One `identity.users` table for all three roles (`buyer` | `provider` |
  `admin`), each with a bcrypt password hash. Role-specific detail
  (company name, category, full name) lives in a 1:1 profile table.
- Login issues a JWT (`{ sub: userId, role }`), signed with `JWT_SECRET`,
  sent as `Authorization: Bearer <token>`. Stateless — no server-side
  session store, which keeps the API horizontally scalable without a
  shared session cache.
- `requireRole` is deliberately a hard boundary: a buyer JWT cannot
  reach `/api/provider/*` even if it has a valid signature. Ownership is
  re-checked per-row too (e.g. a provider can only update a listing or
  lead that's actually theirs — see `listingsController.updateListing`,
  `leadsController.updateLeadStatus`), so a valid token for *a* provider
  can't touch *another* provider's data by guessing an ID.
- Consent is recorded, not assumed: registering a buyer inserts a row
  into `identity.consents` for the affordability check, with the
  request IP — an audit trail, not just a checkbox in the UI.

**What's intentionally out of scope for V1 and flagged for hardening
before a real launch:** password reset flow, email verification,
refresh tokens / token revocation, rate limiting on `/auth/*`, and
MFA for provider/admin accounts. See §7.

## 6. Testing

This isn't just scaffolding — it's exercised end-to-end against a real
Postgres instance:

- `server/tests/matchingEngine.test.js` — 10 unit tests on the pure
  finance/scoring functions (`npm test`, Node's built-in test runner).
- `server/tests/integration.smoke.js` — walks the *entire* deal loop
  over real HTTP against a running server: register buyer → submit
  affordability → get matches → request offer → provider sees the lead
  with the buyer's snapshot attached → provider changes status →
  provider submits an offer → buyer accepts → admin overview reflects
  the won deal → cross-role access is correctly forbidden.
- All three frontend dashboards were driven with headless jsdom against
  the live API during development (login, affordability update, match
  rendering, request-offer, status change, offer submission) — not just
  visually inspected.

Run it yourself: see `README.md` §"Run it locally."

## 7. Deployment structure

```
affordmatch-backend/        (this repo — deployed independently)
├── db/migrations/           four numbered .sql files, applied in order
├── src/                     Express API
├── Dockerfile
└── render.yaml              Render Blueprint: this service only

affordmatch-frontend/       (separate repo — deployed independently)
├── buyer/ provider/ admin/  three static dashboards
├── shared/                  api client + build-time config
└── generate-config.sh       writes shared/config.js from $API_BASE_URL

Supabase                     managed Postgres — not in either repo
```

The database, API, and dashboards are three independently deployed
pieces on purpose: the frontend is static files with no runtime of its
own (deploys to any static host, no Docker involved at all), the API is
a small stateless container (deploys anywhere that runs Docker or plain
Node), and Postgres is fully managed by Supabase rather than
self-hosted. None of the three needs to know how the others are hosted
— they're wired together purely through `DATABASE_URL` (API → Supabase)
and `API_BASE_URL` (frontend → API), both plain connection strings/URLs
passed as environment/build variables, not through shared infrastructure.

On Render, this repo's `render.yaml` runs `preDeployCommand` (migrate +
seed) before each deploy goes live. `DATABASE_URL` is marked `sync: false`
so Render prompts for your Supabase connection string rather than trying
to manage a database itself. See this repo's `README.md` for the exact
Supabase connection-string setup and the frontend repo's `README.md` for
its own deploy steps.

**Before this is actually production-ready**, close these gaps:

- Put the API behind a real reverse proxy / load balancer with TLS (Render
  does this for you by default; if you move elsewhere, check).
- Move `JWT_SECRET` and `DATABASE_URL` into a proper secrets manager if
  your host doesn't already isolate them (Render's env vars are encrypted
  at rest, which covers most of this).
- Add rate limiting (especially `/api/auth/*`) and structured logging /
  error tracking (e.g. Sentry) — right now errors only go to `console.error`.
- Confirm your Supabase project's backup schedule matches your needs
  (paid tiers get point-in-time recovery; the free tier doesn't) — this
  is now Supabase's job, not something to build, but worth checking.
- Add refresh tokens or shorter JWT expiry + rotation.
- Wire `deals.subscriptions` to a real payment provider (Stripe or a
  local gateway) — it's currently a data model with no billing logic
  behind it.
- CI: run `npm test` + `node tests/integration.smoke.js` against a
  throwaway Postgres on every PR before merging.
