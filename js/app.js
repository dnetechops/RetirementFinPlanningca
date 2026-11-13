// FiMoksha UI: sign-in, household list (advisor/admin), admin tools and the plan tabs.
(function () {
  const TD = window.TAXDATA, E = window.Engine, M = window.Model, S = window.Store;
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const money = v => (v == null || isNaN(v)) ? '—' : (v < -0.5 ? '−$' : '$') + Math.round(Math.abs(v)).toLocaleString('en-CA');
  const pct = v => (v * 100).toFixed(1) + '%';
  const range = (a, b) => Array.from({ length: b - a + 1 }, (_, i) => a + i);
  const ROLE_LABEL = { client: 'Client', advisor: 'Advisor', admin: 'Admin' };
  const COLORS = ['--s1', '--s2', '--s3'];
  const css = v => getComputedStyle(document.documentElement).getPropertyValue(v).trim();

  let me = null;          // signed-in user
  let cur = null;         // { id, name, ownerId, data } open household
  let inputs = null, results = null, inputError = null;
  let activeTab = 'dashboard';
  let charts = {};

  // ---------------- views ----------------
  function show(view) {
    $$('.view').forEach(v => v.classList.toggle('active', v.id === 'view-' + view));
    $('#plan-head').hidden = view !== 'plan';
    $('#user-box').hidden = !me;
    $('#btn-home').hidden = !(me && me.role !== 'client' && view === 'plan');
    $('#btn-password').hidden = !(me && S.mode === 'server');
  }
  function flash(el, msg, ok = true) { el.textContent = msg; el.className = 'msg ' + (ok ? 'ok' : 'bad'); }

  async function boot() {
    try { me = await S.init(); } catch (e) { $('#view-loading').innerHTML = `<p class="bad">Couldn't start: ${esc(e.message)}</p>`; return; }
    $('#mode-badge').hidden = S.mode !== 'demo';
    if (S.inRecovery()) return showSetPassword();
    me ? afterLogin() : showAuth();
  }

  // After a password-reset email link: choose a new password.
  function showSetPassword() {
    $('#view-auth').innerHTML = `<div class="auth"><div class="card"><h2>Choose a new password</h2>
      <form id="newpw-form" class="stack">
        <label>New password (8+ characters)<input type="password" name="pw" minlength="8" required autocomplete="new-password"></label>
        <button class="primary">Save password</button><p id="newpw-msg" class="msg"></p>
      </form></div></div>`;
    show('auth');
    $('#newpw-form').addEventListener('submit', async e => {
      e.preventDefault();
      try { me = await S.setNewPassword(new FormData(e.target).get('pw')); afterLogin(); } catch (err) { flash($('#newpw-msg'), err.message, false); }
    });
  }

  // ---------------- auth ----------------
  function showAuth() {
    me = null;
    const demo = S.mode === 'demo';
    const { email: hasEmail, signup } = S.features;
    $('#view-auth').innerHTML = `
      <div class="auth">
        ${demo ? `
        <div class="card">
          <h2>Demo mode</h2>
          <p class="muted">No server is connected, so accounts and plans are stored only in this browser. Sign in as one of the sample users to try each role.</p>
          <div class="demo-users">${S.demoUsers().map(u => `
            <button class="demo-user" data-id="${esc(u.id)}"><b>${esc(u.firstName)} ${esc(u.lastName)}</b><span class="muted small">${ROLE_LABEL[u.role]} · ${esc(u.email)}</span></button>`).join('')}
          </div>
          <p class="small"><a href="#" id="reset-demo">Reset demo data</a></p>
        </div>` : `
        <div class="card" id="signin-card">
          <h2>Sign in</h2>
          <form id="signin-form" class="stack">
            <label>Email<input type="email" name="email" required autocomplete="email"></label>
            <label>Password<input type="password" name="password" required autocomplete="current-password"></label>
            <button class="primary">Sign in</button>
            <p class="small">${hasEmail ? '<a href="#" id="forgot">Forgot password?</a>' : '<span class="muted">Forgot your password? Ask an admin to reset it.</span>'}</p>
            <p id="signin-msg" class="msg"></p>
          </form>
        </div>`}
        ${signup ? `<div class="card">
          <h2>Create an account</h2>
          <form id="signup-form" class="stack">
            <div class="grid two">
              <label>First name<input name="first" required autocomplete="given-name"></label>
              <label>Last name<input name="last" required autocomplete="family-name"></label>
            </div>
            <label>Email<input type="email" name="email" required autocomplete="email"></label>
            ${demo ? '' : '<label>Password (8+ characters)<input type="password" name="password" minlength="8" required autocomplete="new-password"></label>'}
            <button class="primary">Create account</button>
            <p class="muted small">New accounts start as clients. An admin can make someone an advisor.</p>
            <p id="signup-msg" class="msg"></p>
          </form>
        </div>` : ''}
      </div>`;
    show('auth');
    $$('.demo-user').forEach(b => b.addEventListener('click', async () => { me = await S.demoSignIn(b.dataset.id); afterLogin(); }));
    const reset = $('#reset-demo');
    if (reset) reset.addEventListener('click', e => { e.preventDefault(); if (confirm('Delete all demo users and plans in this browser and start again?')) { S.resetDemo(); showAuth(); } });
    const si = $('#signin-form');
    if (si) si.addEventListener('submit', async e => {
      e.preventDefault();
      const f = new FormData(si);
      try { me = await S.signIn(f.get('email'), f.get('password')); afterLogin(); } catch (err) { flash($('#signin-msg'), err.message, false); }
    });
    const fg = $('#forgot');
    if (fg) fg.addEventListener('click', async e => {
      e.preventDefault();
      const email = $('#signin-form [name=email]').value;
      if (!email) return flash($('#signin-msg'), 'Enter your email first.', false);
      try { await S.resetPassword(email); flash($('#signin-msg'), 'Check your email for a reset link.'); } catch (err) { flash($('#signin-msg'), err.message, false); }
    });
    const su = $('#signup-form');
    if (su) su.addEventListener('submit', async e => {
      e.preventDefault();
      const f = new FormData(e.target);
      try {
        const r = await S.signUp(f.get('email'), f.get('password') || '', f.get('first'), f.get('last'));
        if (r && r.needsConfirmation) return flash($('#signup-msg'), 'Check your email to confirm your account, then sign in.');
        me = r; afterLogin();
      } catch (err) { flash($('#signup-msg'), err.message, false); }
    });
  }

  // Asks for a new password (and the current one when changing your own); closes once onSave succeeds.
  function passwordDialog(title, needCurrent, onSave) {
    const dlg = $('#pw-dialog'), form = $('#pw-form');
    form.reset();
    $('#pw-title').textContent = title;
    $('#pw-current-label').hidden = !needCurrent;
    form.current.required = needCurrent;
    $('#pw-msg').textContent = '';
    form.onsubmit = async e => {
      if (e.submitter && e.submitter.value === 'cancel') return;
      e.preventDefault();
      try { await onSave(form.current.value, form.password.value); dlg.close(); } catch (err) { flash($('#pw-msg'), err.message, false); }
    };
    dlg.showModal();
  }
  $('#btn-password').addEventListener('click', () => passwordDialog('Change your password', true, (cur, pw) => S.changePassword(cur, pw)));

  $('#btn-signout').addEventListener('click', async () => { await flushSave(); await S.signOut(); cur = null; showAuth(); });
  $('#btn-home').addEventListener('click', async () => { await flushSave(); cur = null; showHome(); });

  async function afterLogin() {
    $('#user-name').textContent = `${me.firstName} ${me.lastName}`.trim() + ` · ${ROLE_LABEL[me.role]}`;
    if (me.role === 'client') {
      const list = await S.listHouseholds();
      const mine = list.find(h => h.ownerId === me.id) || list[0];
      if (mine) return openHousehold(mine.id);
      const id = await S.createHousehold(`${me.firstName} ${me.lastName} household`.trim(), M.newHousehold(me));
      return openHousehold(id);
    }
    showHome();
  }

  // ---------------- home: household list + admin ----------------
  async function showHome() {
    show('home');
    $('#subtitle').textContent = 'Canadian retirement planning';
    const el = $('#view-home');
    el.innerHTML = '<p class="muted">Loading…</p>';
    try {
      const [list, assigns, profiles] = await Promise.all([S.listHouseholds(), S.listAssignments(), S.listProfiles()]);
      const isAdmin = me.role === 'admin', serverMode = S.mode === 'server';
      const advisors = profiles.filter(p => p.role === 'advisor');
      const advisorOf = id => (assigns.find(a => a.householdId === id) || {}).advisorId || '';
      const nameOf = id => { const p = profiles.find(x => x.id === id); return p ? `${p.firstName} ${p.lastName}`.trim() || p.email : ''; };
      el.innerHTML = `
        <div class="card">
          <h2>${isAdmin ? 'All households' : 'My client households'}</h2>
          ${list.length ? `<div class="table-wrap"><table class="data"><thead><tr><th>Household</th><th>Client</th><th>Advisor</th><th>Last updated</th><th></th></tr></thead><tbody>
            ${list.map(h => `<tr>
              <td>${esc(h.name)}</td><td>${esc(h.ownerName)}</td>
              <td>${isAdmin ? `<select data-assign="${esc(h.id)}"><option value="">— none —</option>${advisors.map(a => `<option value="${esc(a.id)}"${a.id === advisorOf(h.id) ? ' selected' : ''}>${esc(nameOf(a.id))}</option>`).join('')}</select>` : esc(nameOf(advisorOf(h.id)))}</td>
              <td>${new Date(h.updatedAt).toLocaleString('en-CA', { dateStyle: 'medium', timeStyle: 'short' })}</td>
              <td><button class="primary" data-open="${esc(h.id)}">Open</button></td></tr>`).join('')}
          </tbody></table></div>` : `<p class="muted">${isAdmin ? 'No households yet. Clients get one when they sign up.' : 'No households assigned to you yet. An admin assigns clients to advisors.'}</p>`}
        </div>
        ${isAdmin ? `
        <div class="card">
          <h2>Users &amp; roles</h2>
          <p class="muted small">New sign-ups are clients. Make someone an advisor here, then assign households to them above.</p>
          <div class="table-wrap"><table class="data"><thead><tr><th>Name</th><th>Email</th><th>Role</th>${serverMode ? '<th></th>' : ''}</tr></thead><tbody>
            ${profiles.map(p => `<tr><td>${esc(`${p.firstName} ${p.lastName}`)}</td><td>${esc(p.email)}</td>
              <td><select data-role="${esc(p.id)}"${p.id === me.id ? ' disabled title="You can\'t change your own role"' : ''}>${Object.entries(ROLE_LABEL).map(([k, v]) => `<option value="${k}"${k === p.role ? ' selected' : ''}>${v}</option>`).join('')}</select></td>
              ${serverMode ? `<td>${p.id === me.id ? '' : `<button data-setpw="${esc(p.id)}" data-email="${esc(p.email)}">Set password</button>`}</td>` : ''}</tr>`).join('')}
          </tbody></table></div>
          <p id="admin-msg" class="msg"></p>
          <form id="add-user" class="add-user stack">
            <h3>Add a user</h3>
            <div class="grid">
              <label>First name<input name="first" required></label>
              <label>Last name<input name="last" required></label>
              <label>Email<input type="email" name="email" required></label>
              ${serverMode ? '<label>Starting password (8+)<input type="password" name="password" minlength="8" required autocomplete="new-password"></label>' : ''}
              <label>Role<select name="role">${Object.entries(ROLE_LABEL).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select></label>
              <button class="primary">Add user</button>
            </div>
            ${serverMode ? '<p class="muted small">Give the person their email and starting password; they can change it with the Password button after signing in.</p>' : ''}
          </form>
        </div>` : ''}`;
      $$('[data-open]', el).forEach(b => b.addEventListener('click', () => openHousehold(b.dataset.open)));
      $$('[data-assign]', el).forEach(s => s.addEventListener('change', async () => {
        try { await S.setAdvisor(s.dataset.assign, s.value); flash($('#admin-msg'), 'Advisor updated.'); } catch (e) { flash($('#admin-msg'), e.message, false); }
      }));
      $$('[data-role]', el).forEach(s => s.addEventListener('change', async () => {
        try { await S.setRole(s.dataset.role, s.value); showHome(); } catch (e) { flash($('#admin-msg'), e.message, false); }
      }));
      $$('[data-setpw]', el).forEach(b => b.addEventListener('click', () =>
        passwordDialog(`Set password for ${b.dataset.email}`, false, async (_, pw) => {
          await S.adminSetPassword(b.dataset.setpw, pw);
          flash($('#admin-msg'), `Password set for ${b.dataset.email}. They have been signed out everywhere.`);
        })));
      const au = $('#add-user', el);
      if (au) au.addEventListener('submit', async e => {
        e.preventDefault();
        const f = new FormData(au);
        try {
          await S.createUser({ email: f.get('email'), password: f.get('password') || '', firstName: f.get('first'), lastName: f.get('last'), role: f.get('role') });
          await showHome();
          flash($('#admin-msg'), `Added ${f.get('email')}.`);
        } catch (err) { flash($('#admin-msg'), err.message, false); }
      });
    } catch (e) { el.innerHTML = `<p class="bad">${esc(e.message)}</p>`; }
  }

  // ---------------- open a household ----------------
  async function openHousehold(id) {
    try {
      const h = await S.getHousehold(id);
      const base = M.newHousehold();
      const d = h.data && h.data.version ? h.data : base;
      // fill any sections added since the plan was saved
      for (const k of Object.keys(base)) if (d[k] === undefined) d[k] = base[k];
      cur = { id: h.id, name: h.name, ownerId: h.ownerId, data: d };
    } catch (e) { alert("Couldn't open household: " + e.message); return; }
    $('#household-name').textContent = cur.name;
    $('#subtitle').textContent = me.role === 'client' ? 'Your retirement plan' : `Viewing as ${ROLE_LABEL[me.role].toLowerCase()}`;
    $('#save-status').textContent = 'Saved';
    activeTab = 'dashboard';
    show('plan');
    renderTabs();
    recalc();
    renderTab();
  }

  // ---------------- saving ----------------
  let saveTimer = null, saving = null, dirty = false;
  function changed(rerender = false) {
    dirty = true;
    $('#save-status').textContent = 'Unsaved changes…';
    clearTimeout(saveTimer);
    saveTimer = setTimeout(save, 800);
    clearTimeout(changed.t);
    changed.t = setTimeout(() => { recalc(); if (rerender) renderTab(); else refreshLive(); }, 250);
  }
  async function save() {
    if (!cur || !dirty) return;
    dirty = false;
    $('#save-status').textContent = 'Saving…';
    saving = S.saveHousehold(cur.id, cur.name, cur.data)
      .then(() => { if (!dirty) $('#save-status').textContent = 'Saved ✓'; })
      .catch(e => { dirty = true; $('#save-status').textContent = "Couldn't save: " + e.message; });
    await saving;
  }
  async function flushSave() { clearTimeout(saveTimer); if (dirty) await save(); else if (saving) await saving; }
  window.addEventListener('beforeunload', e => { if (dirty) { e.preventDefault(); e.returnValue = ''; } });

  // ---------------- calculation ----------------
  function recalc() {
    const d = cur.data;
    inputs = M.toEngineInputs(d);
    inputError = null;
    const people = d.hasSpouse === 'yes' ? [['you', ''], ['spouse', 's_']] : [['you', '']];
    for (const [who, pre] of people) {
      if (inputs[pre + 'endAge'] <= inputs[pre + 'retireAge']) inputError = `${who === 'you' ? 'Your' : "Spouse's"} plan-to age must be after retirement age (Goals).`;
    }
    results = inputError ? null : d.scenarios.map(s => E.simulate(inputs, s));
  }
  const selScenario = () => Math.min(cur.data.dashboardScenario || 0, cur.data.scenarios.length - 1);

  // ---------------- forms ----------------
  // spec: [key, label, help, options, type]
  function field(obj, [k, label, help, opts, type]) {
    const v = obj[k] ?? '';
    let input;
    if (opts) input = `<select data-k="${k}">${opts.map(([val, txt]) => `<option value="${esc(val)}"${String(val) === String(v) ? ' selected' : ''}>${esc(txt)}</option>`).join('')}</select>`;
    else input = `<input type="${type || (typeof v === 'number' ? 'number' : 'text')}" ${type === 'number' || typeof v === 'number' ? 'step="any"' : ''} data-k="${k}" value="${esc(v)}">`;
    return `<label>${esc(label)}${input}${help ? `<span class="help">${esc(help)}</span>` : ''}</label>`;
  }
  function bind(el, obj, onChange, numeric = []) {
    $$('[data-k]', el).forEach(inp => inp.addEventListener(inp.tagName === 'SELECT' ? 'change' : 'input', () => {
      const k = inp.dataset.k;
      obj[k] = inp.type === 'number' || numeric.includes(k) ? (inp.value === '' ? '' : Number(inp.value)) : inp.value;
      onChange(k);
    }));
  }
  function section(title, inner, note) {
    return `<fieldset class="card"><legend>${esc(title)}</legend>${note ? `<p class="muted small">${note}</p>` : ''}${inner}</fieldset>`;
  }

  // Editable list as a table. cols: [key, label, type ('text'|'number'|'date'|'select'), options, showFn(item)]
  function listEditor(el, arr, cols, newItem, addLabel, onChange) {
    const draw = () => {
      el.innerHTML = `<div class="table-wrap"><table class="data list-edit"><thead><tr>${cols.map(c => `<th>${esc(c[1])}</th>`).join('')}<th></th></tr></thead><tbody>
        ${arr.map((it, i) => `<tr>${cols.map(([k, , type, opts, showFn]) => {
          if (showFn && !showFn(it)) return '<td class="muted">—</td>';
          const v = it[k] ?? '';
          const o = typeof opts === 'function' ? opts(it) : opts;
          return `<td>${type === 'select'
            ? `<select data-i="${i}" data-k="${k}">${o.map(([val, txt]) => `<option value="${esc(val)}"${String(val) === String(v) ? ' selected' : ''}>${esc(txt)}</option>`).join('')}</select>`
            : `<input type="${type}" ${type === 'number' ? 'step="any"' : ''} data-i="${i}" data-k="${k}" value="${esc(v)}">`}</td>`;
        }).join('')}<td><button class="link danger" data-del="${i}" title="Remove">✕</button></td></tr>`).join('')}
        ${arr.length ? '' : `<tr><td colspan="${cols.length + 1}" class="muted">Nothing added yet.</td></tr>`}
      </tbody></table></div><button class="add" type="button">+ ${esc(addLabel)}</button>`;
      $$('[data-k]', el).forEach(inp => inp.addEventListener(inp.tagName === 'SELECT' ? 'change' : 'input', () => {
        const it = arr[+inp.dataset.i], k = inp.dataset.k;
        it[k] = inp.type === 'number' ? (inp.value === '' ? '' : Number(inp.value)) : inp.value;
        if (inp.tagName === 'SELECT') draw(); // some columns depend on a select (e.g. account type)
        onChange();
      }));
      $$('[data-del]', el).forEach(b => b.addEventListener('click', () => { arr.splice(+b.dataset.del, 1); draw(); onChange(); }));
      $('.add', el).addEventListener('click', () => { arr.push(newItem()); draw(); onChange(); });
    };
    draw();
  }

  // ---------------- tabs ----------------
  const TABS = [
    ['dashboard', 'Dashboard'], ['profile', 'Profile'], ['goals', 'Goals'], ['accounts', 'Accounts'], ['insurance', 'Insurance'],
    ['assets', 'Assets & Liabilities'], ['budget', 'Budget'], ['taxes', 'Taxes'], ['projection', 'Projection'], ['estate', 'Estate'],
    ['scenarios', 'Scenarios'], ['rules', 'Rules'],
  ];
  function renderTabs() {
    $('#tabs').innerHTML = TABS.map(([k, l]) => `<button data-tab="${k}" class="${k === activeTab ? 'active' : ''}">${esc(l)}</button>`).join('');
    $$('#tabs button').forEach(b => b.addEventListener('click', () => {
      activeTab = b.dataset.tab;
      $$('#tabs button').forEach(x => x.classList.toggle('active', x === b));
      renderTab();
    }));
  }
  function renderTab() {
    Object.values(charts).forEach(c => c.destroy());
    charts = {};
    const body = $('#tab-body');
    const fn = { dashboard: tabDashboard, profile: tabProfile, goals: tabGoals, accounts: tabAccounts, insurance: tabInsurance,
      assets: tabAssets, budget: tabBudget, taxes: tabTaxes, projection: tabProjection, estate: tabEstate, scenarios: tabScenarios, rules: tabRules }[activeTab];
    fn(body);
  }
  // Update results-only parts of the current tab without rebuilding forms (keeps focus while typing).
  function refreshLive() {
    if (['dashboard', 'taxes', 'projection', 'estate'].includes(activeTab)) return renderTab();
    const live = $('#live');
    if (live && liveFns[activeTab]) live.innerHTML = liveFns[activeTab]();
  }
  const liveFns = {};

  const errorBox = () => (inputError ? `<div class="card warn-box">${esc(inputError)}</div>` : '');
  const scenarioSelect = id => `<select id="${id}">${cur.data.scenarios.map((s, i) => `<option value="${i}"${i === selScenario() ? ' selected' : ''}>${esc(s.name)}</option>`).join('')}</select>`;
  function wireScenarioSelect(id) {
    $('#' + id).addEventListener('change', e => { cur.data.dashboardScenario = +e.target.value; changed(true); });
  }

  // ----- Dashboard -----
  function tabDashboard(el) {
    const d = cur.data, miss = M.missing(d), nw = M.netWorth(d);
    if (!results) { el.innerHTML = errorBox(); return; }
    const i = selScenario(), res = results[i], s = res.summary;
    const rag = miss.length ? { status: 'none', reasons: ['Add the missing details above to see your status.'] } : M.ragStatus(s, res.rows, inputs.spending);
    const firstRet = res.rows.find(r => !r.working);
    const retIncome = firstRet ? (firstRet.need) / firstRet.f : 0;
    el.innerHTML = `
      ${miss.length ? `<div class="card warn-box"><b>To complete your plan:</b> ${miss.map(esc).join(' · ')}</div>` : ''}
      <div class="row-between"><h2>Summary</h2><label class="inline">Scenario ${scenarioSelect('dash-scen')}</label></div>
      <div class="card rag rag-${rag.status}">
        <div class="rag-dot" aria-hidden="true"></div>
        <div><h3>${{ green: 'On track', amber: 'Needs attention', red: 'At risk', none: 'Not enough information yet' }[rag.status]}</h3>
        <ul>${rag.reasons.map(r => `<li>${esc(r)}</li>`).join('')}</ul>
        <p class="muted small">Status rules are placeholders until the thresholds are agreed.</p></div>
      </div>
      <div class="tiles">
        ${tile('Net worth today', money(nw.total), `Accounts ${money(nw.accounts)} + assets ${money(nw.assets)} − debts ${money(nw.debts)}`)}
        ${tile('Retirement', `${inputs.retireAge}${d.hasSpouse === 'yes' ? ' / ' + inputs.s_retireAge : ''}`, d.hasSpouse === 'yes' ? 'Your age / spouse' : 'Your age')}
        ${tile('Money lasts', s.depletedAge ? `Short at ${s.depletedAge}` : `To ${inputs.endAge} ✓`, 'Plan-to age')}
        ${tile('Spending in 1st retired year', money(retIncome), "After tax, incl. debt payments, today's $")}
        ${tile('After-tax estate', money(s.estate), "Today's $, incl. home and other assets")}
        ${tile('Lifetime tax', money(s.lifetimeTax), `Average rate ${pct(s.avgRate)}`)}
      </div>
      <div class="card"><h3>Savings and assets by age (today's $)</h3><div class="chart-box"><canvas id="ch-dash"></canvas></div></div>`;
    wireScenarioSelect('dash-scen');
    if (window.Chart) {
      chartDefaults();
      const rows = res.rows;
      charts.dash = new Chart($('#ch-dash'), {
        type: 'line',
        data: { labels: rows.map(r => r.label), datasets: [
          { label: 'Savings & investments', data: rows.map(r => r.total / r.f), borderColor: css('--s1'), backgroundColor: css('--s1'), fill: false, pointRadius: 0, borderWidth: 2 },
          { label: 'Property & other assets', data: rows.map(r => r.assets / r.f), borderColor: css('--s3'), backgroundColor: css('--s3'), pointRadius: 0, borderWidth: 2 },
          { label: 'Debt', data: rows.map(r => r.debt / r.f), borderColor: css('--bad'), backgroundColor: css('--bad'), pointRadius: 0, borderWidth: 2 },
        ] },
        options: lineOpts(),
      });
    }
  }
  const tile = (label, value, sub) => `<div class="tile"><span class="muted small">${esc(label)}</span><strong>${esc(value)}</strong><span class="muted small">${esc(sub)}</span></div>`;

  // ----- Profile -----
  function tabProfile(el) {
    const d = cur.data;
    const provinces = Object.entries(TD.provinces).map(([k, v]) => [k, v.name]);
    const personFields = [['firstName', 'First name'], ['lastName', 'Last name'], ['dob', 'Date of birth', null, null, 'date'],
      ['email', 'Email', null, null, 'email'], ['phone', 'Phone', null, null, 'tel'], ['employment', 'Employment status', null, M.EMPLOYMENT], ['occupation', 'Occupation']];
    el.innerHTML = `
      ${section('Household', `<div class="grid">
        <label>Household name<input data-hname value="${esc(cur.name)}"></label>
        ${field(d.household, ['province', 'Home province', 'Used for tax', provinces])}
        ${field(d.household, ['address', 'Home address'])}${field(d.household, ['city', 'City'])}${field(d.household, ['postalCode', 'Postal code'])}
        ${field(d.household, ['notifications', 'Notifications', null, [['email', 'Email me updates'], ['none', 'No notifications']]])}
      </div>`)}
      <div id="sec-you">${section('You', `<div class="grid">${personFields.map(f => field(d.you, f)).join('')}</div>`)}</div>
      <div id="sec-spouse">${section('Spouse / partner', `<div class="grid">${field(d, ['hasSpouse', 'Include a spouse or partner?', null, [['no', 'No'], ['yes', 'Yes']]])}
        ${d.hasSpouse === 'yes' ? personFields.map(f => field(d.spouse, f)).join('') : ''}</div>`)}</div>
      <div id="sec-dep">${section('Dependents', `<div class="grid">${field(d, ['hasDependents', 'Any dependents?', null, [['no', 'No'], ['yes', 'Yes']]])}</div>
        ${d.hasDependents === 'yes' ? '<div id="dep-list"></div>' : ''}`)}</div>`;
    $('[data-hname]', el).addEventListener('input', e => { cur.name = e.target.value; $('#household-name').textContent = cur.name; changed(); });
    bind($('fieldset', el), d.household, () => changed());
    bind($('#sec-you', el), d.you, () => changed());
    $$('#sec-spouse [data-k]', el).forEach(inp => {
      const target = inp.dataset.k === 'hasSpouse' ? d : d.spouse;
      inp.addEventListener(inp.tagName === 'SELECT' ? 'change' : 'input', () => {
        target[inp.dataset.k] = inp.value;
        changed(inp.dataset.k === 'hasSpouse');
      });
    });
    $('#sec-dep [data-k=hasDependents]', el).addEventListener('change', e => { d.hasDependents = e.target.value; changed(true); });
    if (d.hasDependents === 'yes') {
      listEditor($('#dep-list', el), d.dependents,
        [['firstName', 'First name', 'text'], ['lastName', 'Last name', 'text'], ['dob', 'Date of birth', 'date'],
          ['relationship', 'Relationship', 'select', [['Child', 'Child'], ['Grandchild', 'Grandchild'], ['Parent', 'Parent'], ['Other', 'Other']]], ['notes', 'Notes', 'text']],
        () => ({ id: M.uid(), firstName: '', lastName: d.you.lastName || '', dob: '', relationship: 'Child', notes: '' }), 'Add dependent', () => changed());
    }
  }

  // ----- Goals -----
  function tabGoals(el) {
    const d = cur.data, couple = d.hasSpouse === 'yes', s0 = d.scenarios[0];
    const who = couple ? [['you', 'You'], ['spouse', d.spouse.firstName || 'Spouse']] : [['you', 'You']];
    const goalF = [['retireAge', 'Retire at age'], ['endAge', 'Plan to age (life expectancy)'], ['empIncome', 'Employment income until retiring ($/yr)'],
      ['contribRrsp', 'RRSP contributions / yr until retiring'], ['contribTfsa', 'TFSA contributions / yr until retiring'],
      ['contribNonreg', 'Non-reg savings / yr until retiring'], ['tfsaRoom', 'Unused TFSA room today']];
    const benF = [['cpp65', "CPP at 65 ($/month, today's $)", 'From My Service Canada Account. Max 2026 ≈ $1,508'], ['oasYears', 'Years in Canada after 18 (max 40)'],
      ['dbPension', 'Workplace (DB) pension $/yr at start'], ['dbStart', 'DB pension start age'], ['dbIndex', 'DB indexing %/yr'],
      ...(couple ? [['dbSurvivor', 'DB survivor pension %']] : [])];
    el.innerHTML = `${errorBox()}
      <div class="chart-grid">${who.map(([k, label]) => `<div data-who="${k}">${section(`${label}: retirement goals`, `<div class="grid two">${goalF.map(f => field(d[k], f)).join('')}</div>`)}
        ${section(`${label}: government & pension income`, `<div class="grid two">${benF.map(f => field(d[k], f)).join('')}</div>`)}</div>`).join('')}</div>
      <div id="sec-cpp">${section('When to start CPP and OAS (Option 1 · your plan)', `<div class="grid">
        ${field(s0, ['cppAge', (couple ? 'You: ' : '') + 'Start CPP at', `×${E.cppFactor(s0.cppAge).toFixed(2)} of the age-65 amount`, range(60, 70).map(a => [a, a])])}
        ${field(s0, ['oasAge', (couple ? 'You: ' : '') + 'Start OAS at', `×${E.oasFactor(s0.oasAge).toFixed(2)}`, range(65, 70).map(a => [a, a])])}
        ${couple ? field(s0, ['cppAge2', 'Spouse: start CPP at', null, range(60, 70).map(a => [a, a])]) + field(s0, ['oasAge2', 'Spouse: start OAS at', null, range(65, 70).map(a => [a, a])]) : ''}
      </div>`, 'Options 2 and 3 on the Scenarios tab try other ages.')}</div>
      <div id="sec-spend">${section('Spending over time', `<div class="grid">
        ${field(d.goals, ['slowAge', 'Spending changes from age', 'Your age'])}${field(d.goals, ['slowPct', 'Change %', 'e.g. −15 for the "slow-go" years'])}
        ${couple ? field(d.goals, ['survivorPct', 'Survivor spends % of couple budget', 'After the first death']) : ''}
      </div>`, 'Your retirement spending comes from the Budget tab.')}</div>`;
    $$('[data-who]', el).forEach(w => bind(w, d[w.dataset.who], () => changed()));
    bind($('#sec-cpp', el), s0, () => changed(true), ['cppAge', 'oasAge', 'cppAge2', 'oasAge2']);
    bind($('#sec-spend', el), d.goals, () => changed());
  }

  // ----- Accounts -----
  function tabAccounts(el) {
    const d = cur.data, couple = d.hasSpouse === 'yes';
    const owners = [['you', 'You'], ['spouse', d.spouse.firstName || 'Spouse']];
    liveFns.accounts = () => {
      const byType = {};
      for (const a of d.accounts) byType[a.type] = (byType[a.type] || 0) + (+a.balance || 0);
      const total = Object.values(byType).reduce((t, v) => t + v, 0);
      return `<div class="tiles">${M.ACCOUNT_TYPES.filter(([k]) => byType[k]).map(([k, l]) => tile(l, money(byType[k]), '')).join('')}${tile('Total', money(total), '')}</div>`;
    };
    el.innerHTML = section('Accounts', '<div id="acct-list"></div>', 'One row per account. Joint non-registered accounts: enter each person\'s share as its own row.') + '<div id="live"></div>';
    listEditor($('#acct-list', el), d.accounts, [
      ...(couple ? [['owner', 'Owner', 'select', owners]] : []),
      ['type', 'Type', 'select', M.ACCOUNT_TYPES], ['name', 'Name / institution', 'text'], ['balance', 'Balance', 'number'],
      ['acb', 'Cost base (ACB)', 'number', null, a => a.type === 'NONREG'],
      ['contrib', 'Your contributions', 'number', null, a => a.type === 'RESP'],
      ['grants', 'Grants (CESG)', 'number', null, a => a.type === 'RESP'],
      ['plan', 'Plan', 'select', a => (a.type === 'FHSA' ? [['rrsp', 'Move to RRSP'], ['home', 'Buy a home']] : [['eap', 'Child studies'], ['collapse', 'Collapse']]), a => a.type === 'FHSA' || a.type === 'RESP'],
      ['atAge', 'At your age', 'number', null, a => a.type === 'FHSA' || a.type === 'RESP'],
    ], () => ({ id: M.uid(), owner: 'you', type: 'RRSP', name: '', balance: 0 }), 'Add account', () => changed());
    $('#live', el).innerHTML = liveFns.accounts();
  }

  function tabInsurance(el) {
    el.innerHTML = section('Insurance', '<p class="muted">Coming soon. Life, disability and critical illness policies will be added here once the details are confirmed.</p>');
  }

  // ----- Assets & Liabilities -----
  function tabAssets(el) {
    const d = cur.data, couple = d.hasSpouse === 'yes';
    liveFns.assets = () => {
      const nw = M.netWorth(d);
      return `<div class="tiles">${tile('Accounts', money(nw.accounts), 'From the Accounts tab')}${tile('Assets', money(nw.assets), '')}${tile('Liabilities', money(nw.debts), '')}${tile('Net worth', money(nw.total), '')}</div>`;
    };
    el.innerHTML = `<div id="live">${liveFns.assets()}</div>
      ${section('Assets', '<div id="asset-list"></div>', 'Growth % can be negative (e.g. vehicles). "Sell at age" moves the proceeds into non-registered investments — e.g. downsizing. Leave 0 to keep it.')}
      ${section('Liabilities', '<div id="debt-list"></div>', 'Payments are added to spending until the balance is paid off.')}`;
    listEditor($('#asset-list', el), d.assets, [
      ['type', 'Type', 'select', M.ASSET_TYPES], ['name', 'Description', 'text'],
      ...(couple ? [['owner', 'Owner', 'select', [['joint', 'Joint'], ['you', 'You'], ['spouse', d.spouse.firstName || 'Spouse']]]] : []),
      ['value', 'Current value', 'number'], ['cost', 'Purchase price', 'number'], ['growth', 'Growth %/yr', 'number'],
      ['income', 'Net income $/yr', 'number'], ['sellAge', 'Sell at age', 'number'],
    ], () => ({ id: M.uid(), type: 'principal', name: '', owner: 'joint', value: 0, cost: 0, growth: 3, income: 0, sellAge: 0 }), 'Add asset', () => changed());
    listEditor($('#debt-list', el), d.liabilities, [
      ['type', 'Type', 'select', M.LIABILITY_TYPES], ['name', 'Description', 'text'], ['balance', 'Balance', 'number'],
      ['rate', 'Interest %', 'number'], ['payment', 'Monthly payment', 'number'],
    ], () => ({ id: M.uid(), type: 'mortgage', name: '', balance: 0, rate: 5, payment: 0 }), 'Add liability', () => changed());
  }

  // ----- Budget -----
  function tabBudget(el) {
    const d = cur.data, couple = d.hasSpouse === 'yes';
    liveFns.budget = () => {
      const m = M.annualSpending(d) / 12;
      const inc = d.budget.income.reduce((t, o) => t + (+o.monthly || 0), 0);
      return `<div class="tiles">${tile('Expenses / month', money(m), "Retirement, today's $")}${tile('Expenses / year', money(m * 12), 'Used as your after-tax spending goal')}${tile('Other income / month', money(inc), 'Taxable, before tax')}</div>`;
    };
    el.innerHTML = `<div id="live">${liveFns.budget()}</div>
      ${section('Other income in retirement', '<div id="inc-list"></div>', 'Part-time work, consulting, etc. (taxable). CPP, OAS and pensions go on the Goals tab; rent from a property goes on Assets.')}
      ${section('Retirement expenses (monthly, today\'s $)', `<div class="grid" id="exp">${M.EXPENSES.map(([k, l]) => field(d.budget.expenses, [k, l, null, null, 'number'])).join('')}</div>`,
        'Modelled on the FCAC <a href="https://www.canada.ca/en/financial-consumer-agency/services/make-budget.html" target="_blank" rel="noopener">Budget Planner</a>. Mortgage and loan payments go in Liabilities, so they are not counted twice.')}`;
    listEditor($('#inc-list', el), d.budget.income, [
      ...(couple ? [['owner', 'Who', 'select', [['you', 'You'], ['spouse', d.spouse.firstName || 'Spouse']]]] : []),
      ['name', 'Description', 'text'], ['monthly', '$ / month', 'number'], ['untilAge', 'Until their age', 'number'],
    ], () => ({ id: M.uid(), owner: 'you', name: '', monthly: 0, untilAge: 70 }), 'Add income', () => changed());
    bind($('#exp', el), d.budget.expenses, () => changed());
  }

  // ----- Taxes -----
  function tabTaxes(el) {
    if (!results) { el.innerHTML = errorBox(); return; }
    const res = results[selScenario()], couple = cur.data.hasSpouse === 'yes';
    const real = taxReal;
    const m = (v, r) => money(real ? v / r.f : v);
    const rows = res.rows.filter(r => !r.working);
    el.innerHTML = `<div class="card"><div class="row-between"><h2>Income tax by year</h2>
        <div class="controls">${scenarioSelect('tax-scen')}<label class="inline"><input type="checkbox" id="tax-real"${real ? ' checked' : ''}> Today's $</label></div></div>
        <p class="muted small">Province: ${esc(TD.provinces[inputs.province].name)}. ${couple ? 'Taxable income is shown for you / your spouse after pension splitting.' : ''}</p>
        <div class="table-wrap"><table class="data small"><thead><tr><th>Age</th><th>Taxable income</th><th>Federal</th><th>Provincial</th><th>OAS clawback</th><th>Total</th><th>Average</th><th>Marginal</th></tr></thead><tbody>
        ${rows.map(r => `<tr><td>${esc(r.label)}</td><td>${r.taxables && couple ? r.taxables.map(x => (x == null ? '—' : m(x, r))).join(' / ') : m(r.taxable, r)}</td>
          <td>${m(r.fed, r)}</td><td>${m(r.prov, r)}</td><td>${m(r.clawback, r)}</td><td>${m(r.tax, r)}</td>
          <td>${r.taxable > 0 ? pct(r.tax / r.taxable) : '—'}</td><td>${r.marginal == null ? '—' : pct(r.marginal)}</td></tr>`).join('')}
        </tbody></table></div></div>`;
    wireScenarioSelect('tax-scen');
    $('#tax-real').addEventListener('change', e => { taxReal = e.target.checked; renderTab(); });
  }
  let taxReal = true;

  // ----- Estate -----
  function tabEstate(el) {
    const d = cur.data;
    const body = () => {
      if (!results) return errorBox();
      const res = results[selScenario()], last = res.rows[res.rows.length - 1], f = last.f, s = res.summary;
      return `<div class="tiles">
        ${tile('After-tax estate', money(s.estate), `At the end of the plan (${last.label}), today's $`)}
        ${tile('Tax at death', money(s.deathTax), 'RRIF + taxable gains on the final return')}
        ${tile('RRSP / RRIF left', money(last.reg / f), 'Fully taxable at the last death')}
        ${tile('TFSA left', money(last.tfsa / f), 'Tax-free')}
        ${tile('Non-registered left', money((last.cash + last.inv) / f), 'Only gains are taxed')}
        ${tile('Property & other assets', money(last.assets / f), 'Principal residence is tax-free')}
        ${tile('Debt left', money(last.debt / f), '')}
      </div>`;
    };
    el.innerHTML = `<div class="row-between"><h2>Estate</h2><label class="inline">Scenario ${scenarioSelect('est-scen')}</label></div>
      <div id="est-body">${body()}</div>
      <div id="sec-assume">${section('Assumptions', `<div class="grid">
        ${field(d.assumptions, ['inflation', 'Inflation %/yr'])}${field(d.assumptions, ['rReg', 'RRSP/RRIF return %/yr'])}${field(d.assumptions, ['rTfsa', 'TFSA return %/yr'])}
        ${field(d.assumptions, ['rInv', 'Non-reg investments return %/yr'])}${field(d.assumptions, ['divYield', 'Of which eligible dividends %/yr'])}
        ${field(d.assumptions, ['rCash', 'Savings / GIC interest %/yr'])}${field(d.assumptions, ['rResp', 'RESP return %/yr'])}
      </div>`, 'Asset appreciation is set for each asset on the Assets & Liabilities tab.')}</div>`;
    wireScenarioSelect('est-scen');
    bind($('#sec-assume', el), d.assumptions, () => {
      changed();
      clearTimeout(tabEstate.t);
      tabEstate.t = setTimeout(() => { const b = $('#est-body'); if (b) b.innerHTML = body(); }, 300);
    });
  }

  // ----- Projection (comparison, charts, year-by-year) -----
  const DETAIL_COLS = [
    ['Age', r => r.label, 'n'], ['Spending', r => r.need], ['Employment', r => r.emp], ['CPP', r => r.cpp], ['OAS', r => r.oas], ['DB+other', r => r.db + r.other],
    ['Int+div', r => r.interest + r.div], ['RRIF min', r => r.minW], ['RRSP/RRIF out', r => r.regW], ['Withholding*', r => r.withholding],
    ['Non-reg out', r => r.cashW + r.invW], ['TFSA out', r => r.tfsaW], ['Taxable inc.', r => r.taxable, 'tx'],
    ['Pension split', r => r.split, 'sp'], ['Tax', r => r.tax && r.tax - r.clawback],
    ['OAS clawback', r => r.clawback], ['Marginal', r => r.marginal, 'p'], ['→TFSA', r => r.toTfsa], ['→Non-reg', r => r.toNonreg],
    ['RRSP/RRIF', r => r.reg], ['TFSA', r => r.tfsa], ['Non-reg', r => r.cash + r.inv], ['Savings total', r => r.total],
    ['Assets', r => r.assets], ['Debt', r => r.debt], ['Short', r => r.shortfall],
  ];
  let detailReal = true, mixScen = 0, detailScen = 0;
  function tabProjection(el) {
    if (!results) { el.innerHTML = errorBox(); return; }
    const couple = cur.data.hasSpouse === 'yes';
    const sc = cur.data.scenarios;
    const opts = sel => sc.map((s, i) => `<option value="${i}"${i === sel ? ' selected' : ''}>${esc(s.name)}</option>`).join('');
    el.innerHTML = `
      <div class="card"><h2>Scenario comparison <span class="muted small">(today's dollars)</span></h2><div class="table-wrap"><table id="compare" class="data"></table></div></div>
      <div class="chart-grid">
        <div class="card"><h3>Savings by age (today's $)</h3><div class="chart-box"><canvas id="ch-bal"></canvas></div></div>
        <div class="card"><h3>Income tax + OAS clawback per year (today's $)</h3><div class="chart-box"><canvas id="ch-tax"></canvas></div></div>
      </div>
      <div class="card"><div class="row-between"><h3>Where the money comes from</h3><select id="mix-scen">${opts(mixScen)}</select></div><div class="chart-box tall"><canvas id="ch-mix"></canvas></div></div>
      <div class="card"><div class="row-between"><h3>Year-by-year plan</h3>
        <div class="controls"><select id="detail-scen">${opts(detailScen)}</select><label class="inline"><input type="checkbox" id="real-toggle"${detailReal ? ' checked' : ''}> Today's $</label><button id="csv">Export CSV</button></div></div>
        <div class="table-wrap"><table id="detail" class="data small"></table></div>
        <p class="muted small">* Withholding is tax the institution holds back on RRIF amounts above the minimum; it's credited on your return.</p></div>`;
    // comparison
    const Sm = results.map(r => r.summary);
    const best = (vals, hi) => { const b = hi ? Math.max(...vals) : Math.min(...vals); return vals.map(v => Math.abs(v - b) < 1); };
    const rows = [
      ['Money lasts', Sm.map(s => (s.depletedAge ? `runs short at ${s.depletedAge}` : `to the end ✓`)), Sm.map(s => !s.depletedAge), Sm.map(s => !!s.depletedAge)],
      ['After-tax estate at end', Sm.map(s => money(s.estate)), best(Sm.map(s => s.estate), true)],
      ['Lifetime income tax + clawback', Sm.map(s => money(s.lifetimeTax)), best(Sm.map(s => s.lifetimeTax), false)],
      ['…of which OAS clawback', Sm.map(s => money(s.clawback)), best(Sm.map(s => s.clawback), false)],
      ['Tax at death', Sm.map(s => money(s.deathTax)), best(Sm.map(s => s.deathTax), false)],
      ['Average tax rate in retirement', Sm.map(s => pct(s.avgRate)), best(Sm.map(s => s.avgRate), false)],
      ['CPP + OAS kept (lifetime)', Sm.map(s => money(s.cppOas)), best(Sm.map(s => s.cppOas), true)],
      ...(couple ? [['Pension income split (lifetime)', Sm.map(s => money(s.split))]] : []),
      ['RRSP/RRIF withdrawal, 1st retired year', Sm.map(s => money(s.firstRegW))],
      ['Unfunded spending', Sm.map(s => money(s.shortfall)), null, Sm.map(s => s.shortfall > 1)],
    ];
    $('#compare').innerHTML = `<thead><tr><th></th>${sc.map((s, i) => `<th><span class="swatch" style="--c:var(${COLORS[i]})"></span>${esc(s.name)}</th>`).join('')}</tr></thead>
      <tbody>${rows.map(([label, vals, good, bad]) => `<tr><td>${label}</td>${vals.map((v, i) => `<td class="${good && good[i] ? 'best' : ''}${bad && bad[i] ? ' bad' : ''}">${v}</td>`).join('')}</tr>`).join('')}</tbody>`;
    if (window.Chart) {
      chartDefaults();
      const labels = results[0].rows.map(r => r.label);
      const line = (id, fn) => new Chart($(id), { type: 'line', data: { labels, datasets: results.map((res, i) => ({ label: sc[i].name, data: res.rows.map(fn), borderColor: css(COLORS[i]), backgroundColor: css(COLORS[i]), pointRadius: 0, borderWidth: 2, tension: 0.2 })) }, options: lineOpts() });
      charts.bal = line('#ch-bal', r => r.total / r.f);
      charts.tax = line('#ch-tax', r => (r.working ? null : r.tax / r.f));
      drawMix();
    }
    drawDetail();
    $('#mix-scen').addEventListener('change', e => { mixScen = +e.target.value; drawMix(); });
    $('#detail-scen').addEventListener('change', e => { detailScen = +e.target.value; drawDetail(); });
    $('#real-toggle').addEventListener('change', e => { detailReal = e.target.checked; drawDetail(); });
    $('#csv').addEventListener('click', exportCsv);
  }
  function drawMix() {
    if (!window.Chart) return;
    if (charts.mix) charts.mix.destroy();
    const rows = results[mixScen].rows.filter(r => !r.working);
    const series = [
      ['Employment (net of RRSP contrib.)', r => r.emp, '#7a8a99'], ['CPP', r => r.cpp, '#6c8ebf'], ['OAS (after clawback)', r => r.oas - r.clawback, '#9fb8d9'],
      ['DB pension + other', r => r.db + r.other, '#8a7fb8'], ['Interest + dividends', r => r.interest + r.div, '#b6a96b'],
      ['RRSP/RRIF', r => r.regW, css('--s2')], ['Non-reg sales', r => r.cashW + r.invW, '#d9b26b'], ['TFSA', r => r.tfsaW, css('--s3')],
      ['Tax', r => -(r.tax - r.clawback), css('--bad')],
    ];
    charts.mix = new Chart($('#ch-mix'), {
      type: 'bar',
      data: { labels: rows.map(r => r.label), datasets: series.map(([label, fn, color]) => ({ label, data: rows.map(r => fn(r) / r.f), backgroundColor: color, stack: 's' })) },
      options: { ...lineOpts(), scales: { x: { stacked: true }, y: { stacked: true, ticks: { callback: kfmt } } } },
    });
  }
  function drawDetail() {
    const real = detailReal;
    const cell = (r, [, fn, t]) => {
      const v = fn(r);
      if (v == null) return '—';
      if (t === 'n') return esc(v);
      if (t === 'p') return pct(v);
      const m = x => money(real ? x / r.f : x);
      if (t === 'tx') return r.taxables && r.taxables.length === 2 ? r.taxables.map(x => (x == null ? '—' : m(x))).join(' / ') : m(v);
      if (t === 'sp') return !v || Math.abs(v) < 1 ? '—' : (v > 0 ? 'you→sp ' : 'sp→you ') + m(Math.abs(v));
      return m(v);
    };
    $('#detail').innerHTML = `<thead><tr>${DETAIL_COLS.map(c => `<th>${c[0]}</th>`).join('')}<th>Notes</th></tr></thead><tbody>${
      results[detailScen].rows.map(r => `<tr class="${r.working ? 'working' : ''}">${DETAIL_COLS.map(c => `<td class="${c[0] === 'Short' && r.shortfall > 1 ? 'bad' : ''}">${cell(r, c)}</td>`).join('')}<td class="note">${esc((r.working ? ['Working / saving'] : []).concat(r.notes).join('; '))}</td></tr>`).join('')
    }</tbody>`;
  }
  function exportCsv() {
    const real = detailReal;
    const q = v => `"${String(v).replace(/"/g, '""')}"`;
    const lines = [DETAIL_COLS.map(c => c[0]).concat('Notes').join(',')];
    for (const r of results[detailScen].rows) {
      lines.push(DETAIL_COLS.map(([, fn, t]) => { const v = fn(r); return v == null ? '' : t === 'n' ? q(v) : t === 'p' ? (v * 100).toFixed(1) : Math.round(real ? v / r.f : v); })
        .concat(q(r.notes.join('; '))).join(','));
    }
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([lines.join('\n')], { type: 'text/csv' }));
    a.download = `${cur.name.replace(/[^\w-]+/g, '-')}-option-${detailScen + 1}.csv`;
    a.click();
  }

  // ----- Scenarios -----
  const ORDERS = [
    ['cash,inv,tfsa,reg', 'Non-reg → TFSA → RRSP/RRIF (traditional)'], ['cash,inv,reg,tfsa', 'Non-reg → RRSP/RRIF → TFSA (TFSA last)'],
    ['reg,cash,inv,tfsa', 'RRSP/RRIF → Non-reg → TFSA'], ['tfsa,cash,inv,reg', 'TFSA → Non-reg → RRSP/RRIF'],
  ];
  const STRATEGIES = [['min', 'RRIF minimum only (plus top-ups when needed)'], ['fill', 'Fill to a taxable-income target (RRSP meltdown)'], ['fixed', 'Fixed annual RRSP/RRIF withdrawal']];
  function tabScenarios(el) {
    const C = cur.data.hasSpouse === 'yes';
    el.innerHTML = `${errorBox()}<p class="muted">Each option is a different plan for the same household. Change any setting, or let <b>Optimize</b> search for the RRSP/RRIF withdrawal level (and optionally CPP/OAS ages) that leaves the most after-tax money while still meeting spending.</p>
      <div class="scen-grid">${cur.data.scenarios.map((s, i) => `
      <div class="card scen" style="--c:var(${COLORS[i]})" data-i="${i}">
        <div class="grid two">
          <div class="full">${field(s, ['name', 'Name'])}</div>
          ${field(s, ['cppAge', (C ? 'You: ' : '') + 'CPP starts at', `×${E.cppFactor(s.cppAge).toFixed(2)} of age-65 amount`, range(60, 70).map(a => [a, a])])}
          ${field(s, ['oasAge', (C ? 'You: ' : '') + 'OAS starts at', `×${E.oasFactor(s.oasAge).toFixed(2)} of age-65 amount`, range(65, 70).map(a => [a, a])])}
          ${C ? field(s, ['cppAge2', 'Spouse: CPP starts at', `×${E.cppFactor(s.cppAge2).toFixed(2)}`, range(60, 70).map(a => [a, a])]) : ''}
          ${C ? field(s, ['oasAge2', 'Spouse: OAS starts at', `×${E.oasFactor(s.oasAge2).toFixed(2)}`, range(65, 70).map(a => [a, a])]) : ''}
          <div class="full">${field(s, ['rrifStart', (C ? 'You: ' : '') + 'RRIF minimums start at age', 'Convert RRSP→RRIF the year before. Latest: convert by end of age 71, first minimum at 72. Converting by 64 gives the pension credit at 65+.', range(55, 72).map(a => [a, a])])}</div>
          ${C ? `<div class="full">${field(s, ['rrifStart2', 'Spouse: RRIF minimums start at age', null, range(55, 72).map(a => [a, a])])}</div>` : ''}
          ${C ? field(s, ['pensionSplit', 'Pension income splitting', 'Up to 50% of RRIF (65+) and DB pension income', [['opt', 'Optimize each year'], ['none', 'Off']]]) : ''}
          ${C ? field(s, ['useYounger', 'RRIF minimum based on', "Younger spouse's age = lower minimums", [['no', 'Own age'], ['yes', "Younger spouse's age"]]]) : ''}
          <div class="full">${field(s, ['strategy', 'RRSP / RRIF withdrawal strategy', null, STRATEGIES])}</div>
          ${s.strategy === 'fill' ? field(s, ['fillTarget', "Fill taxable income to ($, today's)" + (C ? ' — each person' : ''), `Top of 1st federal bracket ${money(TD.federal.brackets[0][0])}; OAS clawback starts ${money(TD.oas.clawbackThreshold)}`]) : ''}
          ${s.strategy === 'fixed' ? field(s, ['fixedAmt', "Annual withdrawal ($, today's)" + (C ? ' — each person' : ''), 'Never less than the RRIF minimum']) : ''}
          ${s.strategy !== 'min' ? field(s, ['fillUntil', 'Use this strategy until age', 'Then minimums only']) : ''}
          <div class="full">${field(s, ['order', 'Order for any extra cash needed', null, ORDERS])}</div>
        </div>
        <div class="btns"><button data-opt="draw" class="primary">Optimize RRSP draw</button><button data-opt="all">Optimize draw + CPP/OAS ages</button></div>
        <div class="opt-msg"></div>
      </div>`).join('')}</div>`;
    $$('.scen', el).forEach(card => {
      const i = +card.dataset.i, s = cur.data.scenarios[i];
      const textKeys = ['name', 'strategy', 'order', 'pensionSplit', 'useYounger'];
      $$('[data-k]', card).forEach(inp => inp.addEventListener('change', () => {
        const k = inp.dataset.k;
        s[k] = textKeys.includes(k) ? inp.value : Number(inp.value);
        changed(['strategy', 'cppAge', 'oasAge', 'cppAge2', 'oasAge2'].includes(k));
      }));
      $$('[data-opt]', card).forEach(btn => btn.addEventListener('click', () => runOptimize(i, btn.dataset.opt === 'all', card)));
    });
  }
  function runOptimize(i, withTiming, card) {
    if (!results) return;
    const msg = $('.opt-msg', card);
    $$('button', card).forEach(b => (b.disabled = true));
    msg.textContent = 'Searching…';
    setTimeout(() => {
      const sc = cur.data.scenarios;
      const before = results[i].summary;
      const best = E.optimize(inputs, sc[i], withTiming);
      const isDefault = /^Option \d · (Your plan|RRSP meltdown|Fixed draw)/.test(sc[i].name);
      sc[i] = { ...best.scenario, name: isDefault && i > 0 ? `Option ${i + 1} · Optimized` : sc[i].name };
      changed(true);
      recalc();
      renderTab();
      const s = best.scenario;
      $(`.scen[data-i="${i}"] .opt-msg`).textContent = (s.strategy === 'fill' ? `Best: fill taxable income to ${money(s.fillTarget)}` : 'Best: RRIF minimums only')
        + (withTiming ? `, CPP at ${s.cppAge}, OAS at ${s.oasAge}${cur.data.hasSpouse === 'yes' ? ' (both of you)' : ''}` : '')
        + `. After-tax estate ${money(before.estate)} → ${money(best.res.summary.estate)}.`;
    }, 30);
  }

  // ----- Rules -----
  function tabRules(el) {
    el.innerHTML = '';
    el.appendChild($('#rules-template').content.cloneNode(true));
    const ages = range(55, 95), half = Math.ceil(ages.length / 2);
    const p2 = a => (E.rrifMinRate(a) * 100).toFixed(2) + '%';
    const rows = [];
    for (let k = 0; k < half; k++) {
      const a = ages[k], b = ages[k + half];
      rows.push(`<tr><td>${a}</td><td>${p2(a)}</td><td>${b ? (b === 95 ? '95+' : b) : ''}</td><td>${b ? p2(b) : ''}</td></tr>`);
    }
    $('#rrif-table', el).innerHTML = `<thead><tr><th>Age Jan 1</th><th>Min %</th><th>Age Jan 1</th><th>Min %</th></tr></thead><tbody>${rows.join('')}</tbody>`;
    const upd = () => {
      const bal = Number($('#rc-bal').value) || 0, age = Math.max(20, Math.min(120, Number($('#rc-age').value) || 71));
      const rate = E.rrifMinRate(age);
      $('#rc-out').textContent = `${money(bal * rate)} (${(rate * 100).toFixed(2)}%)`;
    };
    $('#rc-bal').addEventListener('input', upd);
    $('#rc-age').addEventListener('input', upd);
    upd();
  }

  // ---------------- charts ----------------
  const kfmt = v => '$' + (Math.abs(v) >= 1e6 ? (v / 1e6).toFixed(1) + 'M' : Math.round(v / 1000) + 'k');
  function chartDefaults() {
    Chart.defaults.color = css('--muted');
    Chart.defaults.borderColor = css('--border');
    Chart.defaults.font.family = getComputedStyle(document.body).fontFamily;
  }
  const lineOpts = () => ({
    responsive: true, maintainAspectRatio: false, interaction: { mode: 'index', intersect: false },
    scales: { y: { ticks: { callback: kfmt } }, x: { title: { display: true, text: cur && cur.data.hasSpouse === 'yes' ? 'Age (you / spouse)' : 'Age' } } },
    plugins: { tooltip: { callbacks: { label: c => `${c.dataset.label}: ${money(c.parsed.y)}` } } },
  });

  boot();
  window.__fimoksha = { state: () => ({ me, cur, inputs, results }) };
})();
