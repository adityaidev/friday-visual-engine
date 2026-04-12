import { createClient } from '@supabase/supabase-js';

const LIMITS: Record<string, { max: number; windowSec: number }> = {
  analyze: { max: 10, windowSec: 3600 },
  diagnostics: { max: 20, windowSec: 3600 },
  chat: { max: 100, windowSec: 3600 },
  live_token: { max: 20, windowSec: 86400 },
  default: { max: 60, windowSec: 3600 },
};

function supabaseAdmin() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Supabase env vars missing');
  return createClient(url, key, { auth: { persistSession: false } });
}

export function clientIp(req: Request): string {
  return (
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    req.headers.get('x-real-ip') ||
    'unknown'
  );
}

export interface RateLimitResult {
  ok: boolean;
  remaining: number;
  resetMs: number;
  retryAfterMs?: number;
}

export async function checkRateLimit(ip: string, endpoint: string): Promise<RateLimitResult> {
  const cfg = LIMITS[endpoint] || LIMITS.default;
  const now = Date.now();
  const windowMs = cfg.windowSec * 1000;

  try {
    const sb = supabaseAdmin();
    const { data, error } = await sb.rpc('rate_limit_hit', {
      p_ip: ip,
      p_endpoint: endpoint,
      p_window_ms: windowMs,
      p_max: cfg.max,
    });
    if (error) {
      console.warn('rate_limit rpc error, failing open:', error.message);
      return { ok: true, remaining: cfg.max, resetMs: now + windowMs };
    }
    const row = Array.isArray(data) ? data[0] : data;
    const count = row?.count ?? 0;
    const windowStart = row?.window_start ? new Date(row.window_start).getTime() : now;
    const remaining = Math.max(0, cfg.max - count);
    const resetMs = windowStart + windowMs;
    return {
      ok: count <= cfg.max,
      remaining,
      resetMs,
      retryAfterMs: count > cfg.max ? Math.max(1000, resetMs - now) : undefined,
    };
  } catch (e) {
    console.warn('rate_limit fail-open:', (e as Error).message);
    return { ok: true, remaining: cfg.max, resetMs: now + windowMs };
  }
}

export function rateLimitHeaders(r: RateLimitResult): HeadersInit {
  const h: Record<string, string> = {
    'X-RateLimit-Remaining': String(r.remaining),
    'X-RateLimit-Reset': String(Math.floor(r.resetMs / 1000)),
  };
  if (r.retryAfterMs) h['Retry-After'] = String(Math.ceil(r.retryAfterMs / 1000));
  return h;
}
