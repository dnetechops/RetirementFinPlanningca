// Tests the FiMoksha server's sign-in and access rules over real HTTP, with PGlite (PostgreSQL in-process).
// Run: npm install && npm test
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import http from 'node:http';
import { createApp, hashPassword } from '../server/api.mjs';

const pgl = new PGlite();
await pgl.exec(readFileSync(new URL('../server/schema.sql', import.meta.url), 'utf8'));
await pgl.exec(readFileSync(new URL('../server/schema.sql', import.meta.url), 'utf8'));   // re-running is safe
const db = { query: (sql, params) => pgl.query(sql, params) };

const sent = [];
function start(opts) {
  const server = http.createServer(createApp({ db, publicUrl: 'https://plan.test', staticRoot: new URL('..', import.meta.url).pathname.replace(/^\/(\w:)/, '$1'), ...opts }));
  return new Promise(r => server.listen(0, () => r({ server, base: `http://127.0.0.1:${server.address().port}` })));
}
const A = await start({});
const M = await start({ mail: { send: async (to, subject, text) => sent.push({ to, subject, text }) } });

let pass = 0, fail = 0;
const check = (name, cond) => { cond ? pass++ : fail++; console.log((cond ? 'PASS ' : 'FAIL ') + name); };

// A tiny browser: keeps its own session cookie.
function client(base = A.base) {
  let cookie = '';
  return async function call(method, url, body, headers = {}) {
    const r = await fetch(base + url, {
      method, body: body === undefined ? undefined : JSON.stringify(body),
      headers: { ...(method === 'GET' ? {} : { 'Content-Type': 'application/json', 'X-Fimoksha': '1' }), ...(cookie ? { Cookie: cookie } : {}), ...headers },
    });
    const sc = r.headers.get('set-cookie');
    if (sc) cookie = sc.split(';')[0].endsWith('=') ? '' : sc.split(';')[0];
    let data = null; try { data = await r.json(); } catch { /* not json */ }
    return { status: r.status, data, headers: r.headers };
  };
}

// First admin is made directly in the database (what `create-admin` does).
await db.query(`insert into users (email, password_hash, first_name, role, email_confirmed) values ('admin@test.ca', $1, 'Ada', 'admin', true)`, [await hashPassword('admin-pass-1')]);

const admin = client(), advisor = client(), c1 = client(), c2 = client(), anon = client();
check('health reports email off', (await anon('GET', '/api/health')).data.email === false);
check('not signed in: /api/me is empty', (await anon('GET', '/api/me')).data.user === null);
check('not signed in: households refused', (await anon('GET', '/api/households')).status === 401);

const s1 = await c1('POST', '/api/auth/signup', { email: 'C1@Test.ca', password: 'client-pass-1', firstName: 'Cee', lastName: 'One' });
check('sign-up without email signs straight in as client', s1.status === 200 && s1.data.user.role === 'client' && s1.data.user.email === 'c1@test.ca');
check('session cookie is HttpOnly', /HttpOnly/.test(s1.headers.get('set-cookie')));
await c2('POST', '/api/auth/signup', { email: 'c2@test.ca', password: 'client-pass-2', firstName: 'Cee', lastName: 'Two' });
check('duplicate email refused', (await anon('POST', '/api/auth/signup', { email: 'c1@test.ca', password: 'whatever-123' })).status === 400);
check('short password refused', (await anon('POST', '/api/auth/signup', { email: 'x@test.ca', password: 'short' })).status === 400);
check('sign-up ignores a requested role', (await anon('POST', '/api/auth/signup', { email: 'sneaky@test.ca', password: 'sneaky-pass', role: 'admin' })).data.user.role === 'client');

check('wrong password refused', (await advisor('POST', '/api/auth/signin', { email: 'admin@test.ca', password: 'nope-nope' })).status === 401);
check('admin signs in', (await admin('POST', '/api/auth/signin', { email: 'admin@test.ca', password: 'admin-pass-1' })).data.user.role === 'admin');
check('change without the custom header refused', (await admin('POST', '/api/users', { email: 'a@b.ca' }, { 'X-Fimoksha': '' })).status === 403);

