// Household document (what's saved per household) and conversion to engine inputs.
(function () {
  const ACCOUNT_TYPES = [
    ['RRSP', 'RRSP / spousal RRSP'], ['LIRA', 'LIRA / locked-in'], ['DCPP', 'DC pension / group RRSP'],
    ['RRIF', 'RRIF'], ['LIF', 'LIF'], ['TFSA', 'TFSA'], ['FHSA', 'FHSA'], ['RESP', 'RESP'],
    ['CASH', 'Savings / chequing / GIC'], ['NONREG', 'Non-reg investments (MF, ETFs, stocks)'],
  ];
  const ASSET_TYPES = [
    ['principal', 'Principal residence'], ['rental', 'Rental property'], ['cottage', 'Cottage / second home'],
    ['land', 'Land'], ['gold', 'Gold / precious metals'], ['vehicle', 'Vehicle'], ['collectibles', 'Art / collectibles'],
    ['business', 'Business / private shares'], ['other', 'Other'],
  ];
  const LIABILITY_TYPES = [
    ['mortgage', 'Mortgage'], ['heloc', 'Home equity line (HELOC)'], ['loc', 'Line of credit'], ['car', 'Car loan / lease'],
    ['student', 'Student loan'], ['credit', 'Credit card'], ['other', 'Other loan'],
  ];
  const EMPLOYMENT = [['employed', 'Employed'], ['self', 'Self-employed'], ['retired', 'Retired'], ['not', 'Not working'], ['student', 'Student']];
  const EXPENSES = [
    ['housing', 'Rent / condo fees (mortgage goes in Liabilities)'], ['utilities', 'Utilities (hydro, heat, water)'], ['propertyTax', 'Property tax'],
    ['homeInsurance', 'Home insurance'], ['maintenance', 'Home maintenance'], ['groceries', 'Groceries'], ['dining', 'Dining out'],
    ['transport', 'Car, gas, transit'], ['health', 'Health, dental, drugs'], ['insurance', 'Life / other insurance premiums'],
    ['phoneInternet', 'Phone, internet, TV'], ['personal', 'Clothing & personal care'], ['travel', 'Travel & recreation'],
    ['gifts', 'Gifts & donations'], ['other', 'Other / irregular (÷12)'],
  ];

  const uid = () => Math.random().toString(36).slice(2, 10);

  function person(over = {}) {
    return {
      firstName: '', lastName: '', dob: '', email: '', phone: '', employment: 'employed', occupation: '',
      retireAge: 65, endAge: 95, empIncome: 0, contribRrsp: 0, contribTfsa: 0, contribNonreg: 0, tfsaRoom: 0,
      cpp65: 900, oasYears: 40, dbPension: 0, dbStart: 65, dbIndex: 0, dbSurvivor: 60,
      ...over,
    };
  }
  const SCENARIOS = [
    { name: 'Option 1 · Your plan', cppAge: 65, oasAge: 65, rrifStart: 72, cppAge2: 65, oasAge2: 65, rrifStart2: 72, pensionSplit: 'opt', useYounger: 'no', strategy: 'min', fillTarget: 58500, fixedAmt: 40000, fillUntil: 95, order: 'cash,inv,tfsa,reg' },
    { name: 'Option 2 · RRSP meltdown, CPP/OAS at 70', cppAge: 70, oasAge: 70, rrifStart: 65, cppAge2: 70, oasAge2: 70, rrifStart2: 65, pensionSplit: 'opt', useYounger: 'no', strategy: 'fill', fillTarget: 58500, fixedAmt: 40000, fillUntil: 95, order: 'cash,inv,reg,tfsa' },
    { name: 'Option 3 · Fixed draw, CPP 67 / OAS 65', cppAge: 67, oasAge: 65, rrifStart: 65, cppAge2: 67, oasAge2: 65, rrifStart2: 65, pensionSplit: 'opt', useYounger: 'no', strategy: 'fixed', fillTarget: 80000, fixedAmt: 45000, fillUntil: 95, order: 'cash,inv,reg,tfsa' },
  ];

  function newHousehold(user = {}) {
    return {
      version: 1,
      household: { province: 'ON', address: '', city: '', postalCode: '', notifications: 'email' },
      you: person({ firstName: user.firstName || '', lastName: user.lastName || '', email: user.email || '' }),
      hasSpouse: 'no',
      spouse: person({ cpp65: 700 }),
      hasDependents: 'no',
      dependents: [],
      goals: { slowAge: 80, slowPct: -15, survivorPct: 70 },
      assumptions: { inflation: 2.1, rReg: 5, rTfsa: 5, rInv: 5, divYield: 2, rCash: 2.5, rResp: 4 },
      accounts: [],
      assets: [],
      liabilities: [],
      budget: { income: [], expenses: Object.fromEntries(EXPENSES.map(([k]) => [k, 0])) },
      insurance: [],
      scenarios: JSON.parse(JSON.stringify(SCENARIOS)),
      dashboardScenario: 0,
    };
  }

  function sampleCouple(user = {}) {
    const d = newHousehold(user);
    const y = new Date().getFullYear();
    Object.assign(d.household, { province: 'ON', address: '12 Maple Ave', city: 'Toronto', postalCode: 'M4C 1A1' });
    Object.assign(d.you, { dob: `${y - 60}-04-15`, employment: 'employed', occupation: 'Engineer', retireAge: 62, empIncome: 90000, contribRrsp: 15000, contribTfsa: 7000, tfsaRoom: 20000, cpp65: 1100 });
    d.hasSpouse = 'yes';
    Object.assign(d.spouse, { firstName: 'Sam', lastName: user.lastName || 'Client', dob: `${y - 58}-09-02`, employment: 'employed', occupation: 'Teacher', retireAge: 62, empIncome: 70000, contribRrsp: 0, contribTfsa: 7000, tfsaRoom: 15000, cpp65: 800, dbPension: 30000, dbStart: 62, dbIndex: 2 });
    d.hasDependents = 'yes';
    d.dependents = [{ id: uid(), firstName: 'Riley', lastName: user.lastName || 'Client', dob: `${y - 19}-01-20`, relationship: 'Child', notes: 'University' }];
    d.accounts = [
      { id: uid(), owner: 'you', type: 'RRSP', name: 'Bank RRSP', balance: 600000 },
      { id: uid(), owner: 'you', type: 'TFSA', name: 'TFSA', balance: 100000 },
      { id: uid(), owner: 'you', type: 'CASH', name: 'Savings + chequing', balance: 30000 },
      { id: uid(), owner: 'you', type: 'NONREG', name: 'Mutual funds', balance: 150000, acb: 100000 },
      { id: uid(), owner: 'spouse', type: 'RRSP', name: 'RRSP', balance: 150000 },
      { id: uid(), owner: 'spouse', type: 'TFSA', name: 'TFSA', balance: 80000 },
      { id: uid(), owner: 'you', type: 'RESP', name: 'Family RESP', balance: 45000, contrib: 30000, grants: 6000, plan: 'eap', atAge: 61 },
    ];
    d.assets = [
      { id: uid(), type: 'principal', name: 'Home', owner: 'joint', value: 950000, cost: 400000, growth: 3, income: 0, sellAge: 0 },
      { id: uid(), type: 'vehicle', name: 'Car', owner: 'you', value: 25000, cost: 40000, growth: -15, income: 0, sellAge: 0 },
    ];
    d.liabilities = [{ id: uid(), type: 'mortgage', name: 'Mortgage', balance: 120000, rate: 4.8, payment: 1600 }];
    d.budget.income = [{ id: uid(), owner: 'spouse', name: 'Tutoring', monthly: 800, untilAge: 67 }];
    Object.assign(d.budget.expenses, { housing: 0, utilities: 350, propertyTax: 450, homeInsurance: 120, maintenance: 250, groceries: 1000, dining: 300, transport: 600, health: 300, insurance: 150, phoneInternet: 180, personal: 200, travel: 800, gifts: 200, other: 200 });
    return d;
  }

  function ageFromDob(dob) {
    if (!dob) return null;
    const b = new Date(dob + 'T00:00:00'), n = new Date();
    if (isNaN(b)) return null;
    let a = n.getFullYear() - b.getFullYear();
    if (n.getMonth() < b.getMonth() || (n.getMonth() === b.getMonth() && n.getDate() < b.getDate())) a--;
    return a;
  }

  const num = v => (v === '' || v == null || isNaN(+v) ? 0 : +v);
  const sumBy = (arr, fn) => arr.reduce((t, x) => t + fn(x), 0);
  const annualSpending = d => 12 * Object.values(d.budget.expenses).reduce((t, v) => t + num(v), 0);

  // Missing data the engine needs; shown as prompts in the app.
  function missing(d) {
    const m = [];
    if (!d.you.dob) m.push('Your date of birth (Profile)');
    if (d.hasSpouse === 'yes' && !d.spouse.dob) m.push("Spouse's date of birth (Profile)");
    if (!annualSpending(d)) m.push('Retirement expenses (Budget)');
    if (!d.accounts.length) m.push('At least one account (Accounts)');
    return m;
  }

  function toEngineInputs(d) {
    const couple = d.hasSpouse === 'yes';
    const owners = couple ? ['you', 'spouse'] : ['you'];
    const p = {
      province: d.household.province || 'ON',
      ...Object.fromEntries(Object.entries(d.assumptions).map(([k, v]) => [k, num(v)])),
      spending: annualSpending(d),
      slowAge: num(d.goals.slowAge) || 200, slowPct: num(d.goals.slowPct), survivorPct: num(d.goals.survivorPct) || 100,
      spouseOn: couple ? 'yes' : 'no',
    };
    // With no spouse in the plan, everything counts as yours.
    const ownerOfItem = o => (couple ? o || 'you' : 'you');
    owners.forEach((who, i) => {
      const pre = i === 0 ? '' : 's_', x = d[who];
      const age = ageFromDob(x.dob);
      p[pre + 'age'] = age == null ? (i === 0 ? 60 : 58) : age;
      for (const k of ['retireAge', 'endAge', 'empIncome', 'contribRrsp', 'contribTfsa', 'contribNonreg', 'tfsaRoom', 'cpp65', 'oasYears', 'dbPension', 'dbStart', 'dbIndex', 'dbSurvivor']) p[pre + k] = num(x[k]);
      // Already retired: retirement age can't be in the past.
      p[pre + 'retireAge'] = Math.max(p[pre + 'retireAge'], p[pre + 'age']);
      const mine = d.accounts.filter(a => ownerOfItem(a.owner) === who);
      const bal = types => sumBy(mine.filter(a => types.includes(a.type)), a => num(a.balance));
      p[pre + 'rrsp'] = bal(['RRSP', 'LIRA', 'DCPP']);
      p[pre + 'rrif'] = bal(['RRIF', 'LIF']);
      p[pre + 'tfsa'] = bal(['TFSA']);
      p[pre + 'cash'] = bal(['CASH']);
      p[pre + 'inv'] = bal(['NONREG']);
      p[pre + 'invAcb'] = sumBy(mine.filter(a => a.type === 'NONREG'), a => (a.acb === '' || a.acb == null ? num(a.balance) : num(a.acb)));
      p[pre + 'otherList'] = d.budget.income.filter(o => ownerOfItem(o.owner) === who).map(o => ({ amount: num(o.monthly) * 12, untilAge: num(o.untilAge) || 200 }));
    });
    const fhsa = d.accounts.filter(a => a.type === 'FHSA'), resp = d.accounts.filter(a => a.type === 'RESP');
    p.fhsa = sumBy(fhsa, a => num(a.balance));
    p.fhsaAction = fhsa[0] ? fhsa[0].plan || 'rrsp' : 'rrsp';
    p.fhsaAge = fhsa[0] ? num(fhsa[0].atAge) || p.retireAge : p.retireAge;
    p.respBal = sumBy(resp, a => num(a.balance));
    p.respContrib = sumBy(resp, a => num(a.contrib));
    p.respGrants = sumBy(resp, a => num(a.grants));
    p.respAction = resp[0] ? resp[0].plan || 'eap' : 'eap';
    p.respAge = resp[0] ? num(resp[0].atAge) || p.age : p.age;
    const ownerIdx = o => (o === 'spouse' && couple ? 1 : 0);
    p.assets = d.assets.map(a => ({ ...a, owner: ownerIdx(a.owner) }));
    p.liabilities = d.liabilities.map(l => ({ ...l }));
    return p;
  }

  function netWorth(d) {
    const accounts = sumBy(d.accounts, a => num(a.balance));
    const assets = sumBy(d.assets, a => num(a.value));
    const debts = sumBy(d.liabilities, l => num(l.balance));
    return { accounts, assets, debts, total: accounts + assets - debts };
  }

  // Assumed RAG rules until the client confirms thresholds (see docs/PLAN.md).
  function ragStatus(summary, rows, spending) {
    const reasons = [];
    if (summary.depletedAge) return { status: 'red', reasons: [`Savings run short at age ${summary.depletedAge}`] };
    const cushionYears = spending > 0 ? summary.estate / spending : 99;
    if (cushionYears < 2) reasons.push(`Thin cushion: about ${cushionYears.toFixed(1)} years of spending left at the end of the plan`);
    if (summary.clawback > 1000) reasons.push('OAS clawback expected');
    if (summary.avgRate > 0.25) reasons.push(`High average tax rate in retirement (${(summary.avgRate * 100).toFixed(0)}%)`);
    const firstRet = rows.find(r => !r.working);
    if (firstRet && firstRet.debt > 1) reasons.push('Debt still owing after retirement');
    return reasons.length ? { status: 'amber', reasons } : { status: 'green', reasons: ['Spending is funded to the end of the plan with a healthy cushion'] };
  }

  window.Model = { ACCOUNT_TYPES, ASSET_TYPES, LIABILITY_TYPES, EMPLOYMENT, EXPENSES, uid, newHousehold, sampleCouple, ageFromDob, annualSpending, missing, toEngineInputs, netWorth, ragStatus };
})();
