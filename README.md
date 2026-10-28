# Canada Retirement Planner

A browser-based planner that compares three retirement withdrawal plans (Option 1, 2, 3) for one person in Canada and shows the tax effect of each.

**Run it:** open `index.html` in a browser, or serve the folder (`python -m http.server 8765`) and go to http://localhost:8765. Your inputs are saved in the browser.

## What it models
- **RRSP → RRIF:** choose when RRIF minimums start (latest: convert by end of age 71, first minimum at 72). Minimums use the CRA prescribed factors (`1/(90−age)` under 71, table from 71, 20% at 95+). Shows withholding tax on amounts above the minimum.
- **RRSP/RRIF strategy:** minimum only, "fill" taxable income to a target each year (RRSP meltdown), or a fixed amount.
- **TFSA, non-registered** (savings/chequing/GIC interest, mutual funds/stocks with ACB, eligible dividends, 50% capital gains), **FHSA** (home or transfer to RRSP), **RESP** (EAP or collapse with AIP to RRSP / +20% tax).
- **CPP** 60–70 (−0.6%/mo early, +0.7%/mo late), **OAS** 65–70 (+0.6%/mo, +10% at 75, partial by residency), **OAS clawback** 15% above the threshold.
- **Tax:** federal + Ontario / BC / Alberta brackets, basic, age and pension credits, dividend credit, Ontario surtax and health premium. Tax on the RRIF and unrealized gains at death is included in the after-tax estate.
- **Optimizer:** searches the RRSP draw target (and optionally CPP/OAS ages) that leaves the largest after-tax estate while still covering spending.
- **Budget tab** modelled on the FCAC Budget Planner on canada.ca.

- **Couples:** spouse's own accounts, CPP/OAS start ages and DB pension. Pension income splitting is optimized each year; RRIF minimums can use the younger spouse's age. If one spouse is still working after the other retires, their pay helps cover the household budget. At the first death, everything rolls to the survivor tax-free, CPP survivor benefit and DB survivor pension start, and spending drops to a set percentage.

## Updating rates
All tax and benefit numbers are in `js/taxdata.js` (2026 estimates). Check them against canada.ca each year.

## Limits
No Quebec/QPP, no GIS, LIRA/LIF treated as RRSP/RRIF. For couples: the optimizer sets the same CPP/OAS ages for both spouses, spousal RRSP attribution and CPP pension sharing aren't modelled, and extra savings are split evenly between spouses. Educational tool, not financial advice.

## Files
- `index.html`, `css/styles.css` — page
- `js/taxdata.js` — rates, brackets, RRIF factors
- `js/engine.js` — tax engine, year-by-year simulation, optimizer
- `js/app.js` — forms, charts, tables
