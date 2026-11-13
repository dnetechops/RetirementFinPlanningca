// FiMoksha server. Settings come from environment variables (or a .env file next to package.json):
//   DATABASE_URL   postgres://user:password@localhost:5432/fimoksha   (required)
//   PORT           default 8080
//   PUBLIC_URL     address people use to open the app, e.g. https://plan.example.ca (needed for email links)
//   ALLOW_SIGNUP   "false" to let only admins create accounts (default true)
//   COOKIE_SECURE  "true" when served over HTTPS (default: true if PUBLIC_URL starts with https)
//   SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM, SMTP_SECURE   optional; leave SMTP_HOST blank for no email
//
// Commands:
//   node server/server.mjs                        start the server
//   node server/server.mjs create-admin EMAIL PASSWORD [FIRST] [LAST]   create or promote an admin
import http from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import pg from 'pg';
import { createApp, hashPassword } from './api.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// Minimal .env loader (KEY=value lines); real environment variables win.
const envFile = path.join(root, '.env');
if (existsSync(envFile)) {
  for (const line of readFileSync(envFile, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2');
  }
}
const env = process.env;
if (!env.DATABASE_URL) { console.error('Set DATABASE_URL, e.g. postgres://fimoksha:secret@localhost:5432/fimoksha'); process.exit(1); }

const pool = new pg.Pool({ connectionString: env.DATABASE_URL });
const db = { query: (sql, params) => pool.query(sql, params) };
await pool.query(readFileSync(path.join(root, 'server', 'schema.sql'), 'utf8'));

if (process.argv[2] === 'create-admin') {
  const [, , , email, password, first = '', last = ''] = process.argv;
  if (!email || !password || password.length < 8) { console.error('Usage: create-admin EMAIL PASSWORD(8+ chars) [FIRST] [LAST]'); process.exit(1); }
  await pool.query(`insert into users (email, password_hash, first_name, last_name, role, email_confirmed)
    values (lower($1), $2, $3, $4, 'admin', true)
    on conflict (email) do update set role = 'admin', password_hash = excluded.password_hash, email_confirmed = true`,
    [email.trim(), await hashPassword(password), first, last]);
  console.log(`${email} is now an admin.`);
  await pool.end();
  process.exit(0);
}

let mail = null;
if (env.SMTP_HOST) {
  const { default: nodemailer } = await import('nodemailer');
  const port = Number(env.SMTP_PORT || 587);
  const transport = nodemailer.createTransport({
    host: env.SMTP_HOST, port,
    secure: env.SMTP_SECURE ? env.SMTP_SECURE === 'true' : port === 465,
    auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASS } : undefined,
  });
  mail = { send: (to, subject, text) => transport.sendMail({ from: env.SMTP_FROM || env.SMTP_USER, to, subject, text }) };
  if (!env.PUBLIC_URL) { console.error('Set PUBLIC_URL when email is on, so links in emails point to the right address.'); process.exit(1); }
}

const publicUrl = env.PUBLIC_URL || '';
const app = createApp({
  db, mail, publicUrl,
  allowSignup: env.ALLOW_SIGNUP !== 'false',
  secureCookies: env.COOKIE_SECURE ? env.COOKIE_SECURE === 'true' : publicUrl.startsWith('https://'),
  staticRoot: root,
});
const port = Number(env.PORT || 8080);
http.createServer(app).listen(port, () => {
  console.log(`FiMoksha running at http://localhost:${port}  (email ${mail ? 'on' : 'off'}, sign-up ${env.ALLOW_SIGNUP === 'false' ? 'off' : 'on'})`);
});
