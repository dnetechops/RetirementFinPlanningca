# FiMoksha — Canadian Retirement Planner

Multi-user retirement planning web app. Clients build their household plan; advisors work on the households assigned to them; admins manage users, roles and assignments.

No third-party services: a small Node.js server serves the app and its API, and data lives in your own PostgreSQL. Email is optional and goes through an SMTP server you choose.

## Run it

**Try it locally (no database to install):**
```
npm install
npm run dev
```
Open http://localhost:8765 and sign in as `admin@local.test` / `admin-dev-pass`. This uses PGlite (PostgreSQL in-process) with data in `.devdb/`, for development only.

**Demo mode (no server at all):** open `index.html` directly, or host the files on any static site (e.g. GitHub Pages). With no server to talk to, the app runs with sample users (admin, advisor, two clients) and keeps everything in that browser.

## Run it for real (your own PostgreSQL)
Needs Node.js 20+ and PostgreSQL 13+.

1. Create a database and user, e.g. in `psql`:
   ```sql
   create user fimoksha with password 'choose-a-strong-one';
   create database fimoksha owner fimoksha;
   ```
2. `npm install --omit=dev`
3. Copy `.env.example` to `.env` and set `DATABASE_URL` (and `PUBLIC_URL`, the address people will use).
4. Create the first admin:
   ```
   npm run create-admin -- you@example.ca "a-strong-password" First Last
   ```
5. `npm start` — the server creates its tables on start and listens on `PORT` (default 8080).

Put it behind HTTPS (Caddy, nginx or IIS as a reverse proxy) and set `PUBLIC_URL=https://…`, which also marks the sign-in cookie Secure. Back up with `pg_dump fimoksha > backup.sql`.

### Accounts and email
- **Without email (default):** people sign up and are signed straight in, or admins add users with a starting password (*Add a user*). Admins reset forgotten passwords (*Set password*); everyone can change their own (*Password* button).
- **With email:** fill in the `SMTP_*` settings. Sign-ups must confirm their email, and *Forgot password?* sends a one-hour reset link.
- Set `ALLOW_SIGNUP=false` so only admins can create accounts.

## Roles
| Role | Sees | Can do |
|---|---|---|
| Client | Own household | Edit their plan |
| Advisor | Households assigned to them | Edit those plans |
| Admin | Everything | Add users, change roles, set passwords, assign advisors to households |

All rules are enforced by the server (`server/api.mjs`), not just hidden in the page.

## Security notes
- Passwords hashed with scrypt; sessions are random tokens in an HttpOnly, SameSite cookie (only a hash is stored).
- Every change request needs a custom header, which other websites can't send, so cross-site forgery is blocked.
- Repeated wrong passwords are throttled; reset/confirm links are single-use and expire.
- Strict Content-Security-Policy: the page loads scripts only from this server (Chart.js is bundled in `vendor/`).

## Tabs
Dashboard (red/amber/green status — placeholder rules), Profile (household, you, spouse, dependents), Goals, Accounts, Insurance (placeholder), Assets & Liabilities, Budget, Taxes, Projection, Estate, Scenarios, Rules.

## What the engine models
- RRSP → RRIF with CRA minimum factors; RRSP draw strategies (minimum, fill to a taxable-income target, fixed) and an optimizer.
- TFSA, non-registered (interest, eligible dividends, capital gains with ACB), FHSA, RESP.
- CPP 60–70, OAS 65–70 with clawback; federal + Ontario / BC / Alberta tax and credits.
- Couples: pension income splitting, younger-spouse RRIF minimums, survivor rollover, CPP survivor benefit, DB survivor pension.
- Assets: growth, rental income, sale/downsizing; principal residence tax-free, other gains taxed. Liabilities: payments added to spending until paid off.
- After-tax estate including tax on the RRIF and taxable gains at the last death.

## Tests
```
npm install
npm test
```
`tests/engine.test.js` checks tax figures, earlier results and the asset/debt logic. `tests/api.test.mjs` starts the server on PGlite and checks sign-in, email links and each role's access over HTTP.

## Files
- `index.html`, `css/styles.css` — page; `vendor/` — Chart.js (MIT)
- `js/config.js` — mode (auto / server / demo)
- `js/taxdata.js` — rates, brackets, RRIF factors (2026 estimates; check canada.ca yearly)
- `js/engine.js` — tax engine, simulation, optimizer
- `js/model.js` — household data, conversion to engine inputs, net worth, RAG rules
- `js/store.js` — data layer (server or demo)
- `js/app.js` — UI
- `server/server.mjs` — production server (PostgreSQL, optional SMTP); `server/api.mjs` — API and access rules; `server/schema.sql` — tables; `server/dev.mjs` — local try-out on PGlite
- `docs/PLAN.md` — product/backend plan

## Limits
No Quebec/QPP, no GIS; LIRA/LIF treated as RRSP/RRIF. The optimizer gives both spouses the same CPP/OAS ages. Insurance and admin-configurable fields are not built yet. Educational tool, not financial advice.