// Admin creates an advisor account
const adv = await admin('POST', '/api/users', { email: 'advisor@test.ca', password: 'advisor-pass', firstName: 'Avery', role: 'advisor' });
check('admin creates an advisor', adv.data.user.role === 'advisor');
check('advisor signs in', (await advisor('POST', '/api/auth/signin', { email: 'advisor@test.ca', password: 'advisor-pass' })).status === 200);

// Households
const H1 = (await c1('POST', '/api/households', { name: 'C1 home', data: { x: 1 } })).data.id;
const H2 = (await c2('POST', '/api/households', { name: 'C2 home', data: { x: 1 } })).data.id;
const ids = r => r.data.map(h => h.id);
let r = await c1('GET', '/api/households');
check('client sees only own household', r.data.length === 1 && r.data[0].id === H1);
check("client can't open another household", (await c1('GET', '/api/households/' + H2)).status === 404);
check("client can't edit another household", (await c1('PUT', '/api/households/' + H2, { name: 'x', data: { x: 9 } })).status === 404);
check('client edits own household', (await c1('PUT', '/api/households/' + H1, { name: 'C1 home', data: { x: 2 } })).status === 200);
check('saved data comes back', (await c1('GET', '/api/households/' + H1)).data.data.x === 2);
check("client can't make self admin", (await c1('PATCH', '/api/users/' + s1.data.user.id, { role: 'admin' })).status === 403);
check('client sees only own profile', (await c1('GET', '/api/users')).data.length === 1);
check("client can't assign advisors", (await c1('PUT', `/api/households/${H1}/advisor`, { advisorId: adv.data.user.id })).status === 403);
check("client can't delete a household", (await c1('DELETE', '/api/households/' + H1)).status === 403);
check('bad id gives not found, not an error', (await c1('GET', '/api/households/not-a-uuid')).status === 404);

check('advisor sees nothing before assignment', (await advisor('GET', '/api/households')).data.length === 0);
r = await admin('GET', '/api/households');
check('admin sees all households with owner names', r.data.length === 2 && r.data.some(h => h.ownerName === 'Cee One'));
check("can't assign a non-advisor", (await admin('PUT', `/api/households/${H1}/advisor`, { advisorId: s1.data.user.id })).status === 400);
check('admin assigns advisor', (await admin('PUT', `/api/households/${H1}/advisor`, { advisorId: adv.data.user.id })).status === 200);
check('admin sees all users', (await admin('GET', '/api/users')).data.length === 5);

r = await advisor('GET', '/api/households');
check('advisor sees only assigned household', r.data.length === 1 && r.data[0].id === H1);
check('advisor edits assigned household', (await advisor('PUT', '/api/households/' + H1, { name: 'C1 home', data: { x: 3 } })).status === 200);
check("advisor can't edit unassigned household", (await advisor('PUT', '/api/households/' + H2, { name: 'x', data: {} })).status === 404);
const prof = (await advisor('GET', '/api/users')).data.map(u => u.email);
check('advisor sees self + assigned client only', prof.length === 2 && prof.includes('c1@test.ca') && !prof.includes('c2@test.ca'));
check("advisor can't promote self", (await advisor('PATCH', '/api/users/' + adv.data.user.id, { role: 'admin' })).status === 403);
const audit = (await advisor('GET', `/api/households/${H1}/audit`)).data;
check('audit log records who saved', audit.length >= 3 && audit[0].userId === adv.data.user.id);
check("other client can't read the audit log", (await c2('GET', `/api/households/${H1}/audit`)).status === 404);

