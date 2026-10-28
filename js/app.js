// UI: forms, scenario cards, charts and tables.
(function () {
  const TD = window.TAXDATA, E = window.Engine;
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const money = v => (v == null || isNaN(v)) ? '—' : (v < -0.5 ? '−$' : '$') + Math.round(Math.abs(v)).toLocaleString('en-CA');
  const pct = v => (v * 100).toFixed(1) + '%';
  const range = (a, b) => Array.from({ length: b - a + 1 }, (_, i) => a + i);
  const STORE = 'cdn-retirement-planner-v1';

  const ORDERS = [
    ['cash,inv,tfsa,reg', 'Non-reg → TFSA → RRSP/RRIF (traditional)'],
    ['cash,inv,reg,tfsa', 'Non-reg → RRSP/RRIF → TFSA (TFSA last)'],
    ['reg,cash,inv,tfsa', 'RRSP/RRIF → Non-reg → TFSA'],
    ['tfsa,cash,inv,reg', 'TFSA → Non-reg → RRSP/RRIF'],
  ];
  const STRATEGIES = [
    ['min', 'RRIF minimum only (plus top-ups when needed)'],
    ['fill', 'Fill to a taxable-income target (RRSP meltdown)'],
    ['fixed', 'Fixed annual RRSP/RRIF withdrawal'],
  ];

  const DEFAULTS = {
    profile: {
      age: 60, retireAge: 62, endAge: 95, province: 'ON', inflation: 2.1, empIncome: 90000,
      rrsp: 600000, rrif: 0, rReg: 5, contribRrsp: 15000,
      tfsa: 100000, tfsaRoom: 20000, rTfsa: 5, contribTfsa: 7000,
      cash: 30000, rCash: 2.5, inv: 150000, invAcb: 100000, rInv: 5, divYield: 2, contribNonreg: 0,
      fhsa: 0, fhsaAction: 'rrsp', fhsaAge: 62,
      respBal: 0, respContrib: 0, respGrants: 0, rResp: 4, respAction: 'eap', respAge: 62,
      cpp65: 1100, oasYears: 40, dbPension: 0, dbStart: 65, dbIndex: 0, dbSurvivor: 60, otherIncome: 0, otherUntil: 70,
      spending: 58800, slowAge: 80, slowPct: -15, survivorPct: 70,
      spouseOn: 'no',
      s_age: 58, s_retireAge: 62, s_endAge: 95, s_empIncome: 70000,
      s_rrsp: 200000, s_rrif: 0, s_contribRrsp: 8000, s_tfsa: 80000, s_tfsaRoom: 15000, s_contribTfsa: 7000,
      s_cash: 10000, s_inv: 0, s_invAcb: 0, s_contribNonreg: 0,
      s_cpp65: 800, s_oasYears: 40, s_dbPension: 0, s_dbStart: 65, s_dbIndex: 0, s_dbSurvivor: 60, s_otherIncome: 0, s_otherUntil: 70,
    },
    scenarios: [
      { name: 'Option 1 · Conventional', cppAge: 65, oasAge: 65, rrifStart: 72, cppAge2: 65, oasAge2: 65, rrifStart2: 72, pensionSplit: 'opt', useYounger: 'no', strategy: 'min', fillTarget: 58500, fixedAmt: 40000, fillUntil: 95, order: 'cash,inv,tfsa,reg' },
      { name: 'Option 2 · RRSP meltdown, CPP/OAS at 70', cppAge: 70, oasAge: 70, rrifStart: 65, cppAge2: 70, oasAge2: 70, rrifStart2: 65, pensionSplit: 'opt', useYounger: 'no', strategy: 'fill', fillTarget: 58500, fixedAmt: 40000, fillUntil: 95, order: 'cash,inv,reg,tfsa' },
      { name: 'Option 3 · Fixed draw, CPP 67 / OAS 65', cppAge: 67, oasAge: 65, rrifStart: 65, cppAge2: 67, oasAge2: 65, rrifStart2: 65, pensionSplit: 'opt', useYounger: 'no', strategy: 'fixed', fillTarget: 80000, fixedAmt: 45000, fillUntil: 95, order: 'cash,inv,reg,tfsa' },
    ],
    budget: {
      housing: 900, utilities: 300, propertyTax: 400, homeInsurance: 110, maintenance: 200,
      groceries: 800, dining: 250, transport: 500, health: 250, insurance: 100,
      phoneInternet: 150, personal: 150, travel: 500, gifts: 150, other: 140,
    },
  };

  const PROFILE_FIELDS = [
    ['Household', [
      ['spouseOn', 'Plan for', null, [['no', 'Just me'], ['yes', 'Me and my spouse / partner']]],
      ['province', 'Province', null, Object.entries(TD.provinces).map(([k, v]) => [k, v.name])],
      ['inflation', 'Inflation %/yr'],
    ]],
    ['About you', [
      ['age', 'Current age'], ['retireAge', 'Retirement age'], ['endAge', 'Plan to age', 'Life expectancy for the plan'],
      ['empIncome', 'Employment income until retirement', 'Only used to tax income received before you retire'],
    ]],
    ['RRSP / RRIF (incl. LIRA / spousal treated the same)', [
      ['rrsp', 'RRSP balance'], ['rrif', 'RRIF balance (already converted)'], ['rReg', 'Return %/yr'],
      ['contribRrsp', 'RRSP contribution / yr until retiring'],
    ]],
    ['TFSA', [
      ['tfsa', 'TFSA balance'], ['tfsaRoom', 'Unused TFSA room today'], ['rTfsa', 'Return %/yr'],
      ['contribTfsa', 'TFSA contribution / yr until retiring'],
    ]],
    ['Non-registered', [
      ['cash', 'Savings + chequing + GICs', 'Interest fully taxable'], ['rCash', 'Interest %/yr'],
      ['inv', 'Investments (mutual funds, ETFs, stocks)'], ['invAcb', 'Adjusted cost base (ACB)', 'What you paid — gains above this are 50% taxable'],
      ['rInv', 'Total return %/yr'], ['divYield', 'Of which eligible dividends %/yr'],
      ['contribNonreg', 'Non-reg savings / yr until retiring'],
    ]],
    ['FHSA', [
      ['fhsa', 'FHSA balance'],
      ['fhsaAction', 'Plan for FHSA', null, [['rrsp', 'Transfer to RRSP/RRIF (tax-free)'], ['home', 'Qualifying home purchase (tax-free)']]],
      ['fhsaAge', 'At age', 'Must close by end of year you turn 71'],
    ]],
    ['RESP', [
      ['respBal', 'RESP balance'], ['respContrib', 'Your contributions in it'], ['respGrants', 'CESG / grants in it'], ['rResp', 'Return %/yr'],
      ['respAction', 'Plan for RESP', null, [['eap', 'Child studies (EAP to student)'], ['collapse', 'Collapse — AIP to RRSP / taxed']]],
      ['respAge', 'At your age'],
    ]],
    ['Government & pension income', [
      ['cpp65', 'CPP at 65 ($/month, today\'s $)', 'From your My Service Canada statement. Max 2026 ≈ $1,508'],
      ['oasYears', 'Years in Canada after 18 (max 40)'],
      ['dbPension', 'Workplace (DB) pension $/yr at start'], ['dbStart', 'DB pension start age'], ['dbIndex', 'DB indexing %/yr'],
      ['dbSurvivor', 'DB survivor pension %', 'Paid to your spouse after your death', null, 'couple'],
      ['otherIncome', 'Other taxable income $/yr (part-time, rental)'], ['otherUntil', 'Other income until age'],
    ]],
    ['Spending', [
      ['spending', 'After-tax spending / yr (today\'s $)', 'Fill in from the Budget tab'],
      ['slowAge', 'Spending changes from age', 'Your age'], ['slowPct', 'Change %', 'e.g. −15 for the "slow-go" years'],
      ['survivorPct', 'Survivor spends % of couple budget', 'After the first death', null, 'couple'],
    ]],
    ['Spouse / partner — about', [
      ['s_age', 'Current age'], ['s_retireAge', 'Retirement age'], ['s_endAge', 'Plan to age'],
      ['s_empIncome', 'Employment income until retirement', 'If they keep working after you retire, this pays part of the household budget'],
    ], 'couple'],
    ['Spouse / partner — accounts', [
      ['s_rrsp', 'RRSP balance'], ['s_rrif', 'RRIF balance'], ['s_contribRrsp', 'RRSP contribution / yr until retiring'],
      ['s_tfsa', 'TFSA balance'], ['s_tfsaRoom', 'Unused TFSA room'], ['s_contribTfsa', 'TFSA contribution / yr until retiring'],
      ['s_cash', 'Savings + chequing + GICs'], ['s_inv', 'Investments (MF, ETFs, stocks)'], ['s_invAcb', 'Adjusted cost base (ACB)'],
      ['s_contribNonreg', 'Non-reg savings / yr until retiring'],
    ], 'couple', "Returns use the same rates as yours. Joint accounts: enter each person's share."],
    ['Spouse / partner — government & pension income', [
      ['s_cpp65', "CPP at 65 ($/month, today's $)"], ['s_oasYears', 'Years in Canada after 18 (max 40)'],
      ['s_dbPension', 'DB pension $/yr at start'], ['s_dbStart', 'DB pension start age'], ['s_dbIndex', 'DB indexing %/yr'],
      ['s_dbSurvivor', 'DB survivor pension %', 'Paid to you after their death'],
      ['s_otherIncome', 'Other taxable income $/yr'], ['s_otherUntil', 'Other income until their age'],
    ], 'couple'],
  ];

  const BUDGET_FIELDS = [
    ['housing', 'Rent / mortgage / condo fees'], ['utilities', 'Utilities (hydro, heat, water)'], ['propertyTax', 'Property tax'],
    ['homeInsurance', 'Home insurance'], ['maintenance', 'Home maintenance'], ['groceries', 'Groceries'], ['dining', 'Dining out'],
    ['transport', 'Car, gas, transit'], ['health', 'Health, dental, drugs'], ['insurance', 'Life / other insurance'],
    ['phoneInternet', 'Phone, internet, TV'], ['personal', 'Clothing & personal care'], ['travel', 'Travel & recreation'],
    ['gifts', 'Gifts & donations'], ['other', 'Other / irregular (÷12)'],
  ];

  // ---------- state ----------
  function load() {
    try {
      const s = JSON.parse(localStorage.getItem(STORE));
      if (s && s.profile && s.scenarios) {
        return { profile: { ...DEFAULTS.profile, ...s.profile }, scenarios: s.scenarios.map((x, i) => ({ ...DEFAULTS.scenarios[i], ...x })), budget: { ...DEFAULTS.budget, ...s.budget } };
      }
    } catch (e) { /* storage unavailable */ }
    return JSON.parse(JSON.stringify(DEFAULTS));
  }
  function save() { try { localStorage.setItem(STORE, JSON.stringify(state)); } catch (e) { /* ignore */ } }
  let state = load();
  const isCouple = () => state.profile.spouseOn === 'yes';
  let results = [];

  // ---------- form builders ----------
  function field(key, label, help, opts, obj, attrs = '') {
    const v = obj[key];
    const input = opts
      ? `<select data-key="${key}" ${attrs}>${opts.map(([val, txt]) => `<option value="${val}"${String(val) === String(v) ? ' selected' : ''}>${txt}</option>`).join('')}</select>`
      : `<input type="${typeof v === 'number' ? 'number' : 'text'}" step="any" data-key="${key}" value="${v}" ${attrs}>`;
    return `<label>${label}${input}${help ? `<span class="help">${help}</span>` : ''}</label>`;
  }

  function renderProfile() {
    const couple = isCouple();
    $('#profile-form').innerHTML = PROFILE_FIELDS.filter(g => couple || g[2] !== 'couple').map(([title, fields, , note]) =>
      `<fieldset class="card"><legend>${title}</legend>${note ? `<p class="muted small">${note}</p>` : ''}<div class="grid">${fields.filter(x => couple || x[4] !== 'couple').map(([k, l, h, o]) => field(k, l, h, o, state.profile)).join('')}</div></fieldset>`).join('');
    $$('#profile-form [data-key]').forEach(el => el.addEventListener('input', () => {
      state.profile[el.dataset.key] = el.tagName === 'SELECT' || el.type === 'text' ? el.value : Number(el.value);
      if (el.dataset.key === 'spouseOn') { renderProfile(); renderScenarios(); }
      changed();
    }));
  }

  function renderBudget() {
    $('#budget-form').innerHTML = BUDGET_FIELDS.map(([k, l]) => field(k, l, null, null, state.budget)).join('');
    $$('#budget-form [data-key]').forEach(el => el.addEventListener('input', () => { state.budget[el.dataset.key] = Number(el.value) || 0; updateBudget(); save(); }));
    updateBudget();
  }
  function updateBudget() {
    const m = Object.values(state.budget).reduce((a, b) => a + (Number(b) || 0), 0);
    $('#budget-month').textContent = money(m);
    $('#budget-year').textContent = money(m * 12);
    return m * 12;
  }
  $('#budget-apply').addEventListener('click', () => {
    state.profile.spending = Math.round(updateBudget());
    renderProfile();
    changed();
    $('#budget-apply').textContent = 'Applied ✓';
    setTimeout(() => ($('#budget-apply').textContent = 'Use as retirement spending'), 1500);
  });

  const COLORS = ['--s1', '--s2', '--s3'];
  const css = v => getComputedStyle(document.documentElement).getPropertyValue(v).trim();

  function renderScenarios() {
    const C = isCouple();
    $('#scenario-cards').innerHTML = state.scenarios.map((s, i) => `
      <div class="card scen" style="--c:var(${COLORS[i]})" data-i="${i}">
        <div class="grid">
          <div class="full">${field('name', 'Name', null, null, s)}</div>
          ${field('cppAge', (C ? 'You: ' : '') + 'CPP starts at', `×${E.cppFactor(s.cppAge).toFixed(2)} of age-65 amount`, range(60, 70).map(a => [a, a]), s)}
          ${field('oasAge', (C ? 'You: ' : '') + 'OAS starts at', `×${E.oasFactor(s.oasAge).toFixed(2)} of age-65 amount`, range(65, 70).map(a => [a, a]), s)}
          ${C ? field('cppAge2', 'Spouse: CPP starts at', `×${E.cppFactor(s.cppAge2).toFixed(2)}`, range(60, 70).map(a => [a, a]), s) : ''}
          ${C ? field('oasAge2', 'Spouse: OAS starts at', `×${E.oasFactor(s.oasAge2).toFixed(2)}`, range(65, 70).map(a => [a, a]), s) : ''}
          <div class="full">${field('rrifStart', (C ? 'You: ' : '') + 'RRIF minimums start at age', 'Convert RRSP→RRIF the year before. Latest: convert by end of age 71, first minimum at 72. Converting by 64 gives the pension credit at 65+.', range(55, 72).map(a => [a, a]), s)}</div>
          ${C ? `<div class="full">${field('rrifStart2', 'Spouse: RRIF minimums start at age', null, range(55, 72).map(a => [a, a]), s)}</div>` : ''}
          ${C ? field('pensionSplit', 'Pension income splitting', 'Up to 50% of RRIF (65+) and DB pension income', [['opt', 'Optimize each year'], ['none', 'Off']], s) : ''}
          ${C ? field('useYounger', 'RRIF minimum based on', "Younger spouse's age = lower minimums", [['no', 'Own age'], ['yes', "Younger spouse's age"]], s) : ''}
          <div class="full">${field('strategy', 'RRSP / RRIF withdrawal strategy', null, STRATEGIES, s)}</div>
          ${s.strategy === 'fill' ? field('fillTarget', 'Fill taxable income to ($, today\'s)' + (C ? ' — each person' : ''), `Top of 1st federal bracket ${money(TD.federal.brackets[0][0])}; OAS clawback starts ${money(TD.oas.clawbackThreshold)}`, null, s) : ''}
          ${s.strategy === 'fixed' ? field('fixedAmt', 'Annual withdrawal ($, today\'s)' + (C ? ' — each person' : ''), 'Never less than the RRIF minimum', null, s) : ''}
          ${s.strategy !== 'min' ? field('fillUntil', 'Use this strategy until age', 'Then minimums only', null, s) : ''}
          <div class="full">${field('order', 'Order for any extra cash needed', null, ORDERS, s)}</div>
        </div>
        <div class="btns">
          <button data-opt="draw" class="primary">Optimize RRSP draw</button>
          <button data-opt="all">Optimize draw + CPP/OAS ages</button>
        </div>
        <div class="opt-msg"></div>
      </div>`).join('');

    $$('#scenario-cards .scen').forEach(card => {
      const i = Number(card.dataset.i);
      $$('[data-key]', card).forEach(el => el.addEventListener('change', () => {
        const k = el.dataset.key;
        state.scenarios[i][k] = ['name', 'strategy', 'order', 'pensionSplit', 'useYounger'].includes(k) ? el.value : Number(el.value);
        if (['strategy', 'cppAge', 'oasAge', 'cppAge2', 'oasAge2'].includes(k)) renderScenarios();
        changed();
      }));
      $$('[data-opt]', card).forEach(btn => btn.addEventListener('click', () => runOptimize(i, btn.dataset.opt === 'all', card)));
    });
  }

  function runOptimize(i, withTiming, card) {
    const msg = $('.opt-msg', card);
    $$('button', card).forEach(b => (b.disabled = true));
    msg.textContent = 'Searching…';
    setTimeout(() => {
      const before = E.simulate(state.profile, state.scenarios[i]).summary;
      const best = E.optimize(state.profile, state.scenarios[i], withTiming);
      const oldName = state.scenarios[i].name;
      const isDefault = DEFAULTS.scenarios.some(d => d.name === oldName);
      state.scenarios[i] = { ...best.scenario, name: isDefault ? `Option ${i + 1} · Optimized` : oldName };
      renderScenarios();
      changed();
      const s = best.scenario;
      const newMsg = $(`.scen[data-i="${i}"] .opt-msg`);
      newMsg.textContent = (s.strategy === 'fill' ? `Best: fill taxable income to ${money(s.fillTarget)}` : 'Best: RRIF minimums only')
        + (withTiming ? `, CPP at ${s.cppAge}, OAS at ${s.oasAge}${isCouple() ? ' (both of you)' : ''}` : '')
        + `. After-tax estate ${money(before.estate)} → ${money(best.res.summary.estate)}.`;
    }, 30);
  }

  // ---------- results ----------
  let charts = {};
  function changed() {
    save();
    clearTimeout(changed.t);
    changed.t = setTimeout(recalc, 200);
  }

  function validate(p) {
    if (p.endAge <= p.retireAge || p.retireAge < p.age) return 'Check ages: current ≤ retirement < plan-to age.';
    if (p.spouseOn === 'yes' && (p.s_endAge <= p.s_retireAge || p.s_retireAge < p.s_age)) return 'Check spouse ages: current ≤ retirement < plan-to age.';
    return null;
  }

  function recalc() {
    const p = state.profile;
    const err = validate(p);
    if (err) { $('#compare').innerHTML = `<tr><td class="bad">${err}</td></tr>`; return; }
    results = state.scenarios.map(s => E.simulate(p, s));
    renderCompare();
    renderCharts();
    renderDetail();
  }

  function renderCompare() {
    const S = results.map(r => r.summary);
    const best = (vals, hi) => { const b = hi ? Math.max(...vals) : Math.min(...vals); return vals.map(v => Math.abs(v - b) < 1); };
    const rows = [
      ['Money lasts', S.map(s => s.depletedAge ? `runs short at ${s.depletedAge}` : `to ${state.profile.endAge} ✓`), S.map(s => !s.depletedAge), S.map(s => !!s.depletedAge)],
      ['After-tax estate at end', S.map(s => money(s.estate)), best(S.map(s => s.estate), true)],
      ['Lifetime income tax + clawback', S.map(s => money(s.lifetimeTax)), best(S.map(s => s.lifetimeTax), false)],
      ['…of which OAS clawback', S.map(s => money(s.clawback)), best(S.map(s => s.clawback), false)],
      ['Tax on RRIF/gains at death', S.map(s => money(s.deathTax)), best(S.map(s => s.deathTax), false)],
      ['Average tax rate in retirement', S.map(s => pct(s.avgRate)), best(S.map(s => s.avgRate), false)],
      ['CPP + OAS kept (lifetime)', S.map(s => money(s.cppOas)), best(S.map(s => s.cppOas), true)],
      ...(isCouple() ? [['Pension income split (lifetime)', S.map(s => money(s.split))]] : []),
      ['RRSP/RRIF withdrawal, 1st retired year', S.map(s => money(s.firstRegW))],
      ['Unfunded spending', S.map(s => money(s.shortfall)), null, S.map(s => s.shortfall > 1)],
    ];
    $('#compare').innerHTML = `<thead><tr><th></th>${state.scenarios.map((s, i) => `<th><span class="swatch" style="--c:var(${COLORS[i]})"></span>${s.name}</th>`).join('')}</tr></thead>
      <tbody>${rows.map(([label, vals, good, bad]) => `<tr><td>${label}</td>${vals.map((v, i) => `<td class="${good && good[i] ? 'best' : ''}${bad && bad[i] ? ' bad' : ''}">${v}</td>`).join('')}</tr>`).join('')}</tbody>`;
  }

  function chartDefaults() {
    if (!window.Chart) return false;
    Chart.defaults.color = css('--muted');
    Chart.defaults.borderColor = css('--border');
    Chart.defaults.font.family = getComputedStyle(document.body).fontFamily;
    return true;
  }
  const kfmt = v => '$' + (Math.abs(v) >= 1e6 ? (v / 1e6).toFixed(1) + 'M' : Math.round(v / 1000) + 'k');

  function lineChart(id, key, fn) {
    const labels = results[0].rows.map(r => r.label);
    const datasets = results.map((res, i) => ({
      label: state.scenarios[i].name, data: res.rows.map(fn), borderColor: css(COLORS[i]), backgroundColor: css(COLORS[i]),
      pointRadius: 0, borderWidth: 2, tension: 0.2,
    }));
    if (charts[key]) { charts[key].data.labels = labels; charts[key].data.datasets = datasets; charts[key].update(); return; }
    charts[key] = new Chart($(id), {
      type: 'line', data: { labels, datasets },
      options: { responsive: true, maintainAspectRatio: false, interaction: { mode: 'index', intersect: false },
        scales: { y: { ticks: { callback: kfmt } }, x: { title: { display: true, text: isCouple() ? 'Age (you / spouse)' : 'Age' } } },
        plugins: { tooltip: { callbacks: { label: c => `${c.dataset.label}: ${money(c.parsed.y)}` } } } },
    });
  }

  function renderCharts() {
    if (!chartDefaults()) return;
    lineChart('#ch-bal', 'bal', r => r.total / r.f);
    lineChart('#ch-tax', 'tax', r => (r.working ? null : r.tax / r.f));
    renderMix();
  }

  function renderMix() {
    const i = Number($('#mix-scen').value || 0);
    const rows = results[i].rows.filter(r => !r.working);
    const series = [
      ['Employment (net of RRSP contrib.)', r => r.emp, '#7a8a99'], ['CPP', r => r.cpp, '#6c8ebf'], ['OAS (after clawback)', r => r.oas - r.clawback, '#9fb8d9'],
      ['DB pension + other', r => r.db + r.other, '#8a7fb8'], ['Interest + dividends', r => r.interest + r.div, '#b6a96b'],
      ['RRSP/RRIF', r => r.regW, css('--s2')], ['Non-reg sales', r => r.cashW + r.invW, '#d9b26b'], ['TFSA', r => r.tfsaW, css('--s3')],
      ['Tax', r => -(r.tax - r.clawback), css('--bad')],
    ];
    const datasets = series.map(([label, fn, color]) => ({ label, data: rows.map(r => fn(r) / r.f), backgroundColor: color, stack: 's' }));
    const labels = rows.map(r => r.label);
    if (charts.mix) { charts.mix.data.labels = labels; charts.mix.data.datasets = datasets; charts.mix.update(); return; }
    charts.mix = new Chart($('#ch-mix'), {
      type: 'bar', data: { labels, datasets },
      options: { responsive: true, maintainAspectRatio: false, interaction: { mode: 'index', intersect: false },
        scales: { x: { stacked: true, title: { display: true, text: 'Age (today\'s $)' } }, y: { stacked: true, ticks: { callback: kfmt } } },
        plugins: { tooltip: { callbacks: { label: c => `${c.dataset.label}: ${money(c.parsed.y)}` } } } },
    });
  }

  const DETAIL_COLS = [
    ['Age', r => r.label, 'n'], ['Spending', r => r.need], ['Employment', r => r.emp], ['CPP', r => r.cpp], ['OAS', r => r.oas], ['DB+other', r => r.db + r.other],
    ['Int+div', r => r.interest + r.div], ['RRIF min', r => r.minW], ['RRSP/RRIF out', r => r.regW], ['Withholding*', r => r.withholding],
    ['Non-reg out', r => r.cashW + r.invW], ['TFSA out', r => r.tfsaW], ['Taxable inc.', r => r.taxable, 'tx'],
    ['Pension split', r => r.split, 'sp'], ['Tax', r => r.tax && r.tax - r.clawback],
    ['OAS clawback', r => r.clawback], ['Marginal', r => r.marginal, 'p'], ['→TFSA', r => r.toTfsa], ['→Non-reg', r => r.toNonreg],
    ['RRSP/RRIF', r => r.reg], ['TFSA', r => r.tfsa], ['Non-reg', r => r.cash + r.inv], ['Total', r => r.total], ['Short', r => r.shortfall],
  ];

  function renderDetail() {
    const i = Number($('#detail-scen').value || 0);
    const real = $('#real-toggle').checked;
    const cell = (r, [, fn, t]) => {
      const v = fn(r);
      if (v == null) return '—';
      if (t === 'n') return v;
      if (t === 'p') return pct(v);
      const m = x => money(real ? x / r.f : x);
      if (t === 'tx') return r.taxables && r.taxables.length === 2 ? r.taxables.map(x => (x == null ? '—' : m(x))).join(' / ') : m(v);
      if (t === 'sp') return !v || Math.abs(v) < 1 ? '—' : (v > 0 ? 'you→sp ' : 'sp→you ') + m(Math.abs(v));
      return m(v);
    };
    $('#detail').innerHTML = `<thead><tr>${DETAIL_COLS.map(c => `<th>${c[0]}</th>`).join('')}<th>Notes</th></tr></thead><tbody>${
      results[i].rows.map(r => `<tr class="${r.working ? 'working' : ''}">${DETAIL_COLS.map(c => `<td class="${c[0] === 'Short' && r.shortfall > 1 ? 'bad' : ''}">${cell(r, c)}</td>`).join('')}<td class="note">${(r.working ? ['Working / saving'] : []).concat(r.notes).join('; ')}</td></tr>`).join('')
    }</tbody>`;
  }

  function exportCsv() {
    const i = Number($('#detail-scen').value || 0);
    const real = $('#real-toggle').checked;
    const lines = [DETAIL_COLS.map(c => c[0]).concat('Notes').join(',')];
    for (const r of results[i].rows) {
      lines.push(DETAIL_COLS.map(([, fn, t]) => { const v = fn(r); return v == null ? '' : t === 'n' ? v : t === 'p' ? (v * 100).toFixed(1) : Math.round(real ? v / r.f : v); })
        .concat('"' + (r.notes.join('; ')) + '"').join(','));
    }
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([lines.join('\n')], { type: 'text/csv' }));
    a.download = `retirement-plan-option-${i + 1}.csv`;
    a.click();
  }

  function fillSelects() {
    const opts = state.scenarios.map((s, i) => `<option value="${i}">${s.name}</option>`).join('');
    for (const id of ['#mix-scen', '#detail-scen']) { const v = $(id).value; $(id).innerHTML = opts; if (v) $(id).value = v; }
  }

  // ---------- RRIF table ----------
  function renderRrifTable() {
    const ages = range(55, 95);
    const half = Math.ceil(ages.length / 2);
    const p2 = a => (E.rrifMinRate(a) * 100).toFixed(2) + '%';
    const rows = [];
    for (let k = 0; k < half; k++) {
      const a = ages[k], b = ages[k + half];
      rows.push(`<tr><td>${a}</td><td>${p2(a)}</td><td>${b ? (b === 95 ? '95+' : b) : ''}</td><td>${b ? p2(b) : ''}</td></tr>`);
    }
    $('#rrif-table').innerHTML = `<thead><tr><th>Age Jan 1</th><th>Min %</th><th>Age Jan 1</th><th>Min %</th></tr></thead><tbody>${rows.join('')}</tbody>`;
    const upd = () => {
      const bal = Number($('#rc-bal').value) || 0, age = Math.max(20, Math.min(120, Number($('#rc-age').value) || 71));
      const rate = E.rrifMinRate(age);
      $('#rc-out').textContent = `${money(bal * rate)} (${(rate * 100).toFixed(2)}%)`;
    };
    $('#rc-bal').addEventListener('input', upd);
    $('#rc-age').addEventListener('input', upd);
    upd();
  }

  // ---------- tabs ----------
  $$('.tabs button').forEach(b => b.addEventListener('click', () => {
    $$('.tabs button').forEach(x => x.classList.toggle('active', x === b));
    $$('.tab').forEach(t => t.classList.toggle('active', t.id === 'tab-' + b.dataset.tab));
    if (b.dataset.tab === 'results') { fillSelects(); recalc(); }
  }));
  $('#mix-scen').addEventListener('change', renderMix);
  $('#detail-scen').addEventListener('change', renderDetail);
  $('#real-toggle').addEventListener('change', renderDetail);
  $('#csv').addEventListener('click', exportCsv);

  renderProfile();
  renderBudget();
  renderScenarios();
  renderRrifTable();
  fillSelects();
  recalc();
  window.__planner = { state: () => state, results: () => results };
})();
