-- ─────────────────────────────────────────────────────────────────────────────
-- expo-autoeq-engine — Supabase schema
--
-- Run this in your Supabase SQL editor (Dashboard → SQL Editor → New query).
-- Tables:
--   profiles      — Pro status + eq_minutes_remaining per user
--   eq_usage      — Audit log of every minute deducted
--   eq_presets    — User-saved 31-band and biquad presets
-- Functions:
--   deduct_eq_minutes(p_minutes) → boolean  (atomic deduction + audit insert)
--   add_eq_minutes(p_minutes)    → void     (top-up after purchase)
-- ─────────────────────────────────────────────────────────────────────────────

-- ── Enable UUID extension ─────────────────────────────────────────────────────
create extension if not exists "uuid-ossp";

-- ── profiles ──────────────────────────────────────────────────────────────────
-- One row per user. Created automatically via the trigger below on auth.users insert.
create table if not exists profiles (
  id                   uuid primary key references auth.users(id) on delete cascade,
  is_pro               boolean      not null default false,
  pro_ends_at          timestamptz           default null,
  eq_minutes_remaining int          not null default 0 check (eq_minutes_remaining >= 0),
  created_at           timestamptz  not null default now()
);

-- Auto-create a profile row whenever a new user signs up
create or replace function handle_new_user()
  returns trigger as $$
begin
  insert into public.profiles (id)
    values (new.id)
    on conflict (id) do nothing;
  return new;
end;
$$ language plpgsql security definer;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure handle_new_user();

-- ── eq_usage ──────────────────────────────────────────────────────────────────
-- Audit log — one row per EQ session (per track / per claim call).
create table if not exists eq_usage (
  id                      uuid        primary key default uuid_generate_v4(),
  user_id                 uuid        not null references profiles(id) on delete cascade,
  session_started         timestamptz not null default now(),
  session_duration_seconds int        not null default 0 check (session_duration_seconds >= 0),
  minutes_used            int         not null default 0 check (minutes_used >= 0),
  created_at              timestamptz not null default now()
);

-- ── eq_presets ────────────────────────────────────────────────────────────────
-- User-saved EQ curves. null user_id = global / shared preset (future feature).
create table if not exists eq_presets (
  id              uuid        primary key default uuid_generate_v4(),
  user_id         uuid        references auth.users(id) on delete cascade,
  name            text        not null,
  type            text        not null check (type in ('graphic_31band', 'biquad')),
  gains_31        float[]             default null,  -- 31 elements for graphic_31band
  biquad_filters  jsonb               default null,  -- array of {type,fc,q,gainDb,bandIndex}
  created_at      timestamptz not null default now(),
  -- Enforce that gains_31 is set for graphic presets, biquad_filters for biquad
  constraint gains_xor_biquad check (
    (type = 'graphic_31band' and gains_31 is not null and biquad_filters is null) or
    (type = 'biquad' and biquad_filters is not null and gains_31 is null)
  )
);

-- ── RLS ───────────────────────────────────────────────────────────────────────
alter table profiles   enable row level security;
alter table eq_usage   enable row level security;
alter table eq_presets enable row level security;

-- profiles: users can only read/update their own row
create policy "profiles_select_own" on profiles
  for select using (auth.uid() = id);

create policy "profiles_update_own" on profiles
  for update using (auth.uid() = id);

-- eq_usage: users can only read their own usage (inserts happen via security definer RPC)
create policy "eq_usage_select_own" on eq_usage
  for select using (auth.uid() = user_id);

-- eq_presets: users can CRUD their own presets
create policy "eq_presets_select_own" on eq_presets
  for select using (auth.uid() = user_id or user_id is null);

create policy "eq_presets_insert_own" on eq_presets
  for insert with check (auth.uid() = user_id);

create policy "eq_presets_update_own" on eq_presets
  for update using (auth.uid() = user_id);

create policy "eq_presets_delete_own" on eq_presets
  for delete using (auth.uid() = user_id);

-- ── deduct_eq_minutes ─────────────────────────────────────────────────────────
-- Atomically deducts minutes from the current user's balance and logs the usage.
-- Returns true on success, false if the user has insufficient minutes.
-- security definer so it can write eq_usage without exposing the table to direct insert.
create or replace function deduct_eq_minutes(p_minutes int)
  returns boolean
  language plpgsql
  security definer
  set search_path = public
as $$
declare
  v_deducted boolean;
begin
  -- Attempt the deduction in one atomic update
  update profiles
    set eq_minutes_remaining = eq_minutes_remaining - p_minutes
    where id = auth.uid()
      and eq_minutes_remaining >= p_minutes;

  v_deducted := found;

  if v_deducted then
    -- Log the usage for auditing / revenue-share reporting
    insert into eq_usage (user_id, session_duration_seconds, minutes_used)
      values (auth.uid(), p_minutes * 60, p_minutes);
  end if;

  return v_deducted;
end;
$$;

-- ── add_eq_minutes ────────────────────────────────────────────────────────────
-- Top-up a user's EQ minute balance after a successful purchase.
-- Call this from your backend / Stripe webhook — not directly from the client.
create or replace function add_eq_minutes(p_minutes int)
  returns void
  language plpgsql
  security definer
  set search_path = public
as $$
begin
  update profiles
    set eq_minutes_remaining = eq_minutes_remaining + p_minutes
    where id = auth.uid();
end;
$$;

-- ── Seed: example global presets (optional) ───────────────────────────────────
-- These are visible to all users (user_id is null).
-- Remove this block if you only want user-specific presets.
insert into eq_presets (user_id, name, type, gains_31) values
  (null, 'Harman', 'graphic_31band', array[
    4.0, 3.5, 3.0, 2.5, 2.0, 1.5, 1.0, 0.5, 0.0, -0.5,
    -1.0, -1.0, -1.0, -0.5, 0.0, 0.5, 1.0, 1.5, 2.0, 2.5,
    3.0, 3.5, 4.0, 4.0, 3.5, 3.0, 2.0, 1.0, 0.0, -1.0, -2.0
  ]::float[]),
  (null, 'Bass Boost', 'graphic_31band', array[
    6.0, 6.0, 5.5, 5.0, 4.5, 4.0, 3.5, 3.0, 2.0, 1.0,
    0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0,
    0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0
  ]::float[])
on conflict do nothing;
