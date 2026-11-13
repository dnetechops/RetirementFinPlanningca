-- FiMoksha database schema (PostgreSQL 13+). Safe to run repeatedly: the server runs it on start.
-- Access rules (who sees which household) are enforced by the server in server/api.mjs.

create table if not exists users (
  id             uuid primary key default gen_random_uuid(),
  email          text not null unique,            -- stored lower-case
  password_hash  text not null,
  first_name     text not null default '',
  last_name      text not null default '',
  role           text not null default 'client' check (role in ('client', 'advisor', 'admin')),
  email_confirmed boolean not null default false,
  created_at     timestamptz not null default now()
);

-- Signed-in sessions. Only a hash of the cookie value is stored.
create table if not exists sessions (
  token_hash  text primary key,
  user_id     uuid not null references users (id) on delete cascade,
  expires_at  timestamptz not null,
  created_at  timestamptz not null default now()
);
create index if not exists sessions_user_idx on sessions (user_id);

-- One-time links sent by email: confirm an account, reset a password.
create table if not exists email_tokens (
  token_hash  text primary key,
  user_id     uuid not null references users (id) on delete cascade,
  kind        text not null check (kind in ('confirm', 'reset')),
  expires_at  timestamptz not null
);

-- A household holds the whole financial plan as one JSON document.
create table if not exists households (
  id          uuid primary key default gen_random_uuid(),
  owner_id    uuid references users (id) on delete set null,
  name        text not null default 'My household',
  data        jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  updated_by  uuid references users (id) on delete set null
);
create index if not exists households_owner_idx on households (owner_id);

create table if not exists advisor_assignments (
  advisor_id    uuid not null references users (id) on delete cascade,
  household_id  uuid not null references households (id) on delete cascade,
  created_at    timestamptz not null default now(),
  primary key (advisor_id, household_id)
);
create index if not exists advisor_assignments_household_idx on advisor_assignments (household_id);

create table if not exists audit_log (
  id            bigint generated always as identity primary key,
  household_id  uuid references households (id) on delete cascade,
  user_id       uuid,
  action        text not null,
  at            timestamptz not null default now()
);
create index if not exists audit_log_household_idx on audit_log (household_id, at desc);
