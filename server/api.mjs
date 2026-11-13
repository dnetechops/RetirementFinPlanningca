// FiMoksha HTTP app: serves the static site and a JSON API at /api.
// Access rules: clients see their own household, advisors the households assigned to them,
// admins everything. Every rule is checked here on the server, never only in the browser.
import { createHash, randomBytes, scrypt as scryptCb, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';

const scrypt = promisify(scryptCb);
const ROLES = ['client', 'advisor', 'admin'];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const SESSION_DAYS = 14;
const COOKIE = 'fm_sid';
const MAX_BODY = 5 * 1024 * 1024;

class HttpError extends Error { constructor(status, msg) { super(msg); this.status = status; } }
const bad = msg => new HttpError(400, msg);
const deny = (msg = 'Not allowed') => new HttpError(403, msg);
const notFound = () => new HttpError(404, 'Not found');

const sha256 = s => createHash('sha256').update(s).digest('hex');
const newToken = () => randomBytes(32).toString('base64url');

export async function hashPassword(pw) {
  const salt = randomBytes(16);
  const key = await scrypt(pw, salt, 64, { N: 16384, r: 8, p: 1 });
  return `scrypt$16384$8$1$${salt.toString('base64')}$${key.toString('base64')}`;
}
async function verifyPassword(pw, stored) {
  const [alg, N, r, p, salt, hash] = String(stored).split('$');
  if (alg !== 'scrypt') return false;
  const want = Buffer.from(hash, 'base64');
  const got = await scrypt(pw, Buffer.from(salt, 'base64'), want.length, { N: +N, r: +r, p: +p });
  return timingSafeEqual(want, got);
}
// Used when the email isn't found, so sign-in takes the same time either way.
const DUMMY_HASH = 'scrypt$16384$8$1$AAAAAAAAAAAAAAAAAAAAAA==$' + Buffer.alloc(64).toString('base64');

const str = (v, max = 200) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
function checkPassword(pw) {
  if (typeof pw !== 'string' || pw.length < 8) throw bad('Password must be at least 8 characters.');
  if (pw.length > 200) throw bad('Password is too long.');
}
const userOut = u => u && ({ id: u.id, email: u.email, firstName: u.first_name || '', lastName: u.last_name || '', role: u.role });

/**
 * @param {object} o
 * @param {{query: (sql: string, params?: any[]) => Promise<{rows: any[]}>}} o.db
 * @param {null | {send: (to: string, subject: string, text: string) => Promise<void>}} o.mail
 * @param {string} [o.publicUrl]   base URL used in email links, e.g. https://plan.example.ca
 * @param {boolean} [o.allowSignup]
 * @param {boolean} [o.secureCookies]
 * @param {string} [o.staticRoot]  folder holding index.html, css/, js/, vendor/
 */
export function createApp({ db, mail = null, publicUrl = '', allowSignup = true, secureCookies = false, staticRoot = null }) {
  const q = async (sql, params) => (await db.query(sql, params)).rows;
  const one = async (sql, params) => (await q(sql, params))[0] || null;

  // ---------- sign-in throttling (per IP + email, in memory) ----------
  const fails = new Map();
  const throttleKey = (req, email) => `${req.socket.remoteAddress}|${email}`;
  function checkThrottle(key) {
    const f = fails.get(key);
    if (f && f.count >= 10 && f.until > Date.now()) throw new HttpError(429, 'Too many attempts. Try again in 15 minutes.');
  }
  function noteFail(key) {
    const f = fails.get(key);
    const fresh = !f || f.until < Date.now();
    fails.set(key, { count: fresh ? 1 : f.count + 1, until: Date.now() + 15 * 60 * 1000 });
    if (fails.size > 10000) for (const [k, v] of fails) if (v.until < Date.now()) fails.delete(k);
  }

  // ---------- sessions ----------
  function readCookie(req) {
    const m = (req.headers.cookie || '').match(new RegExp(`(?:^|;\\s*)${COOKIE}=([^;]+)`));
    return m ? m[1] : null;
  }
  function setCookie(res, value, maxAge) {
    res.setHeader('Set-Cookie', `${COOKIE}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secureCookies ? '; Secure' : ''}`);
  }
  async function startSession(res, userId) {
    const token = newToken();
    await q(`delete from sessions where expires_at < now()`);
    await q(`insert into sessions (token_hash, user_id, expires_at) values ($1, $2, now() + interval '${SESSION_DAYS} days')`, [sha256(token), userId]);
    setCookie(res, token, SESSION_DAYS * 86400);
  }
  async function currentUser(req) {
    const t = readCookie(req);
    if (!t) return null;
    return one(`select u.* from sessions s join users u on u.id = s.user_id where s.token_hash = $1 and s.expires_at > now()`, [sha256(t)]);
  }

  // ---------- access ----------
  const VISIBLE = `($1 = 'admin' or h.owner_id = $2 or ($1 = 'advisor' and exists (
      select 1 from advisor_assignments a where a.household_id = h.id and a.advisor_id = $2)))`;
  async function mustAccess(me, id) {
    if (!UUID.test(id)) throw notFound();
    const h = await one(`select h.id from households h where h.id = $3 and ${VISIBLE}`, [me.role, me.id, id]);
    if (!h) throw notFound();   // same answer for "missing" and "not yours"
  }
  const needUser = me => { if (!me) throw new HttpError(401, 'Please sign in.'); return me; };
  const needAdmin = me => { needUser(me); if (me.role !== 'admin') throw deny('Only an admin can do that.'); return me; };

  // ---------- email links ----------
  async function emailLink(user, kind) {
    const token = newToken();
    const hours = kind === 'reset' ? 1 : 48;
    await q(`delete from email_tokens where user_id = $1 and kind = $2`, [user.id, kind]);
    await q(`insert into email_tokens (token_hash, user_id, kind, expires_at) values ($1, $2, $3, now() + interval '${hours} hours')`, [sha256(token), user.id, kind]);
    const url = `${publicUrl.replace(/\/$/, '')}/?${kind}=${token}`;
    const [subject, text] = kind === 'reset'
      ? ['Reset your FiMoksha password', `Hi ${user.first_name || ''},\n\nUse this link within 1 hour to choose a new password:\n${url}\n\nIf you didn't ask for this, ignore this email.`]
      : ['Confirm your FiMoksha account', `Hi ${user.first_name || ''},\n\nConfirm your email to finish creating your account:\n${url}\n\nIf you didn't sign up, ignore this email.`];
    await mail.send(user.email, subject, text);
  }
  async function useToken(token, kind) {
    if (typeof token !== 'string' || !token) throw bad('This link is invalid or has expired.');
    const row = await one(`delete from email_tokens where token_hash = $1 and kind = $2 returning user_id, expires_at > now() as valid`, [sha256(token), kind]);
    if (!row || !row.valid) throw bad('This link is invalid or has expired.');
    return row.user_id;
  }

  // ---------- routes ----------
  const routes = [];
  const on = (method, pattern, fn) => routes.push({ method, re: new RegExp('^' + pattern.replace(/:(\w+)/g, '(?<$1>[^/]+)') + '$'), fn });

  on('GET', '/api/health', async () => ({ ok: true, email: !!mail, signup: allowSignup }));
  on('GET', '/api/me', async ({ me }) => ({ user: userOut(me) }));

  on('POST', '/api/auth/signup', async ({ body, res }) => {
    if (!allowSignup) throw deny('Sign-up is turned off. Ask an admin for an account.');
    const email = str(body.email, 254).toLowerCase();
    if (!EMAIL.test(email)) throw bad('Enter a valid email.');
    checkPassword(body.password);
    const first = str(body.firstName, 100), last = str(body.lastName, 100);
    const hash = await hashPassword(body.password);
    const u = await one(`insert into users (email, password_hash, first_name, last_name, email_confirmed)
      values ($1, $2, $3, $4, $5) on conflict (email) do nothing returning *`, [email, hash, first, last, !mail]);
    if (mail) {
      // Same reply whether or not the email was already registered.
      if (u) await emailLink(u, 'confirm');
      return { needsConfirmation: true };
    }
    if (!u) throw bad('That email already has an account. Sign in instead.');
    await startSession(res, u.id);
    return { user: userOut(u) };
  });

  on('POST', '/api/auth/signin', async ({ req, res, body }) => {
    const email = str(body.email, 254).toLowerCase();
    const key = throttleKey(req, email);
    checkThrottle(key);
    const u = await one(`select * from users where email = $1`, [email]);
    const ok = await verifyPassword(String(body.password ?? ''), u ? u.password_hash : DUMMY_HASH);
    if (!u || !ok) { noteFail(key); throw new HttpError(401, 'Wrong email or password.'); }
    if (!u.email_confirmed) throw deny('Confirm your email first: use the link we sent you.');
    fails.delete(key);
    await startSession(res, u.id);
    return { user: userOut(u) };
  });

  on('POST', '/api/auth/signout', async ({ req, res }) => {
    const t = readCookie(req);
    if (t) await q(`delete from sessions where token_hash = $1`, [sha256(t)]);
    setCookie(res, '', 0);
    return { ok: true };
  });

  on('POST', '/api/auth/confirm', async ({ body, res }) => {
    const userId = await useToken(body.token, 'confirm');
    const u = await one(`update users set email_confirmed = true where id = $1 returning *`, [userId]);
    await startSession(res, u.id);
    return { user: userOut(u) };
  });

  on('POST', '/api/auth/forgot', async ({ body }) => {
    if (!mail) throw bad("Email isn't set up on this server. Ask an admin to reset your password.");
    const u = await one(`select * from users where email = $1`, [str(body.email, 254).toLowerCase()]);
    if (u) await emailLink(u, 'reset');
    return { ok: true };   // same reply either way
  });

  on('POST', '/api/auth/reset', async ({ body, res }) => {
    checkPassword(body.password);
    const userId = await useToken(body.token, 'reset');
    const u = await one(`update users set password_hash = $2, email_confirmed = true where id = $1 returning *`, [userId, await hashPassword(body.password)]);
    await q(`delete from sessions where user_id = $1`, [userId]);
    await startSession(res, u.id);
    return { user: userOut(u) };
  });

  on('POST', '/api/me/password', async ({ me, req, body }) => {
    needUser(me);
    if (!(await verifyPassword(String(body.current ?? ''), me.password_hash))) throw bad('Current password is wrong.');
    checkPassword(body.password);
    await q(`update users set password_hash = $2 where id = $1`, [me.id, await hashPassword(body.password)]);
    await q(`delete from sessions where user_id = $1 and token_hash <> $2`, [me.id, sha256(readCookie(req))]);
    return { ok: true };
  });

  on('PATCH', '/api/me', async ({ me, body }) => {
    needUser(me);
    await q(`update users set first_name = $2, last_name = $3 where id = $1`, [me.id, str(body.firstName, 100), str(body.lastName, 100)]);
    return { ok: true };
  });

  // households
  on('GET', '/api/households', async ({ me }) => {
    needUser(me);
    const rows = await q(`select h.id, h.name, h.owner_id, h.updated_at, u.first_name, u.last_name, u.email
      from households h left join users u on u.id = h.owner_id where ${VISIBLE} order by h.updated_at desc`, [me.role, me.id]);
    return rows.map(r => ({ id: r.id, name: r.name, ownerId: r.owner_id, updatedAt: r.updated_at,
      ownerName: `${r.first_name || ''} ${r.last_name || ''}`.trim() || r.email || '' }));
  });

  on('POST', '/api/households', async ({ me, body }) => {
    needUser(me);
    const data = body.data && typeof body.data === 'object' ? body.data : {};
    const h = await one(`insert into households (owner_id, name, data, updated_by) values ($1, $2, $3::jsonb, $1) returning id`,
      [me.id, str(body.name) || 'My household', JSON.stringify(data)]);
    await q(`insert into audit_log (household_id, user_id, action) values ($1, $2, 'insert')`, [h.id, me.id]);
    return { id: h.id };
  });

  on('GET', '/api/households/:id', async ({ me, params }) => {
    needUser(me);
    await mustAccess(me, params.id);
    const r = await one(`select id, name, owner_id, data, updated_at from households where id = $1`, [params.id]);
    return { id: r.id, name: r.name, ownerId: r.owner_id, data: r.data, updatedAt: r.updated_at };
  });

  on('PUT', '/api/households/:id', async ({ me, params, body }) => {
    needUser(me);
    await mustAccess(me, params.id);
    if (!body.data || typeof body.data !== 'object') throw bad('Missing plan data.');
    await q(`with u as (update households set name = $3, data = $4::jsonb, updated_at = now(), updated_by = $2 where id = $1 returning id)
      insert into audit_log (household_id, user_id, action) select id, $2, 'update' from u`,
      [params.id, me.id, str(body.name) || 'My household', JSON.stringify(body.data)]);
    return { ok: true };
  });

  on('DELETE', '/api/households/:id', async ({ me, params }) => {
    needAdmin(me);
    if (!UUID.test(params.id)) throw notFound();
    await q(`delete from households where id = $1`, [params.id]);
    return { ok: true };
  });

  on('GET', '/api/households/:id/audit', async ({ me, params }) => {
    needUser(me);
    await mustAccess(me, params.id);
    return (await q(`select user_id, action, at from audit_log where household_id = $1 order by at desc limit 200`, [params.id]))
      .map(r => ({ userId: r.user_id, action: r.action, at: r.at }));
  });

  on('PUT', '/api/households/:id/advisor', async ({ me, params, body }) => {
    needAdmin(me);
    if (!UUID.test(params.id)) throw notFound();
    const advisorId = body.advisorId || null;
    if (advisorId) {
      const a = UUID.test(advisorId) && await one(`select id from users where id = $1 and role = 'advisor'`, [advisorId]);
      if (!a) throw bad('That user is not an advisor.');
    }
    await q(`delete from advisor_assignments where household_id = $1`, [params.id]);
    if (advisorId) await q(`insert into advisor_assignments (advisor_id, household_id) values ($1, $2)`, [advisorId, params.id]);
    return { ok: true };
  });

  on('GET', '/api/assignments', async ({ me }) => {
    needUser(me);
    const rows = me.role === 'admin'
      ? await q(`select advisor_id, household_id from advisor_assignments`)
      : await q(`select advisor_id, household_id from advisor_assignments where advisor_id = $1`, [me.id]);
    return rows.map(a => ({ advisorId: a.advisor_id, householdId: a.household_id }));
  });

  // users
  on('GET', '/api/users', async ({ me }) => {
    needUser(me);
    const rows = me.role === 'admin'
      ? await q(`select * from users order by email`)
      : await q(`select * from users u where u.id = $1 or ($2 = 'advisor' and exists (
          select 1 from households h join advisor_assignments a on a.household_id = h.id
          where h.owner_id = u.id and a.advisor_id = $1)) order by email`, [me.id, me.role]);
    return rows.map(userOut);
  });

  on('POST', '/api/users', async ({ me, body }) => {
    needAdmin(me);
    const email = str(body.email, 254).toLowerCase();
    if (!EMAIL.test(email)) throw bad('Enter a valid email.');
    checkPassword(body.password);
    const role = ROLES.includes(body.role) ? body.role : 'client';
    const u = await one(`insert into users (email, password_hash, first_name, last_name, role, email_confirmed)
      values ($1, $2, $3, $4, $5, true) on conflict (email) do nothing returning *`,
      [email, await hashPassword(body.password), str(body.firstName, 100), str(body.lastName, 100), role]);
    if (!u) throw bad('That email already has an account.');
    return { user: userOut(u) };
  });

  on('PATCH', '/api/users/:id', async ({ me, params, body }) => {
    needAdmin(me);
    if (!UUID.test(params.id)) throw notFound();
    if (!ROLES.includes(body.role)) throw bad('Unknown role.');
    if (params.id === me.id) throw deny("You can't change your own role.");
    const u = await one(`update users set role = $2 where id = $1 returning id`, [params.id, body.role]);
    if (!u) throw notFound();
    return { ok: true };
  });

  on('POST', '/api/users/:id/password', async ({ me, params, body }) => {
    needAdmin(me);
    if (!UUID.test(params.id)) throw notFound();
    checkPassword(body.password);
    const u = await one(`update users set password_hash = $2, email_confirmed = true where id = $1 returning id`, [params.id, await hashPassword(body.password)]);
    if (!u) throw notFound();
    await q(`delete from sessions where user_id = $1`, [params.id]);
    return { ok: true };
  });

  // ---------- request handling ----------
  const SECURITY_HEADERS = {
    'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'no-referrer',
  };
  function send(res, status, obj) {
    const body = JSON.stringify(obj);
    res.writeHead(status, { ...SECURITY_HEADERS, 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(body);
  }
  function readBody(req) {
    return new Promise((resolve, reject) => {
      let size = 0; const chunks = [];
      req.on('data', c => { size += c.length; if (size > MAX_BODY) { reject(new HttpError(413, 'Too much data.')); req.destroy(); } else chunks.push(c); });
      req.on('end', () => {
        if (!chunks.length) return resolve({});
        try { const v = JSON.parse(Buffer.concat(chunks).toString('utf8')); resolve(v && typeof v === 'object' ? v : {}); }
        catch (e) { reject(bad('Invalid JSON.')); }
      });
      req.on('error', reject);
    });
  }

  const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };
  async function serveStatic(req, res, pathname) {
    if (!staticRoot || !['GET', 'HEAD'].includes(req.method)) return false;
    if (pathname === '/') pathname = '/index.html';
    if (!(pathname === '/index.html' || /^\/(css|js|vendor)\/[\w.\-/]+$/.test(pathname)) || pathname.includes('..')) return false;
    const file = path.join(staticRoot, pathname);
    if (!file.startsWith(path.resolve(staticRoot) + path.sep)) return false;
    const type = TYPES[path.extname(file)];
    if (!type) return false;
    try { if (!(await stat(file)).isFile()) return false; } catch { return false; }
    const buf = await readFile(file);
    res.writeHead(200, { ...SECURITY_HEADERS, 'Content-Type': type, 'Cache-Control': 'no-cache' });
    res.end(req.method === 'HEAD' ? undefined : buf);
    return true;
  }

  return async function handle(req, res) {
    const { pathname } = new URL(req.url, 'http://x');
    try {
      if (!pathname.startsWith('/api/')) {
        if (await serveStatic(req, res, pathname)) return;
        res.writeHead(404, { ...SECURITY_HEADERS, 'Content-Type': 'text/plain' }); return res.end('Not found');
      }
      // Changes need a custom header: browsers won't send it from another site without CORS, which we never allow.
      if (req.method !== 'GET' && req.headers['x-fimoksha'] !== '1') throw deny('Missing request header.');
      let match = null;
      const route = routes.find(r => r.method === req.method && (match = pathname.match(r.re)));
      if (!route) throw notFound();
      const body = req.method === 'GET' ? {} : await readBody(req);
      const me = await currentUser(req);
      const out = await route.fn({ req, res, body, me, params: match.groups || {} });
      send(res, 200, out);
    } catch (e) {
      if (e instanceof HttpError) return send(res, e.status, { error: e.message });
      console.error(e);
      send(res, 500, { error: 'Something went wrong on the server.' });
    }
  };
}
