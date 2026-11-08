// Tests the database access rules with PGlite (Postgres in-process) and a stub of Supabase auth.
// Run: npm install && npm test
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'fs';

const migration = readFileSync(new URL('../supabase/migrations/0001_init.sql', import.meta.url), 'utf8');
const db = new PGlite();

await db.exec(`
  create schema auth;
  create table auth.users (id uuid primary key, email text, raw_user_meta_data jsonb default '{}');
  create function auth.uid() returns uuid language sql stable as
    $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  create role authenticated;
`);
await db.exec(migration);
await db.exec(`
  grant usage on schema public to authenticated;
  grant select, insert, update, delete on all tables in schema public to authenticated;
  grant execute on all functions in schema public to authenticated;
  grant usage on schema auth to authenticated;
  grant execute on function auth.uid() to authenticated;
`);

const U = {
  admin: '00000000-0000-0000-0000-00000000000a',
  advisor: '00000000-0000-0000-0000-00000000000b',
  c1: '00000000-0000-0000-0000-0000000000c1',
  c2: '00000000-0000-0000-0000-0000000000c2',
};
for (const [k, id] of Object.entries(U)) {
  await db.query(`insert into auth.users (id, email, raw_user_meta_data) values ($1, $2, $3)`, [id, k + '@test.ca', { first_name: k }]);
}
// First admin + advisor set from the SQL editor (no signed-in user)
await db.exec(`update public.profiles set role = 'admin' where email = 'admin@test.ca';
               update public.profiles set role = 'advisor' where email = 'advisor@test.ca';`);

let pass = 0, fail = 0;
const check = (name, cond) => { cond ? pass++ : fail++; console.log((cond ? 'PASS ' : 'FAIL ') + name); };

async function as(user, fn) {
  await db.exec(`reset role; select set_config('request.jwt.claim.sub', '${user}', false); set role authenticated;`);
  try { return await fn(); } finally { await db.exec(`reset role; select set_config('request.jwt.claim.sub', '', false);`); }
}
const tryq = async (sql, params) => { try { return { r: await db.query(sql, params) }; } catch (e) { return { e: e.message }; } };

// Clients create their own households
const h1 = await as(U.c1, () => db.query(`insert into households (owner_id, name, data) values ($1, 'C1 home', '{"x":1}') returning id`, [U.c1]));
const h2 = await as(U.c2, () => db.query(`insert into households (owner_id, name) values ($1, 'C2 home') returning id`, [U.c2]));
const H1 = h1.rows[0].id, H2 = h2.rows[0].id;
check('profile auto-created with first name', (await db.query(`select first_name from profiles where id=$1`, [U.c1])).rows[0].first_name === 'c1');

await as(U.c1, async () => {
  check('client cannot create household for someone else', !!(await tryq(`insert into households (owner_id) values ($1)`, [U.c2])).e);
  const rows = (await db.query(`select id from households`)).rows;
  check('client sees only own household', rows.length === 1 && rows[0].id === H1);
  check('client cannot make self admin', !!(await tryq(`update profiles set role='admin' where id=$1`, [U.c1])).e);
  const up = await db.query(`update households set data='{"x":2}' where id=$1`, [H2]);
  check("client cannot edit another household", up.affectedRows === 0);
  check('client sees only own profile', (await db.query(`select id from profiles`)).rows.length === 1);
  check('client cannot assign advisors', !!(await tryq(`insert into advisor_assignments values ($1,$2)`, [U.advisor, H1])).e);
  check('client cannot give household away', !!(await tryq(`update households set owner_id=$1 where id=$2`, [U.c2, H1])).e);
  check('client cannot delete household', (await db.query(`delete from households where id=$1`, [H1])).affectedRows === 0);
});

await as(U.advisor, async () => {
  check('advisor sees nothing before assignment', (await db.query(`select id from households`)).rows.length === 0);
});
await as(U.admin, async () => {
  check('admin sees all households', (await db.query(`select id from households`)).rows.length === 2);
  check('admin assigns advisor', !(await tryq(`insert into advisor_assignments (advisor_id, household_id) values ($1,$2)`, [U.advisor, H1])).e);
  check('admin sees all profiles', (await db.query(`select id from profiles`)).rows.length === 4);
});
await as(U.advisor, async () => {
  const rows = (await db.query(`select id from households`)).rows;
  check('advisor sees only assigned household', rows.length === 1 && rows[0].id === H1);
  check('advisor edits assigned household', (await db.query(`update households set data='{"x":3}' where id=$1`, [H1])).affectedRows === 1);
  check('advisor cannot edit unassigned household', (await db.query(`update households set data='{"x":3}' where id=$1`, [H2])).affectedRows === 0);
  const prof = (await db.query(`select id from profiles order by id`)).rows.map(r => r.id);
  check('advisor sees self + assigned client profile only', prof.length === 2 && prof.includes(U.c1) && !prof.includes(U.c2));
  check('advisor cannot promote self to admin', !!(await tryq(`update profiles set role='admin' where id=$1`, [U.advisor])).e);
  check('advisor sees audit log of assigned household', (await db.query(`select * from audit_log where household_id=$1`, [H1])).rows.length >= 2);
});
await as(U.admin, async () => {
  check('admin changes a role', !(await tryq(`update profiles set role='advisor' where id=$1`, [U.c2])).e);
  await db.query(`update profiles set role='client' where id=$1`, [U.c2]);
});
const h = (await db.query(`select updated_by from households where id=$1`, [H1])).rows[0];
check('updated_by stamped with advisor', h.updated_by === U.advisor);
await as(U.c2, async () => {
  check('other client cannot read audit log', (await db.query(`select * from audit_log where household_id=$1`, [H1])).rows.length === 0);
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
