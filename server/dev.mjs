// Local try-out without installing PostgreSQL: runs the same server on PGlite (PostgreSQL compiled to
// WebAssembly), keeping data in ./.devdb. For development only; production uses server.mjs + real PostgreSQL.
//   npm run dev            then open http://localhost:8765
// A dev admin is created on first run: admin@local.test with the password in DEV_ADMIN_PASSWORD
// (default "admin-dev-pass").
import http from 'node:http';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { createApp, hashPassword } from './api.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pgl = new PGlite(path.join(root, '.devdb'));
await pgl.exec(readFileSync(path.join(root, 'server', 'schema.sql'), 'utf8'));
const db = { query: (sql, params) => pgl.query(sql, params) };

const pw = process.env.DEV_ADMIN_PASSWORD || 'admin-dev-pass';
await db.query(`insert into users (email, password_hash, first_name, last_name, role, email_confirmed)
  values ('admin@local.test', $1, 'Dev', 'Admin', 'admin', true) on conflict (email) do nothing`, [await hashPassword(pw)]);

// Emails are printed here instead of sent.
const mail = process.env.DEV_EMAIL === 'true'
  ? { send: async (to, subject, text) => console.log(`\n--- email to ${to}: ${subject}\n${text}\n---`) } : null;

const port = Number(process.env.PORT || 8765);
http.createServer(createApp({ db, mail, publicUrl: `http://localhost:${port}`, staticRoot: root })).listen(port, () =>
  console.log(`FiMoksha dev server at http://localhost:${port}  (admin@local.test, data in .devdb, email ${mail ? 'printed here' : 'off'})`));
