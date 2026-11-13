// Data layer. Same interface for the FiMoksha server (real multi-user, server/server.mjs) and a demo
// mode that keeps everything in this browser and applies the same access rules as the server.
(function () {

  // ---------------- Own server (server/server.mjs) ----------------
  function serverStore(health) {
    let me = null, resetToken = null;
    async function api(method, url, body) {
      const r = await fetch('api' + url, {
        method, credentials: 'same-origin',
        headers: method === 'GET' ? {} : { 'Content-Type': 'application/json', 'X-Fimoksha': '1' },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      let out = {};
      try { out = await r.json(); } catch (e) { /* empty reply */ }
      if (!r.ok) throw new Error(out.error || `Server error (${r.status})`);
      return out;
    }
    const setMe = out => (me = out && out.user ? out.user : null);
    return {
      mode: 'server',
      features: { email: !!health.email, signup: !!health.signup },
      async init() {
        const qs = new URLSearchParams(location.search);
        const confirm = qs.get('confirm');
        resetToken = qs.get('reset');
        // Take the one-time token out of the address bar.
        if (confirm || resetToken) history.replaceState(null, '', location.pathname);
        if (confirm) {
          try { return setMe(await api('POST', '/auth/confirm', { token: confirm })); }
          catch (e) { alert(e.message); }
        }
        return setMe(await api('GET', '/me'));
      },
      inRecovery: () => !!resetToken,
      async setNewPassword(password) { const out = await api('POST', '/auth/reset', { token: resetToken, password }); resetToken = null; return setMe(out); },
      me: () => me,
      async signIn(email, password) { return setMe(await api('POST', '/auth/signin', { email, password })); },
      async signUp(email, password, firstName, lastName) {
        const out = await api('POST', '/auth/signup', { email, password, firstName, lastName });
        if (out.needsConfirmation) return { needsConfirmation: true };
        return setMe(out);
      },
      async resetPassword(email) { await api('POST', '/auth/forgot', { email }); },
      async changePassword(current, password) { await api('POST', '/me/password', { current, password }); },
      async signOut() { await api('POST', '/auth/signout'); me = null; },
      listHouseholds: () => api('GET', '/households'),
      getHousehold: id => api('GET', '/households/' + encodeURIComponent(id)),
      async createHousehold(name, data) { return (await api('POST', '/households', { name, data })).id; },
      async saveHousehold(id, name, data) { await api('PUT', '/households/' + encodeURIComponent(id), { name, data }); },
      async updateMyName(firstName, lastName) { await api('PATCH', '/me', { firstName, lastName }); me.firstName = firstName; me.lastName = lastName; },
      listProfiles: () => api('GET', '/users'),
      async setRole(userId, role) { await api('PATCH', '/users/' + encodeURIComponent(userId), { role }); },
      async createUser(u) { return (await api('POST', '/users', u)).user; },
      async adminSetPassword(userId, password) { await api('POST', `/users/${encodeURIComponent(userId)}/password`, { password }); },
      listAssignments: () => api('GET', '/assignments'),
      async setAdvisor(householdId, advisorId) { await api('PUT', `/households/${encodeURIComponent(householdId)}/advisor`, { advisorId: advisorId || null }); },
    };
  }

  // ---------------- Demo (this browser only) ----------------
  function demoStore() {
    const KEY = 'fimoksha-demo-db-v1', SESSION = 'fimoksha-demo-session';
    const uid = () => (crypto.randomUUID ? crypto.randomUUID() : 'id-' + Math.random().toString(36).slice(2));
    let mem = null, me = null;
    function read() {
      if (mem) return mem;
      try { mem = JSON.parse(localStorage.getItem(KEY)); } catch (e) { mem = null; }
      if (!mem) mem = seed();
      return mem;
    }
    function write() { try { localStorage.setItem(KEY, JSON.stringify(mem)); } catch (e) { /* storage unavailable: keep in memory */ } }
    function seed() {
      const M = window.Model;
      const users = [
        { id: uid(), email: 'admin@demo.fimoksha', firstName: 'Ada', lastName: 'Admin', role: 'admin' },
        { id: uid(), email: 'advisor@demo.fimoksha', firstName: 'Avery', lastName: 'Advisor', role: 'advisor' },
        { id: uid(), email: 'chris@demo.fimoksha', firstName: 'Chris', lastName: 'Client', role: 'client' },
        { id: uid(), email: 'dana@demo.fimoksha', firstName: 'Dana', lastName: 'Client', role: 'client' },
      ];
      const h1 = { id: uid(), ownerId: users[2].id, name: 'Chris & Sam household', data: M.sampleCouple(users[2]), updatedAt: new Date().toISOString() };
      const h2 = { id: uid(), ownerId: users[3].id, name: 'Dana household', data: M.newHousehold(users[3]), updatedAt: new Date().toISOString() };
      mem = { users, households: [h1, h2], assignments: [{ advisorId: users[1].id, householdId: h1.id }] };
      write();
      return mem;
    }
    const can = h => me && (me.role === 'admin' || h.ownerId === me.id ||
      (me.role === 'advisor' && read().assignments.some(a => a.householdId === h.id && a.advisorId === me.id)));
    const need = cond => { if (!cond) throw new Error('Not allowed'); };
    const clone = o => JSON.parse(JSON.stringify(o));
    return {
      mode: 'demo',
      async init() {
        let id = null;
        try { id = sessionStorage.getItem(SESSION); } catch (e) { /* ignore */ }
        me = read().users.find(u => u.id === id) || null;
        return me && { ...me };
      },
      me: () => me && { ...me },
      inRecovery: () => false,
      demoUsers: () => read().users.map(u => ({ ...u })),
      async demoSignIn(id) {
        me = read().users.find(u => u.id === id) || null;
        try { sessionStorage.setItem(SESSION, id); } catch (e) { /* ignore */ }
        return me && { ...me };
      },
      async signIn() { throw new Error('Demo mode: pick a demo user, or create one.'); },
      async signUp(email, password, firstName, lastName) {
        const db = read();
        if (db.users.some(u => u.email.toLowerCase() === email.toLowerCase())) throw new Error('That email is already used in this demo.');
        const u = { id: uid(), email, firstName, lastName, role: 'client' };
        db.users.push(u); write();
        return this.demoSignIn(u.id);
      },
      async resetPassword() { throw new Error('Not available in demo mode.'); },
      async signOut() { me = null; try { sessionStorage.removeItem(SESSION); } catch (e) { /* ignore */ } },
      async listHouseholds() {
        const db = read();
        return db.households.filter(can).map(h => {
          const o = db.users.find(u => u.id === h.ownerId);
          return { id: h.id, name: h.name, ownerId: h.ownerId, updatedAt: h.updatedAt, ownerName: o ? `${o.firstName} ${o.lastName}` : '' };
        });
      },
      async getHousehold(id) { const h = read().households.find(x => x.id === id); need(h && can(h)); return clone(h); },
      async createHousehold(name, data) {
        need(me);
        const h = { id: uid(), ownerId: me.id, name, data: clone(data), updatedAt: new Date().toISOString() };
        read().households.push(h); write();
        return h.id;
      },
      async saveHousehold(id, name, data) {
        const h = read().households.find(x => x.id === id); need(h && can(h));
        Object.assign(h, { name, data: clone(data), updatedAt: new Date().toISOString(), updatedBy: me.id }); write();
      },
      async updateMyName(firstName, lastName) {
        const u = read().users.find(x => x.id === me.id); Object.assign(u, { firstName, lastName }); Object.assign(me, { firstName, lastName }); write();
      },
      async listProfiles() {
        need(me);
        const db = read();
        const visible = me.role === 'admin' ? db.users : db.users.filter(u => u.id === me.id ||
          db.households.some(h => h.ownerId === u.id && can(h)));
        return visible.map(u => ({ ...u }));
      },
      features: { email: false, signup: true },
      async setRole(userId, role) { need(me && me.role === 'admin' && userId !== me.id); read().users.find(u => u.id === userId).role = role; write(); },
      async createUser(u) {
        need(me && me.role === 'admin');
        const db = read();
        if (db.users.some(x => x.email.toLowerCase() === String(u.email).toLowerCase())) throw new Error('That email already has an account.');
        const nu = { id: uid(), email: u.email, firstName: u.firstName || '', lastName: u.lastName || '', role: u.role || 'client' };
        db.users.push(nu); write();
        return { ...nu };
      },
      async listAssignments() { need(me); return read().assignments.filter(a => me.role === 'admin' || a.advisorId === me.id).map(a => ({ ...a })); },
      async setAdvisor(householdId, advisorId) {
        need(me && me.role === 'admin');
        const db = read();
        db.assignments = db.assignments.filter(a => a.householdId !== householdId);
        if (advisorId) db.assignments.push({ advisorId, householdId });
        write();
      },
      resetDemo() { try { localStorage.removeItem(KEY); sessionStorage.removeItem(SESSION); } catch (e) { /* ignore */ } mem = null; me = null; },
    };
  }

  // Use the server when the page was served by it (it answers /api/health); otherwise demo mode,
  // e.g. when index.html is opened as a file or hosted on a static site.
  const cfg = window.FIMOKSHA_CONFIG || {};
  let impl = null;
  async function pick() {
    if (cfg.mode === 'demo' || location.protocol === 'file:') return demoStore();
    try {
      const r = await fetch('api/health', { credentials: 'same-origin' });
      const h = r.ok ? await r.json() : null;
      if (h && h.ok) return serverStore(h);
    } catch (e) { /* no server */ }
    if (cfg.mode === 'server') throw new Error("Can't reach the FiMoksha server.");
    return demoStore();
  }
  window.Store = new Proxy({}, {
    get(_, k) {
      if (k === 'init') return async () => { impl = await pick(); return impl.init(); };
      if (!impl) throw new Error('Store used before init()');
      return impl[k];
    },
  });
})();
