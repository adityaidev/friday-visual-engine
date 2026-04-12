-- Rate limiting counters (per IP + endpoint)

create table if not exists public.rate_limits (
  ip text not null,
  endpoint text not null,
  count integer not null default 0,
  window_start timestamptz not null default now(),
  primary key (ip, endpoint)
);

create index if not exists rate_limits_window_idx on public.rate_limits (window_start);

-- Atomic increment-and-check RPC. Resets the counter if window expired.
create or replace function public.rate_limit_hit(
  p_ip text,
  p_endpoint text,
  p_window_ms bigint,
  p_max integer
) returns table (count integer, window_start timestamptz)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_now timestamptz := now();
  v_threshold timestamptz := v_now - (p_window_ms * interval '1 millisecond');
  v_row record;
begin
  insert into public.rate_limits (ip, endpoint, count, window_start)
  values (p_ip, p_endpoint, 1, v_now)
  on conflict (ip, endpoint) do update
    set count = case
          when public.rate_limits.window_start < v_threshold then 1
          else public.rate_limits.count + 1
        end,
        window_start = case
          when public.rate_limits.window_start < v_threshold then v_now
          else public.rate_limits.window_start
        end
  returning public.rate_limits.count, public.rate_limits.window_start into v_row;

  count := v_row.count;
  window_start := v_row.window_start;
  return next;
end;
$$;

-- Lock down the table (only service_role via RPC)
alter table public.rate_limits enable row level security;

drop policy if exists rate_limits_no_public on public.rate_limits;
create policy rate_limits_no_public
  on public.rate_limits
  for all
  to anon, authenticated
  using (false);

-- Periodic cleanup of stale rows (run via pg_cron in dashboard if desired)
create or replace function public.rate_limits_gc(p_older_than_hours integer default 48)
returns integer
language sql
security definer
set search_path = public
as $$
  delete from public.rate_limits
  where window_start < now() - (p_older_than_hours * interval '1 hour')
  returning 1;
$$;
