-- FRIDAY Visual Engine - core tables

create extension if not exists "pgcrypto";

-- Saved generated systems (shareable)
create table if not exists public.systems (
  id uuid primary key default gen_random_uuid(),
  system_name text not null,
  description text default '',
  share_hash text not null unique,
  data jsonb not null,
  ip_hash text,
  user_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists systems_share_hash_idx on public.systems (share_hash);
create index if not exists systems_created_at_idx on public.systems (created_at desc);
create index if not exists systems_user_id_idx on public.systems (user_id);

-- Row-level security
alter table public.systems enable row level security;

-- Public can read any system by share_hash (read-only)
drop policy if exists systems_public_read on public.systems;
create policy systems_public_read
  on public.systems
  for select
  using (true);

-- Only authenticated users can insert (or service_role for anonymous saves)
drop policy if exists systems_user_insert on public.systems;
create policy systems_user_insert
  on public.systems
  for insert
  with check (auth.uid() = user_id or user_id is null);

-- Users can delete their own systems
drop policy if exists systems_user_delete on public.systems;
create policy systems_user_delete
  on public.systems
  for delete
  using (auth.uid() = user_id);
