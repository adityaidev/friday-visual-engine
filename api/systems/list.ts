import { createClient } from '@supabase/supabase-js';
import { handlePreflight, errorResponse } from '../_shared/cors';
import { checkRateLimit, clientIp, rateLimitHeaders } from '../_shared/ratelimit';

export const config = { runtime: 'edge' };

export default async function handler(req: Request): Promise<Response> {
  const origin = req.headers.get('origin');
  const pre = handlePreflight(req);
  if (pre) return pre;
  if (req.method !== 'GET') return errorResponse('METHOD_NOT_ALLOWED', 'GET only', 405, origin);

  const ip = clientIp(req);
  const rl = await checkRateLimit(ip, 'default');
  if (!rl.ok) {
    return errorResponse('RATE_LIMIT', 'List rate limit hit.', 429, origin, {
      retryAfterMs: rl.retryAfterMs,
    });
  }

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return errorResponse('UPSTREAM', 'DB not configured', 500, origin);

  try {
    const sb = createClient(url, key, { auth: { persistSession: false } });
    const { data, error } = await sb
      .from('systems')
      .select('id, system_name, share_hash, created_at')
      .order('created_at', { ascending: false })
      .limit(20);

    if (error) return errorResponse('UPSTREAM', error.message, 502, origin);

    return new Response(JSON.stringify({ systems: data || [] }), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': origin || '*',
        'Cache-Control': 'public, max-age=30',
      },
    });
  } catch (e) {
    return errorResponse('UPSTREAM', (e as Error).message, 502, origin);
  }
}
