// Year-by-year retirement simulation and tax engine. No UI code here.
(function () {
  const TD = window.TAXDATA;

  function bracketTax(x, brackets, f) {
    let tax = 0, prev = 0;
    for (const [top, rate] of brackets) {
      const t = top * f;
      if (x > prev) tax += (Math.min(x, t) - prev) * rate;
      if (x <= t) break;
      prev = t;
    }
    return tax;
  }

  function onHealthPremium(t) {
    if (t <= 20000) return 0;
    if (t <= 36000) return Math.min(300, 0.06 * (t - 20000));
    if (t <= 48000) return Math.min(450, 300 + 0.06 * (t - 36000));
    if (t <= 72000) return Math.min(600, 450 + 0.25 * (t - 48000));
    if (t <= 200000) return Math.min(750, 600 + 0.25 * (t - 72000));
    return Math.min(900, 750 + 0.25 * (t - 200000));
  }

  // c = { ordinary, pensionEligible, eligDiv (cash amount), taxableGains, oas }
  // f = inflation factor used to index thresholds for future years.
  function computeTax(c, age, prov, f) {
    const F = TD.federal, P = TD.provinces[prov];
    const grossDiv = (c.eligDiv || 0) * TD.divGrossUp;
    const netIncome = c.ordinary + grossDiv + (c.taxableGains || 0);
    const clawback = c.oas > 0
      ? Math.min(c.oas, Math.max(0, TD.oas.clawbackRate * (netIncome - TD.oas.clawbackThreshold * f)))
      : 0;
    const taxable = Math.max(0, netIncome - clawback);

    // Federal
    let fed = bracketTax(taxable, F.brackets, f);
    const b3 = F.brackets[2][0] * f, b4 = F.brackets[3][0] * f;
    let bpa = F.bpaMax * f;
    if (taxable > b3) bpa = taxable >= b4 ? F.bpaMin * f : (F.bpaMax - (F.bpaMax - F.bpaMin) * (taxable - b3) / (b4 - b3)) * f;
    const ageAmt = age >= 65 ? Math.max(0, F.ageAmount * f - 0.15 * Math.max(0, netIncome - F.ageThreshold * f)) : 0;
    const pen = Math.min(c.pensionEligible || 0, F.pensionAmount);
    fed = Math.max(0, fed - (bpa + ageAmt + pen) * F.creditRate - grossDiv * F.dtcEligible);

    // Provincial
    let prv = bracketTax(taxable, P.brackets, f);
    const pAge = age >= 65 ? Math.max(0, P.ageAmount * f - 0.15 * Math.max(0, netIncome - P.ageThreshold * f)) : 0;
    const pPen = Math.min(c.pensionEligible || 0, P.pensionAmount * f);
    prv = Math.max(0, prv - (P.bpa * f + pAge + pPen) * P.creditRate - grossDiv * P.dtcEligible);
    if (P.surtax) {
      let s = 0;
      for (const [th, r] of P.surtax) s += r * Math.max(0, prv - th * f);
      prv += s;
    }
    if (P.healthPremium) prv += onHealthPremium(taxable);

    return { netIncome, taxable, clawback, fed, prov: prv, total: fed + prv + clawback };
  }

  function rrifMinRate(age) {
    if (age < 71) return 1 / (90 - age);
    if (age >= 95) return TD.rrifFactors[95];
    return TD.rrifFactors[age];
  }
  function cppFactor(startAge) {
    const m = (startAge - 65) * 12;
    return m < 0 ? 1 + m * TD.cpp.earlyPerMonth : 1 + m * TD.cpp.latePerMonth;
  }
  function oasFactor(startAge) {
    return 1 + Math.max(0, Math.min(60, (startAge - 65) * 12)) * TD.oas.deferralPerMonth;
  }
  function withholdingRate(amount) {
    for (const [top, r] of TD.withholding) if (amount <= top) return r;
    return 0.3;
  }

  // p = profile inputs, s = scenario settings
  const sum = a => a.reduce((x, y) => x + y, 0);

  // Split amount A across people in proportion to what each has available.
  function propAlloc(A, av) {
    const tot = sum(av);
    return av.map(a => (tot > 0 ? Math.min(a, A * a / tot) : 0));
  }
  // Split an RRSP/RRIF draw so the lower-income person draws first, then evenly.
  function fillAlloc(A, av, base) {
    if (av.length === 1) return [Math.min(A, av[0])];
    const x = [0, 0];
    let rem = A;
    const lo = base[0] <= base[1] ? 0 : 1, hi = 1 - lo;
    let d = Math.min(rem, Math.abs(base[1] - base[0]), av[lo]);
    x[lo] += d; rem -= d;
    const h0 = Math.min(rem / 2, av[0] - x[0]), h1 = Math.min(rem / 2, av[1] - x[1]);
    x[0] += h0; x[1] += h1; rem -= h0 + h1;
    d = Math.min(rem, av[0] - x[0]); x[0] += d; rem -= d;
    x[1] += Math.min(rem, av[1] - x[1]);
    return x;
  }

  function makePerson(p, s, pre, sfx) {
    const g = k => p[pre + k];
    return {
      age0: g('age'), retireAge: g('retireAge'), endAge: g('endAge'),
      empIncome: g('empIncome'), contribRrsp: g('contribRrsp'), contribTfsa: g('contribTfsa'), contribNonreg: g('contribNonreg'),
      cpp65: g('cpp65'), oasYears: g('oasYears'), dbPension: g('dbPension'), dbStart: g('dbStart'), dbIndex: g('dbIndex'),
      dbSurvivor: g('dbSurvivor') || 0, otherIncome: g('otherIncome'), otherUntil: g('otherUntil'),
      cppAge: s['cppAge' + sfx], oasAge: s['oasAge' + sfx], rrifStart: s['rrifStart' + sfx],
      cppF: cppFactor(s['cppAge' + sfx]), oasF: oasFactor(s['oasAge' + sfx]),
      reg: g('rrsp') + g('rrif'), tfsa: g('tfsa'), room: g('tfsaRoom'), cash: g('cash'), inv: g('inv'), acb: Math.min(g('invAcb'), g('inv')),
      alive: true, tfsaOutPrev: 0, survCppBase: 0, survDb: 0, survDbIndex: 0, lastComp: null,
    };
  }

  // p = profile inputs, s = scenario settings
  // fast = true uses a quick pension-split estimate (for the optimizer's search).
  function simulate(p, s, fast) {
    const couple = p.spouseOn === 'yes';
    const inf = p.inflation / 100, rReg = p.rReg / 100, rTfsa = p.rTfsa / 100, rInv = p.rInv / 100;
    const dy = Math.min(p.divYield, p.rInv) / 100, rCash = p.rCash / 100, rResp = p.rResp / 100;
    const P = [makePerson(p, s, '', '')];
    if (couple) P.push(makePerson(p, s, 's_', '2'));
    let fhsa = p.fhsa, resp = p.respBal;
    const tRet = Math.max(0, Math.min(...P.map(x => x.retireAge - x.age0)));
    const rows = [];
    let survivorMode = false;

    for (let t = 0; P.some(x => x.alive); t++) {
      const f = Math.pow(1 + inf, t);
      const ages = P.map(x => x.age0 + t);
      const alive = P.map((x, i) => i).filter(i => P[i].alive);
      const notes = [];
      for (const i of alive) {
        const x = P[i];
        if (t > 0) x.room += Math.round(TD.tfsaLimit * f / 500) * 500 + x.tfsaOutPrev;
        x.tfsaOutPrev = 0;
      }
      const me = P[0];
      let aipExcess = 0;

      // One-time events (owned by "you")
      if (me.alive && fhsa > 0 && (ages[0] === p.fhsaAge || ages[0] >= 71)) {
        if (p.fhsaAction === 'home' && ages[0] === p.fhsaAge) notes.push('FHSA used for home (tax-free, leaves plan)');
        else { me.reg += fhsa; notes.push('FHSA moved to RRSP/RRIF (tax-deferred, no room used)'); }
        fhsa = 0;
      }
      if (me.alive && resp > 0 && ages[0] === p.respAge) {
        const refund = Math.min(p.respContrib, resp);
        me.cash += refund;
        if (p.respAction === 'eap') notes.push('RESP paid to student; your contributions back tax-free');
        else {
          const grants = Math.min(p.respGrants, resp - refund);
          const aip = Math.max(0, resp - refund - grants);
          const toR = Math.min(50000, aip);
          me.reg += toR;
          aipExcess = aip - toR;
          me.cash += aipExcess;
          notes.push('RESP collapsed: grants repaid, ' + Math.round(toR).toLocaleString() + ' AIP to RRSP' + (aipExcess > 0 ? ', rest taxed +20%' : ''));
        }
        resp = 0;
      }
      const penalty = 0.2 * aipExcess;

      // Per-person income for the year
      const inc = P.map((x, i) => {
        const age = ages[i];
        if (!x.alive) return null;
        const working = age < x.retireAge;
        let cpp = age >= x.cppAge ? x.cpp65 * 12 * x.cppF : 0;
        if (x.survCppBase > 0) {
          const surv = x.survCppBase * (age >= 65 ? 0.6 : 0.375);
          cpp = Math.min(cpp + surv, Math.max(cpp, TD.cpp.max65Monthly * 12 * Math.max(1, x.cppF)));
        }
        cpp *= f;
        const oas = age >= x.oasAge ? TD.oas.maxMonthly65 * 12 * Math.min(1, x.oasYears / 40) * x.oasF * (age >= 75 ? 1 + TD.oas.boost75 : 1) * f : 0;
        let db = x.dbPension > 0 && age >= x.dbStart ? x.dbPension * Math.pow(1 + x.dbIndex / 100, age - x.dbStart) : 0;
        if (x.survDb > 0) { db += x.survDb; x.survDb *= 1 + x.survDbIndex; }
        const other = x.otherIncome > 0 && age <= x.otherUntil ? x.otherIncome * f : 0;
        const emp = working ? x.empIncome * f : 0;
        const cR = working ? x.contribRrsp * f : 0;
        const interest = x.cash * rCash, div = x.inv * dy;
        const ownAgeForMin = couple && s.useYounger === 'yes' ? Math.min(age, ages[1 - i]) : age;
        const minW = age >= x.rrifStart ? Math.min(x.reg, x.reg * rrifMinRate(ownAgeForMin)) : 0;
        const rrifEligible = age >= 65 && age >= x.rrifStart;
        return { age, working, cpp, oas, db, other, emp, cR, interest, div, minW, rrifEligible, aip: i === 0 ? aipExcess : 0 };
      });

      // ---- Before anyone retires: accumulate; benefits/minimums received are saved after tax.
      if (t < tRet) {
        const row = blankRow(t, ages, P, f, true);
        for (const i of alive) {
          const x = P[i], v = inc[i];
          const benefits = v.cpp + v.oas + v.db + v.other;
          const base = { ordinary: Math.max(0, v.emp - v.cR) + v.interest, pensionEligible: 0, eligDiv: v.div, taxableGains: 0, oas: 0 };
          const t0 = computeTax(base, v.age, p.province, f);
          const t1 = computeTax({ ...base, ordinary: base.ordinary + benefits + v.minW + v.aip, pensionEligible: v.db + (v.rrifEligible ? v.minW : 0), oas: v.oas }, v.age, p.province, f);
          x.cash += benefits + v.minW - (t1.total - t0.total) - (i === 0 ? penalty : 0);
          x.reg = (x.reg - v.minW + v.cR) * (1 + rReg);
          const cT = Math.min(x.contribTfsa * f, Math.max(0, x.room));
          x.room -= cT;
          x.tfsa = (x.tfsa + cT) * (1 + rTfsa);
          const cN = x.contribNonreg * f + (x.contribTfsa * f - cT);
          x.acb += cN + x.inv * dy;
          x.inv = (x.inv + cN) * (1 + rInv);
          x.cash *= 1 + rCash;
          addInc(row, v);
          row.regW += v.minW; row.minW += v.minW; row.clawback += t1.clawback; row.toTfsa += cT; row.toNonreg += cN;
        }
        fhsa *= 1 + rReg;
        resp *= 1 + rResp;
        finishRow(row, P, fhsa + resp, notes);
        rows.push(row);
        handleDeaths(t, ages, P, f, notes);
        continue;
      }

      // ---- Household retired: spending is drawn from savings.
      const wReg = P.map((x, i) => {
        const v = inc[i];
        if (!v) return 0;
        let w = v.minW;
        if (v.age <= s.fillUntil && !v.working) {
          if (s.strategy === 'fill') {
            const baseNet = v.emp - v.cR + v.cpp + v.oas + v.db + v.other + v.interest + v.aip + v.div * TD.divGrossUp + w;
            w = Math.min(x.reg, w + Math.max(0, s.fillTarget * f - baseNet));
          } else if (s.strategy === 'fixed') {
            w = Math.min(x.reg, Math.max(w, s.fixedAmt * f));
          }
        }
        return w;
      });
      const gainRatio = P.map(x => (x.alive && x.inv > 0 ? Math.max(0, 1 - x.acb / x.inv) : 0));
      const ix = alive;
      const avail = {
        cash: ix.map(i => Math.max(0, P[i].cash)), inv: ix.map(i => Math.max(0, P[i].inv)),
        tfsa: ix.map(i => Math.max(0, P[i].tfsa)), reg: ix.map(i => Math.max(0, P[i].reg - wReg[i])),
      };
      const baseIncome = ix.map(i => { const v = inc[i]; return v.emp - v.cR + v.cpp + v.oas + v.db + v.other + v.interest + v.div * TD.divGrossUp + wReg[i]; });

      // Components per alive person for a household draw x, before pension splitting.
      const components = (x) => {
        const al = { cash: propAlloc(x.cash, avail.cash), inv: propAlloc(x.inv, avail.inv), tfsa: propAlloc(x.tfsa, avail.tfsa), reg: fillAlloc(x.reg, avail.reg, baseIncome) };
        return ix.map((i, k) => {
          const v = inc[i];
          const regW = wReg[i] + al.reg[k];
          const gains = al.inv[k] * gainRatio[i];
          const benefits = v.cpp + v.oas + v.db + v.other;
          return {
            i, regW, gains, cashW: al.cash[k], invW: al.inv[k], tfsaW: al.tfsa[k],
            elig: v.db + (v.rrifEligible ? regW : 0),
            c: { ordinary: Math.max(0, v.emp - v.cR) + benefits + v.interest + v.aip + regW, pensionEligible: v.db + (v.rrifEligible ? regW : 0), eligDiv: v.div, taxableGains: gains * TD.gcapInclusion, oas: v.oas },
            inflow: v.emp - v.cR + benefits + v.interest + v.div + regW + al.cash[k] + al.inv[k] + al.tfsa[k],
          };
        });
      };
      // Tax for both people after moving d of eligible pension income from person 0 to person 1 (negative = other way).
      const taxWithSplit = (cs, d) => cs.map((k, j) => {
        const shift = cs.length === 2 ? (j === 0 ? -d : d) : 0;
        return computeTax({ ...k.c, ordinary: k.c.ordinary + shift, pensionEligible: k.c.pensionEligible + shift }, ages[k.i], p.province, f);
      });
      const splitRange = cs => (cs.length === 2 && s.pensionSplit !== 'none') ? [-0.5 * cs[1].elig, 0.5 * cs[0].elig] : [0, 0];
      const quickSplit = cs => {
        const [lo, hi] = splitRange(cs);
        if (lo === hi) return 0;
        const n = cs.map(k => k.c.ordinary + k.c.eligDiv * TD.divGrossUp + k.c.taxableGains);
        return Math.max(lo, Math.min(hi, (n[0] - n[1]) / 2));
      };
      const bestSplit = cs => {
        const [lo, hi] = splitRange(cs);
        if (lo === hi) return 0;
        const cost = d => sum(taxWithSplit(cs, d).map(t => t.total));
        let best = quickSplit(cs), bestC = cost(best);
        const N = 10;
        for (let k = 0; k <= N; k++) { const d = lo + (hi - lo) * k / N; const c = cost(d); if (c < bestC - 0.01) { bestC = c; best = d; } }
        let a = Math.max(lo, best - (hi - lo) / N), b = Math.min(hi, best + (hi - lo) / N);
        for (let k = 0; k < 16; k++) {
          const m1 = a + (b - a) / 3, m2 = b - (b - a) / 3;
          if (cost(m1) <= cost(m2)) b = m2; else a = m1;
        }
        const d = (a + b) / 2;
        return cost(d) < bestC ? d : best;
      };
      const calc = (x, exact) => {
        const cs = components(x);
        const d = exact && !fast ? bestSplit(cs) : quickSplit(cs);
        const taxes = taxWithSplit(cs, d);
        const tax = sum(taxes.map(t => t.total)) + penalty;
        return { net: sum(cs.map(k => k.inflow)) - tax, cs, taxes, d, tax };
      };

      const need = p.spending * f * (ages[0] >= p.slowAge ? 1 + p.slowPct / 100 : 1) * (survivorMode ? p.survivorPct / 100 : 1);
      const x = { cash: 0, inv: 0, tfsa: 0, reg: 0 };
      const tot = k => sum(avail[k]);
      let r = calc(x);
      if (r.net < need) {
        for (const src of s.order.split(',')) {
          if (tot(src) <= 0) continue;
          x[src] = tot(src);
          r = calc(x);
          if (r.net >= need) {
            let lo = 0, hi = tot(src);
            for (let k = 0; k < 28; k++) {
              const mid = (lo + hi) / 2;
              x[src] = mid;
              if (calc(x).net >= need) hi = mid; else lo = mid;
            }
            x[src] = hi;
            break;
          }
        }
      }
      r = calc(x, true);
      const shortfall = Math.max(0, need - r.net);
      let surplus = Math.max(0, r.net - need);

      const row = blankRow(t, ages, P, f, false);
      row.need = need; row.net = r.net; row.shortfall = shortfall; row.split = r.d; row.tax = r.tax;
      row.taxables = P.map(() => null);
      r.cs.forEach((k, j) => {
        const xp = P[k.i], v = inc[k.i], tx = r.taxes[j];
        addInc(row, v);
        row.regW += k.regW; row.minW += v.minW; row.cashW += k.cashW; row.invW += k.invW; row.tfsaW += k.tfsaW; row.gains += k.gains;
        row.taxable += tx.taxable; row.clawback += tx.clawback; row.taxables[k.i] = tx.taxable;
        const extra = k.regW - v.minW;
        row.withholding += extra > 0 ? extra * withholdingRate(extra) : 0;
        // apply withdrawals
        xp.cash -= k.cashW;
        if (k.invW > 0) { xp.acb -= xp.acb * (k.invW / xp.inv); xp.inv -= k.invW; }
        xp.tfsa -= k.tfsaW;
        xp.tfsaOutPrev = k.tfsaW;
        xp.reg -= k.regW;
        xp.reg += v.cR;
        const shift = r.cs.length === 2 ? (j === 0 ? -r.d : r.d) : 0;
        xp.lastComp = { c: { ...k.c, ordinary: k.c.ordinary + shift, pensionEligible: k.c.pensionEligible + shift }, age: v.age, f, tax: tx.total };
      });
      // marginal rate for the first alive person
      {
        const k = r.cs[0], c = r.cs.length === 2 ? -r.d : 0;
        const base = computeTax({ ...k.c, ordinary: k.c.ordinary + c, pensionEligible: k.c.pensionEligible + c }, ages[k.i], p.province, f);
        const plus = computeTax({ ...k.c, ordinary: k.c.ordinary + c + 1000, pensionEligible: k.c.pensionEligible + c }, ages[k.i], p.province, f);
        row.marginal = (plus.total - base.total) / 1000;
      }
      // surplus: TFSA room first, then non-registered (split evenly)
      const rooms = ix.map(i => Math.max(0, P[i].room));
      const toT = propAlloc(Math.min(surplus, sum(rooms)), rooms);
      ix.forEach((i, k) => { P[i].tfsa += toT[k]; P[i].room -= toT[k]; row.toTfsa += toT[k]; });
      surplus -= sum(toT);
      ix.forEach(i => { const a = surplus / ix.length; P[i].inv += a; P[i].acb += a; row.toNonreg += a; });

      for (const i of ix) {
        const xp = P[i];
        xp.reg *= 1 + rReg;
        xp.tfsa *= 1 + rTfsa;
        xp.inv *= 1 + (rInv - dy);
      }
      fhsa *= 1 + rReg;
      resp *= 1 + rResp;
      finishRow(row, P, fhsa + resp, notes);
      rows.push(row);
      if (handleDeaths(t, ages, P, f, row.notes)) survivorMode = true;
    }

    // Estate at the last death: RRIF fully taxable on the final return; non-reg gains deemed realized.
    const fp = P.reduce((a, b) => ((b.diedAt ?? -1) >= (a.diedAt ?? -1) ? b : a));
    const last = rows[rows.length - 1];
    let deathTax = 0;
    const regLeft = sum(P.map(x => x.reg)), invLeft = sum(P.map(x => x.inv)), acbLeft = sum(P.map(x => x.acb));
    if (fp.lastComp) {
      const lc = fp.lastComp;
      const t = computeTax({ ...lc.c, ordinary: lc.c.ordinary + regLeft + fhsa, taxableGains: lc.c.taxableGains + Math.max(0, invLeft - acbLeft) * TD.gcapInclusion },
        lc.age, p.province, lc.f);
      deathTax = t.total - lc.tax;
    }
    const estateNominal = regLeft + fhsa + resp + sum(P.map(x => x.tfsa + x.inv + x.cash)) - deathTax;

    let tax = 0, claw = 0, short = 0, taxable = 0, cppOas = 0, split = 0, depletedAge = null;
    for (const row of rows) {
      if (row.working) continue;
      tax += row.tax / row.f;
      claw += row.clawback / row.f;
      short += row.shortfall / row.f;
      taxable += row.taxable / row.f;
      split += Math.abs(row.split) / row.f;
      cppOas += (row.cpp + row.oas - row.clawback) / row.f;
      if (depletedAge === null && row.shortfall > 1) depletedAge = row.label;
    }
    const firstRet = rows.find(r => !r.working);
    return {
      rows,
      summary: {
        lifetimeTax: tax, clawback: claw, shortfall: short, depletedAge, cppOas, split,
        avgRate: taxable > 0 ? tax / taxable : 0,
        deathTax: deathTax / last.f,
        estate: estateNominal / last.f,
        estateNominal,
        firstRegW: firstRet ? firstRet.regW / firstRet.f : 0,
        score: estateNominal / last.f - 2 * short,
      },
    };
  }

  function blankRow(t, ages, P, f, working) {
    const label = P.map((x, i) => (x.alive ? ages[i] : '†')).join(' / ');
    return { t, label, age: ages[0], f, working, cpp: 0, oas: 0, db: 0, other: 0, emp: 0, interest: 0, div: 0, regW: 0, minW: 0,
      cashW: 0, invW: 0, tfsaW: 0, gains: 0, taxable: 0, tax: working ? null : 0, clawback: 0, need: 0, net: 0, shortfall: 0,
      toTfsa: 0, toNonreg: 0, marginal: null, withholding: 0, split: 0, taxables: null };
  }
  function addInc(row, v) {
    row.cpp += v.cpp; row.oas += v.oas; row.db += v.db; row.other += v.other; row.emp += v.emp - v.cR;
    row.interest += v.interest; row.div += v.div;
  }
  function finishRow(row, P, otherBal, notes) {
    row.reg = sum(P.map(x => x.reg)); row.tfsa = sum(P.map(x => x.tfsa)); row.cash = sum(P.map(x => x.cash)); row.inv = sum(P.map(x => x.inv));
    row.other_bal = otherBal;
    row.total = row.reg + row.tfsa + row.cash + row.inv + otherBal;
    row.notes = notes;
  }
  // People reaching their plan-to age die at year end. A surviving spouse receives everything tax-free (spousal rollover).
  function handleDeaths(t, ages, P, f, notes) {
    let firstDeath = false;
    P.forEach((x, i) => {
      if (!x.alive || ages[i] < x.endAge) return;
      x.alive = false;
      x.diedAt = t;
      const sv = P.find((y, j) => j !== i && y.alive);
      if (!sv) return;
      firstDeath = true;
      sv.reg += x.reg; sv.tfsa += x.tfsa; sv.cash += x.cash; sv.inv += x.inv; sv.acb += x.acb;
      x.reg = x.tfsa = x.cash = x.inv = x.acb = 0;
      sv.survCppBase = x.cpp65 * 12;
      const dbNow = x.dbPension > 0 && ages[i] >= x.dbStart ? x.dbPension * Math.pow(1 + x.dbIndex / 100, ages[i] - x.dbStart + 1) : 0;
      sv.survDb = dbNow * x.dbSurvivor / 100;
      sv.survDbIndex = x.dbIndex / 100;
      notes.push(`${i === 0 ? 'You' : 'Spouse'} pass away at ${ages[i]}: RRSP/RRIF, TFSA and non-reg roll to survivor tax-free; CPP survivor benefit${sv.survDb > 0 ? ' and DB survivor pension' : ''} start`);
    });
    return firstDeath;
  }

  // Search the RRSP/RRIF "fill to taxable income" target (and optionally CPP/OAS start ages,
  // the same ages for both spouses) that leaves the largest after-tax estate while meeting spending.
  function optimize(p, s, withTiming) {
    const cppAges = withTiming ? [60, 61, 62, 63, 64, 65, 66, 67, 68, 69, 70] : [s.cppAge];
    const oasAges = withTiming ? [65, 66, 67, 68, 69, 70] : [s.oasAge];
    const step = p.spouseOn === 'yes' && withTiming ? 10000 : 5000;
    let best = null;
    for (const cppAge of cppAges) for (const oasAge of oasAges) {
      const timing = withTiming ? { cppAge, oasAge, cppAge2: cppAge, oasAge2: oasAge } : {};
      const cands = [{ ...s, ...timing, strategy: 'min' }];
      for (let t = 10000; t <= 200000; t += step) cands.push({ ...s, ...timing, strategy: 'fill', fillTarget: t });
      for (const c of cands) {
        const res = simulate(p, c, true);
        if (!best || res.summary.score > best.res.summary.score + 1) best = { scenario: c, res };
      }
    }
    if (best.scenario.strategy === 'fill') {
      const t0 = best.scenario.fillTarget;
      for (let t = t0 - step + 500; t <= t0 + step - 500; t += 500) {
        if (t <= 0) continue;
        const c = { ...best.scenario, fillTarget: t };
        const res = simulate(p, c, true);
        if (res.summary.score > best.res.summary.score + 1) best = { scenario: c, res };
      }
    }
    best.res = simulate(p, best.scenario);
    return best;
  }

  window.Engine = { computeTax, simulate, optimize, rrifMinRate, cppFactor, oasFactor, withholdingRate };
})();
