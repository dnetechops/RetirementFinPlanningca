// Data layer. Same interface for Supabase (real multi-user) and a demo mode that
// keeps everything in this browser and applies the same access rules as the database.
(function () {
  const cfg = window.FIMOKSHA_CONFIG || {};
  const useSupabase = !!(cfg.supabaseUrl && cfg.supabaseAnonKey);

  // ---------------- Supabase ----------------
  function supabaseStore() {
    let sb, me = null, recovery = /type=recovery/.test(location.hash);
    const SB_SCRIPT = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.117.3/dist/umd/supabase.js';
    const load = () => new Promise((res, rej) => {
      if (window.supabase) return res();
      const s = document.createElement('script');
      s.src = SB_SCRIPT; s.onload = res; s.onerror = () => rej(new Error('Could not load Supabase library'));
      document.head.appendChild(s);
    });
    const err = r => { if (r.error) throw new Error(r.error.message); return r.data; };
    async function loadMe() {
      const { data } = await sb.auth.getUser();
      if (!data.user) return (me = null);
      const prof = err(await sb.from('profiles').select('*').eq('id', data.user.id).single());
      return (me = { id: prof.id, email: prof.email, firstName: prof.first_name || '', lastName: prof.last_name || '', role: prof.role });
    }
    return {
      mode: 'supabase',
      async init() {
        await load();
        sb = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey);
        sb.auth.onAuthStateChange(event => { if (event === 'PASSWORD_RECOVERY') recovery = true; });
        const user = await loadMe();
        // Clean the sign-in tokens out of the address bar after an email link.
        if (/access_token|code=|type=/.test(location.hash + location.search)) history.replaceState(null, '', location.pathname);
        return user;
      },
      inRecovery: () => recovery,
      async setNewPassword(password) { err(await sb.auth.updateUser({ password })); recovery = false; },
      me: () => me,
      async signIn(email, password) { err(await sb.auth.signInWithPassword({ email, password })); return loadMe(); },
      async signUp(email, password, firstName, lastName) {
        const d = err(await sb.auth.signUp({ email, password, options: { data: { first_name: firstName, last_name: lastName }, emailRedirectTo: location.origin + location.pathname } }));
        if (!d.session) return { needsConfirmation: true };
        return loadMe();
      },
      async resetPassword(email) { err(await sb.auth.resetPasswordForEmail(email, { redirectTo: location.origin + location.pathname })); },
      async signOut() { await sb.auth.signOut(); me = null; },
      async listHouseholds() {
        const rows = err(await sb.from('households').select('id, name, owner_id, updated_at, owner:profiles!households_owner_id_fkey(first_name, last_name, email)').order('updated_at', { ascending: false }));
        return rows.map(r => ({ id: r.id, name: r.name, ownerId: r.owner_id, updatedAt: r.updated_at, ownerName: r.owner ? `${r.owner.first_name || ''} ${r.owner.last_name || ''}`.trim() || r.owner.email : '' }));
      },
      async getHousehold(id) {
        const r = err(await sb.from('households').select('id, name, owner_id, data, updated_at').eq('id', id).single());
        return { id: r.id, name: r.name, ownerId: r.owner_id, data: r.data, updatedAt: r.updated_at };
      },
      async createHousehold(name, data) {
        const r = err(await sb.from('households').insert({ owner_id: me.id, name, data }).select('id').single());
        return r.id;
      },
      async saveHousehold(id, name, data) { err(await sb.from('households').update({ name, data }).eq('id', id)); },
      async updateMyName(firstName, lastName) {
        err(await sb.from('profiles').update({ first_name: firstName, last_name: lastName }).eq('id', me.id));
        me.firstName = firstName; me.lastName = lastName;
      },
      async listProfiles() {
        return err(await sb.from('profiles').select('id, email, first_name, last_name, role').order('email'))
          .map(p => ({ id: p.id, email: p.email, firstName: p.first_name || '', lastName: p.last_name || '', role: p.role }));
      },
      async setRole(userId, role) { err(await sb.from('profiles').update({ role }).eq('id', userId)); },
      async listAssignments() { return err(await sb.from('advisor_assignments').select('advisor_id, household_id')).map(a => ({ advisorId: a.advisor_id, householdId: a.household_id })); },
      async setAdvisor(householdId, advisorId) {
        err(await sb.from('advisor_assignments').delete().eq('household_id', householdId));
        if (advisorId) err(await sb.from('advisor_assignments').insert({ advisor_id: advisorId, household_id: householdId }));
      },
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
      async setRole(userId, role) { need(me && me.role === 'admin'); read().users.find(u => u.id === userId).role = role; write(); },
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

  window.Store = useSupabase ? supabaseStore() : demoStore();
})();
