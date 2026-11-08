# FiMoksha — Backend & Multi-User Plan (draft for review)

Source: Miro board **FiMoksha Web App Product Plan** (Feature backlog, Release roadmap, Manish's comments), read 2026-11-07.

## Decisions so far
| Topic | Decision |
|---|---|
| Who logs in | **Clients, advisors and admin.** An advisor manages several client households; clients see only their own; admin configures the app. |
| Backend | **Supabase** (hosted Postgres + sign-in + per-row security), Canadian region. Frontend stays a static site. |
| Spouse | **Part of one household.** One login per household; spouse and dependents are people inside it. |
| Insurance | Blank tab for now (details TBC). |
| Assets, liabilities, budget fields | Common fields assumed (see the Assets & Liabilities and Budget tabs). |
| Dashboard RAG | Assumed rules (below) until thresholds are agreed. |
| Admin moving/adding fields | **P3**, not in the MVP. |
| Release 2 & 3, sign-up mock-up | Template leftovers — ignored. |

## Built so far (2026-11-07)
- Sign-in with client / advisor / admin roles; household list and advisor assignment for admins; demo mode when no Supabase project is connected.
- Supabase migration with Row-Level Security, tested with PGlite (`npm test`).
- Tabs: Dashboard (RAG), Profile (+ spouse, dependents), Goals, Accounts, Insurance (blank), Assets & Liabilities, Budget (income + expenses), Taxes, Projection, Estate, Scenarios, Rules.
- **Data model simplification:** each household's plan is saved as one JSON document (`households.data`) instead of many tables. Access control stays in tables (`profiles`, `advisor_assignments`). This keeps the MVP fast to change; the configurable-fields tables below come with P3.

**Assumed RAG rules:** Red = savings run short before the plan-to age. Amber = money lasts but any of: less than 2 years of spending left at the end, OAS clawback, average tax rate above 25%, debt still owing after retirement. Green = none of these. Grey = required details missing.

## Architecture
```
Browser (static site: today's planner + new tabs)
   │  supabase-js (HTTPS, user's sign-in token)
   ▼
Supabase, region ca-central-1 (Montréal)
   ├─ Auth: email + password / magic link, MFA for advisors & admin
   ├─ Postgres with Row-Level Security on every table
   ├─ Edge Functions: invite client, admin tasks, (later) PDF reports
   └─ Daily backups (Pro plan: point-in-time recovery)
```
- The tax/projection engine (`js/engine.js`) keeps running **in the browser**, so results update instantly. The same file can run in an Edge Function later for advisor reports.
- Frontend hosting: GitHub Pages works as-is (still static). Netlify/Vercel are alternatives if we want preview links per change.
- Small build step (Vite) to keep the Supabase keys out of the source and split the code into modules.

## Roles & access
| Role | Can see | Can change |
|---|---|---|
| Client | Own household | Own household data and scenarios |
| Advisor | Households assigned to them | Those households' data, scenarios, notes |
| Admin | Everything | Tabs, field layout, users and roles, advisor assignments |

All enforced in the database (Row-Level Security), not just hidden in the UI.

## Data model
**Fixed tables** for things that are lists (a household can have many of them):

| Table | Main fields |
|---|---|
| `profiles` | user id, first/last name, phone, role (client/advisor/admin) |
| `households` | name, province, address, owner (client), created/updated |
| `advisor_assignments` | advisor ↔ household |
| `people` | household, kind (primary / spouse / dependent), first/last name, DOB, employment status, occupation, relationship |
| `accounts` | household, person, type (RRSP, RRIF, TFSA, FHSA, RESP, LIRA, non-reg cash, non-reg investments), balance, ACB, contributions, return |
| `assets` | type (real estate, gold, vehicle, other), value, appreciation %, income (e.g. rent) |
| `liabilities` | type (mortgage, loan, line of credit), balance, rate, payment, end date |
| `insurance_policies` | person, type, insurer, coverage, premium, beneficiary (fields TBC) |
| `budget_items` | income or expense, category, monthly amount, before/after retirement |
| `scenarios` | household, name, settings (CPP/OAS ages, RRIF strategy…) — today's Option 1/2/3 |
| `audit_log` | who changed what, when |

**Configurable layout** (the admin NFR "move fields between tabs, for all users"):

| Table | Purpose |
|---|---|
| `tabs` | key, label, order, visible |
| `field_definitions` | key, label, type, options, help text, validation, **tab**, section, order, applies to (household / each person), active |
| `household_values` | household, person (optional), field key → value (JSON) |

- Single-value fields (goals, preferences, assumptions) live in `field_definitions` + `household_values`, so the admin can move, relabel, hide or reorder them without any code change.
- List tables (accounts, assets, insurance…) appear on tabs as **blocks**, and the admin can move blocks between tabs too.
- Fields the engine needs (e.g. DOB, province, retirement age) are flagged "required by calculations" so they can be moved but not deleted.

## Tabs (MVP, from the Miro backlog)
| Tab | Content | Status today |
|---|---|---|
| Summary / Dashboard | Key numbers + RAG status | New |
| User Profile | Name, DOB, email, phone, address, province, preferences, notifications; spouse; dependents | New (planner has age/province) |
| Financial Goals | Retire at X, CPP at Y, OAS, spending goal | Exists |
| Accounts | Registered + non-registered accounts per person | Exists |
| Insurance | Policies per person | New — fields TBC |
| Assets & Liabilities | Real estate, gold, physical assets, mortgage, loans; net worth | New |
| Budget | Income & expenses | Exists (expenses only) |
| Taxes | Tax by year, by province | Exists |
| Projection / Illustration | Year-by-year table: age, income, tax, balances | Exists |
| Estate Planning | Assumptions (asset appreciation), after-tax estate | Partly exists |

Engine additions: real-estate appreciation and rent, mortgage/loan payments in spending, insurance death benefit in the estate, dependents (RESP link).

**Dashboard RAG (proposal — needs Manish's thresholds):** Green = spending funded to plan-to age with a cushion ≥ X years; Amber = funded but thin cushion, OAS clawback or high average tax; Red = money runs short.

## Security & privacy
- Data stored in Canada (Supabase `ca-central-1`); PIPEDA-style privacy notice and consent at sign-up.
- Row-Level Security on every table; MFA required for advisors and admin.
- Don't collect SIN or bank login details.
- Audit log of changes; account/data deletion on request.
- Production on Supabase Pro (free tier pauses inactive projects and has no point-in-time backups).

## Rough running cost
| Item | Cost |
|---|---|
| Supabase Pro | ~US$25/month |
| Frontend hosting | Free (GitHub Pages / Netlify / Vercel free tier) |
| Domain (e.g. fimoksha.ca) | ~C$20/year |
| Transactional email (Resend/Postmark) | Free tier to start |

## Schedule (matches the Miro roadmap)
| Dates | Work |
|---|---|
| Nov 9 – Nov 27 | **Discovery & design:** answer open questions, field lists, RAG rules, wireframes |
| Nov 30 – Jan 8 | **Sign-up, dashboard, settings:** Supabase project, sign-in, roles, households, profile/spouse/dependents, tab & field config + admin screen, save/load |
| Dec 7 – Jan 22 | **Core workflow:** accounts, assets & liabilities, insurance, budget, goals; connect engine to saved data; saved scenarios; projection, taxes, estate; dashboard RAG |
| Jan 25 – Feb 5 | **QA & beta** with a few real households |
| Feb 8 | **MVP launch** |

## Open questions for Manish
1. **Insurance:** which types (term/whole life, disability, critical illness, LTC)? Which fields? Should death benefits count in the estate?
2. **Assets & liabilities:** does real estate feed retirement income (downsizing, rent, reverse mortgage)? Field list for each type?
3. **Budget:** pre-retirement budget too, or retirement only? Separate income list?
4. **Dashboard RAG:** what are the green/amber/red thresholds? One overall status or one per tab?
5. **Admin field control:** only move fields between tabs, or also add/rename/hide fields?
6. **Advisors in MVP:** can advisors invite clients? Notes visible to clients? Can clients pick their advisor?
7. **Dependents:** which details (name, DOB, relationship, disability)? Link to RESP?
8. **Notifications:** what triggers them (reminders, plan changes, advisor messages) and by email only?
9. **Quebec / QPP** in scope?
10. **Release 2 & 3** ("Search and collaboration", "Payments and analytics") — real plans or template placeholders? Is payments a client subscription?
11. Domain name, branding, and who signs the privacy policy.
