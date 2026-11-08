// Engine regression and behaviour tests. Run: node tests/engine.test.js
const path = require('path');
global.window = {};
require(path.join(__dirname, '..', 'js', 'taxdata.js'));
require(path.join(__dirname, '..', 'js', 'engine.js'));
const E = window.Engine;

let pass = 0, fail = 0;
const check = (name, cond, info = '') => { cond ? pass++ : fail++; console.log(`${cond ? 'PASS' : 'FAIL'} ${name}${cond ? '' : '  ' + info}`); };
const near = (a, b, tol = 1) => Math.abs(a - b) <= tol;

const single = {
  age: 60, retireAge: 62, endAge: 95, province: 'ON', inflation: 2.1, empIncome: 90000,
  rrsp: 600000, rrif: 0, rReg: 5, contribRrsp: 15000, tfsa: 100000, tfsaRoom: 20000, rTfsa: 5, contribTfsa: 7000,
  cash: 30000, rCash: 2.5, inv: 150000, invAcb: 100000, rInv: 5, divYield: 2, contribNonreg: 0,
  fhsa: 0, fhsaAction: 'rrsp', fhsaAge: 62, respBal: 0, respContrib: 0, respGrants: 0, rResp: 4, respAction: 'eap', respAge: 62,
  cpp65: 1100, oasYears: 40, dbPension: 0, dbStart: 65, dbIndex: 0, otherIncome: 0, otherUntil: 70,
  spending: 58800, slowAge: 80, slowPct: -15,
};
const S = [
  { cppAge: 65, oasAge: 65, rrifStart: 72, strategy: 'min', fillTarget: 58500, fixedAmt: 40000, fillUntil: 95, order: 'cash,inv,tfsa,reg' },
  { cppAge: 70, oasAge: 70, rrifStart: 65, strategy: 'fill', fillTarget: 58500, fixedAmt: 40000, fillUntil: 95, order: 'cash,inv,reg,tfsa' },
  { cppAge: 67, oasAge: 65, rrifStart: 65, strategy: 'fixed', fillTarget: 80000, fixedAmt: 45000, fillUntil: 95, order: 'cash,inv,reg,tfsa' },
];

// 1. Tax engine spot checks (hand-calculated)
const t1 = E.computeTax({ ordinary: 50000, pensionEligible: 0, eligDiv: 0, taxableGains: 0, oas: 0 }, 50, 'ON', 1);
check('ON $50k federal tax', near(t1.fed, 4697));
check('ON $50k provincial tax incl. health premium', near(t1.prov, 2469));
const t2 = E.computeTax({ ordinary: 120000, pensionEligible: 2000, eligDiv: 0, taxableGains: 0, oas: 8900 }, 70, 'ON', 1);
check('OAS clawback 15% above threshold', near(t2.clawback, 3702));
check('RRIF factor age 72 = 5.40%', E.rrifMinRate(72) === 0.054);
check('RRIF factor age 65 = 1/25', near(E.rrifMinRate(65), 0.04, 1e-9));

// 2. Single-person results unchanged (snapshot from the first version)
const snap = [[58116, 228829], [196776, 202305], [109710, 203626]];
S.forEach((s, i) => {
  const r = E.simulate(single, s).summary;
  check(`single option ${i + 1} estate`, near(r.estate, snap[i][0]), Math.round(r.estate));
  check(`single option ${i + 1} lifetime tax`, near(r.lifetimeTax, snap[i][1]), Math.round(r.lifetimeTax));
});

// 3. Couples (snapshot from the spouse version)
const couple = {
  ...single, spending: 85000, dbSurvivor: 60, spouseOn: 'yes', survivorPct: 70,
  s_age: 58, s_retireAge: 62, s_endAge: 90, s_empIncome: 70000, s_rrsp: 150000, s_rrif: 0, s_contribRrsp: 5000,
  s_tfsa: 80000, s_tfsaRoom: 10000, s_contribTfsa: 7000, s_cash: 10000, s_inv: 0, s_invAcb: 0, s_contribNonreg: 0,
  s_cpp65: 700, s_oasYears: 40, s_dbPension: 30000, s_dbStart: 62, s_dbIndex: 2, s_dbSurvivor: 60, s_otherIncome: 0, s_otherUntil: 70,
};
const cs = { ...S[1], cppAge: 65, oasAge: 65, cppAge2: 65, oasAge2: 65, rrifStart2: 65, rrifStart: 65, useYounger: 'no', pensionSplit: 'opt' };
const cOpt = E.simulate(couple, cs).summary, cNone = E.simulate(couple, { ...cs, pensionSplit: 'none' }).summary;
check('couple estate (split on)', near(cOpt.estate, 1616387, 2), Math.round(cOpt.estate));
check('couple estate (split off)', near(cNone.estate, 1610662, 2), Math.round(cNone.estate));
check('pension splitting lowers lifetime tax', cOpt.lifetimeTax < cNone.lifetimeTax);
const deathRow = E.simulate(couple, cs).rows.find(r => r.notes.some(n => n.includes('pass away')));
check('spouse death rolls assets to survivor at 90', deathRow && deathRow.label === '92 / 90');

// 4. Assets and debts
const base = E.simulate(single, S[0]).summary;
const house = { type: 'principal', name: 'Home', value: 800000, cost: 300000, growth: 3, owner: 0 };
const withHouse = E.simulate({ ...single, assets: [house] }, S[0]);
check('principal residence adds to estate tax-free',
  near(withHouse.summary.estate - base.estate, 800000 * Math.pow(1.03, 35) / Math.pow(1.021, 35), 2),
  Math.round(withHouse.summary.estate - base.estate));
const cottage = { ...house, type: 'cottage', name: 'Cottage' };
const withCottage = E.simulate({ ...single, assets: [cottage] }, S[0]).summary;
check('cottage gain is taxed at death', withCottage.deathTax > base.deathTax + 50000, Math.round(withCottage.deathTax));
const sold = E.simulate({ ...single, assets: [{ ...house, sellAge: 75 }] }, S[0]);
const saleRow = sold.rows.find(r => r.age === 75);
check('downsizing at 75 moves proceeds to non-reg', saleRow.notes.some(n => n.startsWith('Sold Home')) && saleRow.assets === 0);
const rental = E.simulate({ ...single, assets: [{ type: 'rental', value: 400000, cost: 350000, growth: 2, income: 12000, owner: 0 }] }, S[0]);
check('rental income shows as taxable income', rental.rows.find(r => r.age === 66).other > 12000);
const mortgage = { type: 'mortgage', balance: 100000, rate: 5, payment: 1500 };
const withDebt = E.simulate({ ...single, liabilities: [mortgage] }, S[0]);
const r62 = withDebt.rows.find(r => r.age === 62), r62b = E.simulate(single, S[0]).rows.find(r => r.age === 62);
check('mortgage payments add to spending need', near(r62.need - r62b.need, 18000, 1), Math.round(r62.need - r62b.need));
check('mortgage is eventually paid off', withDebt.rows[withDebt.rows.length - 1].debt === 0);
check('debt lowers the estate', withDebt.summary.estate < base.estate);
const incomeList = E.simulate({ ...single, otherList: [{ amount: 20000, untilAge: 65 }] }, S[0]);
check('part-time income stops after its end age',
  incomeList.rows.find(r => r.age === 65).other > 0 && incomeList.rows.find(r => r.age === 66).other === 0);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
