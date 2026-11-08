-- FiMoksha: users, roles, households and access rules.
-- Run in the Supabase SQL editor (or `supabase db push`).
-- Every table has Row-Level Security: clients see their own household,
-- advisors see households assigned to them, admins see everything.

create type public.app_role as enum ('client', 'advisor', 'admin');

-- One row per signed-up user (created automatically on sign-up).
create table public.profiles (
  id          uuid primary key references auth.users (id) on delete cascade,
  email       text,
  first_name  text,
  last_name   text,
  role        public.app_role not null default 'client',
  created_at  timestamptz not null default now()
);

-- A household holds the whole financial plan as one JSON document
-- (people, accounts, assets, liabilities, budget, goals, scenarios).
create table public.households (
  id          uuid primary key default gen_random_uuid(),
  owner_id    uuid references public.profiles (id) on delete set null,
  name        text not null default 'My household',
  data        jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  updated_by  uuid references public.profiles (id) on delete set null
);
create index households_owner_idx on public.households (owner_id);

create table public.advisor_assignments (
  advisor_id    uuid not null references public.profiles (id) on delete cascade,
  household_id  uuid not null references public.households (id) on delete cascade,
  created_at    timestamptz not null default now(),
  primary key (advisor_id, household_id)
);
create index advisor_assignments_household_idx on public.advisor_assignments (household_id);

create table public.audit_log (
  id            bigint generated always as identity primary key,
  household_id  uuid references public.households (id) on delete cascade,
  user_id       uuid,
  action        text not null,
  at            timestamptz not null default now()
);
create index audit_log_household_idx on public.audit_log (household_id, at desc);

-- ---------- helper functions (security definer avoids RLS recursion) ----------

create function public.my_role() returns public.app_role
language sql stable security definer set search_path = public as $$
  select role from public.profiles where id = auth.uid()
$$;

create function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(public.my_role() = 'admin', false)
$$;

create function public.can_access_household(h uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_admin()
      or exists (select 1 from public.households where id = h and owner_id = auth.uid())
      or exists (select 1 from public.advisor_assignments a
                 join public.profiles p on p.id = a.advisor_id and p.role = 'advisor'
                 where a.household_id = h and a.advisor_id = auth.uid())
$$;

-- ---------- triggers ----------

-- New auth user -> profile row (role always starts as client).
create function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email, first_name, last_name)
  values (new.id, new.email,
          new.raw_user_meta_data ->> 'first_name',
          new.raw_user_meta_data ->> 'last_name');
  return new;
end $$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Only admins may change roles (blocks clients promoting themselves).
-- Changes made in the SQL editor (no signed-in user) are allowed, to create the first admin.
create function public.guard_role_change() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.role is distinct from old.role and auth.uid() is not null and not public.is_admin() then
    raise exception 'Only an admin can change roles';
  end if;
  return new;
end $$;

create trigger profiles_guard_role
  before update on public.profiles
  for each row execute function public.guard_role_change();

-- Stamp who/when on every household save (only admins can change the owner), and keep an audit trail.
create function public.touch_household() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'UPDATE' and new.owner_id is distinct from old.owner_id
     and auth.uid() is not null and not public.is_admin() then
    raise exception 'Only an admin can change a household''s owner';
  end if;
  new.updated_at := now();
  new.updated_by := auth.uid();
  return new;
end $$;

create trigger households_touch
  before insert or update on public.households
  for each row execute function public.touch_household();

create function public.audit_household() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.audit_log (household_id, user_id, action)
  values (coalesce(new.id, old.id), auth.uid(), lower(tg_op));
  return coalesce(new, old);
end $$;

create trigger households_audit
  after insert or update on public.households
  for each row execute function public.audit_household();

-- ---------- Row-Level Security ----------

alter table public.profiles            enable row level security;
alter table public.households          enable row level security;
alter table public.advisor_assignments enable row level security;
alter table public.audit_log           enable row level security;

-- profiles: see yourself; admins see all; advisors see the owners of their households.
create policy profiles_select on public.profiles for select using (
  id = auth.uid()
  or public.is_admin()
  or exists (select 1 from public.households h
             join public.advisor_assignments a on a.household_id = h.id
             where h.owner_id = profiles.id and a.advisor_id = auth.uid())
);
create policy profiles_update on public.profiles for update
  using (id = auth.uid() or public.is_admin())
  with check (id = auth.uid() or public.is_admin());

-- households
-- (owner check is inline so a just-inserted row is readable in the same statement)
create policy households_select on public.households for select
  using (owner_id = auth.uid() or public.can_access_household(id));
create policy households_insert on public.households for insert
  with check (owner_id = auth.uid() or public.is_admin());
create policy households_update on public.households for update
  using (owner_id = auth.uid() or public.can_access_household(id))
  with check (owner_id = auth.uid() or public.can_access_household(id));
create policy households_delete on public.households for delete
  using (public.is_admin());

-- advisor assignments: managed by admins, visible to the advisor
create policy assignments_select on public.advisor_assignments for select
  using (advisor_id = auth.uid() or public.is_admin());
create policy assignments_admin_insert on public.advisor_assignments for insert
  with check (public.is_admin());
create policy assignments_admin_delete on public.advisor_assignments for delete
  using (public.is_admin());

-- audit log: read-only for people who can see the household (written by trigger)
create policy audit_select on public.audit_log for select
  using (public.can_access_household(household_id));

-- First admin: after you sign up in the app, run once in the SQL editor:
--   update public.profiles set role = 'admin' where email = 'you@example.com';
