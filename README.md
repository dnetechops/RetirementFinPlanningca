# FiMoksha — Canadian Retirement Planner

Multi-user retirement planning web app. Clients build their household plan; advisors work on the households assigned to them; admins manage users, roles and assignments.

## Run it

**Demo mode (no server):** open `index.html` or serve the folder (`python -m http.server 8765`, then http://localhost:8765). With no Supabase settings in `js/config.js`, the app runs in demo mode: sample users (admin, advisor, two clients) and all plans are stored in this browser only.

**With Supabase (real accounts, shared data):**
1. Create a project at supabase.com — choose region **Canada (Central)**.
2. In the SQL editor, run `supabase/migrations/0001_init.sql`.
3. In *Authentication → URL Configuration*, set the Site URL to where the app is hosted (e.g. your GitHub Pages URL).
4. Put the project URL and **anon public** key in `js/config.js` (the anon key is meant to be public; the database's Row-Level Security controls access).
5. Sign up in the app, then make yourself admin once in the SQL editor:
   `update public.profiles set role = 'admin' where email = 'you@example.com';`

The site stays static, so GitHub Pages can keep hosting it.

## Roles
| Role | Sees | Can do |
|---|---|---|
| Client | Own household | Edit their plan |
| Advisor | Households assigned to them | Edit those plans |
| Admin | Everything | Change roles, assign advisors to households |

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
`tests/engine.test.js` checks tax figures, earlier results and the asset/debt logic. `tests/rls.test.mjs` runs the database migration in PGlite (Postgres in-process) and checks each role's access.

## Files
- `index.html`, `css/styles.css` — page
- `js/config.js` — Supabase settings (blank = demo mode)
- `js/taxdata.js` — rates, brackets, RRIF factors (2026 estimates; check canada.ca yearly)
- `js/engine.js` — tax engine, simulation, optimizer
- `js/model.js` — household data, conversion to engine inputs, net worth, RAG rules
- `js/store.js` — data layer (Supabase or demo)
- `js/app.js` — UI
- `supabase/migrations/` — database schema and access rules
- `docs/PLAN.md` — product/backend plan

## Limits
No Quebec/QPP, no GIS; LIRA/LIF treated as RRSP/RRIF. The optimizer gives both spouses the same CPP/OAS ages. Insurance and admin-configurable fields are not built yet. Educational tool, not financial advice.