check("admin can't change own role", (await admin('PATCH', '/api/users/' + (await admin('GET', '/api/me')).data.user.id, { role: 'client' })).status === 403);
check('admin changes a role', (await admin('PATCH', '/api/users/' + adv.data.user.id, { role: 'client' })).status === 200);
check('demoted advisor loses access at once', (await advisor('GET', '/api/households')).data.length === 0);

// Passwords
check('change password needs the current one', (await c1('POST', '/api/me/password', { current: 'wrong', password: 'client-pass-new' })).status === 400);
check('client changes own password', (await c1('POST', '/api/me/password', { current: 'client-pass-1', password: 'client-pass-new' })).status === 200);
check('new password works', (await anon('POST', '/api/auth/signin', { email: 'c1@test.ca', password: 'client-pass-new' })).status === 200);
await anon('POST', '/api/auth/signout');
check('admin sets a password', (await admin('POST', `/api/users/${s1.data.user.id}/password`, { password: 'set-by-admin' })).status === 200);
check("that signs the user out everywhere", (await c1('GET', '/api/households')).status === 401);
check('forgot password without email explains', (await anon('POST', '/api/auth/forgot', { email: 'c1@test.ca' })).status === 400);
await c2('POST', '/api/auth/signout');
check('signed out after sign-out', (await c2('GET', '/api/households')).status === 401);

// Throttling
const t = client();
for (let i = 0; i < 10; i++) await t('POST', '/api/auth/signin', { email: 'c2@test.ca', password: 'bad-' + i });
check('too many wrong passwords are throttled', (await t('POST', '/api/auth/signin', { email: 'c2@test.ca', password: 'client-pass-2' })).status === 429);

// Email on: confirmation and reset links
const m = client(M.base);
check('health reports email on', (await m('GET', '/api/health')).data.email === true);
check('sign-up with email waits for confirmation', (await m('POST', '/api/auth/signup', { email: 'mail@test.ca', password: 'mail-pass-1', firstName: 'Em' })).data.needsConfirmation === true);
check("can't sign in before confirming", (await m('POST', '/api/auth/signin', { email: 'mail@test.ca', password: 'mail-pass-1' })).status === 403);
const confirmTok = (sent.at(-1).text.match(/confirm=([\w-]+)/) || [])[1];
check('confirmation email has a link to PUBLIC_URL', sent.at(-1).to === 'mail@test.ca' && sent.at(-1).text.includes('https://plan.test/?confirm='));
check('confirm link signs in', (await m('POST', '/api/auth/confirm', { token: confirmTok })).data.user.email === 'mail@test.ca');
check('confirm link works only once', (await m('POST', '/api/auth/confirm', { token: confirmTok })).status === 400);
check('existing email gets the same sign-up reply', (await client(M.base)('POST', '/api/auth/signup', { email: 'c2@test.ca', password: 'whatever-12' })).data.needsConfirmation === true);
const before = sent.length;
check('forgot for unknown email gives the same reply', (await m('POST', '/api/auth/forgot', { email: 'nobody@test.ca' })).status === 200 && sent.length === before);
await m('POST', '/api/auth/forgot', { email: 'mail@test.ca' });
const resetTok = (sent.at(-1).text.match(/reset=([\w-]+)/) || [])[1];
const fresh = client(M.base);
check('reset link sets a new password and signs in', (await fresh('POST', '/api/auth/reset', { token: resetTok, password: 'mail-pass-2' })).status === 200);
check('old session ended by reset', (await m('GET', '/api/households')).status === 401);
check('reset link works only once', (await fresh('POST', '/api/auth/reset', { token: resetTok, password: 'mail-pass-3' })).status === 400);

// Static files
const page = await fetch(A.base + '/');
check('serves the app page with a strict CSP', page.status === 200 && /script-src 'self'/.test(page.headers.get('content-security-policy')));
check("won't serve files outside the app", (await fetch(A.base + '/server/schema.sql')).status === 404 && (await fetch(A.base + '/.env')).status === 404 && (await fetch(A.base + '/js/..%2f..%2fpackage.json')).status === 404);

A.server.close(); M.server.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
