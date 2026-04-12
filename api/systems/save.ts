import { createClient } from '@supabase/supabase-js';
import { handlePreflight, errorResponse, jsonResponse } from '../_shared/cors';
import { checkRateLimit, clientIp, rateLimitHeaders } from '../_shared/ratelimit';

export const config = { runtime: 'edge' };

export default async function handler(req: Request): Promise<Response> {
  const origin = req.headers.get('origin');
  const pre = handlePreflight(req);
  if (pre) return pre;
  if (req.method !== 'POST') return errorResponse('METHOD_NOT_ALLOWED', 'POST only', 405, origin);

  const ip = clientIp(req);
  const rl = await checkRateLimit(ip, 'default');
  if (!rl.ok) {
    return errorResponse('RATE_LIMIT', 'Save rate limit hit.', 429, origin, {
      retryAfterMs: rl.retryAfterMs,
    });
  }

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return errorResponse('UPSTREAM', 'DB not configured', 500, origin);

  let body: { systemName?: string; description?: string; data?: unknown };
  try {
    body = await req.json();
  } catch {
    return errorResponse('BAD_REQUEST', 'Invalid JSON', 400, origin);
  }

  if (!body.systemName || !body.data) {
    return errorResponse('BAD_REQUEST', 'systemName + data required', 400, origin);
  }

  const shareHash = crypto.randomUUID().replace(/-/g, '').slice(0, 12);

  try {
    const sb = createClient(url, key, { auth: { persistSession: false } });
    const { data: inserted, error } = await sb
      .from('systems')
      .insert({
        system_name: String(body.systemName).slice(0, 200),
        description: String(body.description || '').slice(0, 2000),
        share_hash: shareHash,
        data: body.data,
        ip_hash: await hashIp(ip),
      })
      .select('id, share_hash, created_at')
      .single();

    if (error) return errorResponse('UPSTREAM', error.message, 502, origin);

    return new Response(
      JSON.stringify({
        id: inserted.id,
        shareHash: inserted.share_hash,
        createdAt: inserted.created_at,
      }),
      {
        status: 201,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': origin || '*',
          ...rateLimitHeaders(rl),
        },
      },
    );
  } catch (e) {
    return errorResponse('UPSTREAM', (e as Error).message, 502, origin);
  }
}

async function hashIp(ip: string): Promise<string> {
  const data = new TextEncoder().encode(ip + (process.env.IP_HASH_SALT || 'friday'));
  const buf = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
    .slice(0, 32);
}
