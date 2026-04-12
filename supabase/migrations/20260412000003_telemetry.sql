-- Anonymous usage telemetry (optional)

create table if not exists public.telemetry (
  id bigserial primary key,
  event text not null,
  props jsonb default '{}'::jsonb,
  ip_hash text,
  created_at timestamptz not null default now()
);

create index if not exists telemetry_event_idx on public.telemetry (event, created_at desc);

alter table public.telemetry enable row level security;

drop policy if exists telemetry_no_public on public.telemetry;
create policy telemetry_no_public
  on public.telemetry
  for all
  to anon, authenticated
  using (false);
