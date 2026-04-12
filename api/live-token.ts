import { handlePreflight, errorResponse, jsonResponse } from './_shared/cors';
import { checkRateLimit, clientIp, rateLimitHeaders } from './_shared/ratelimit';

export const config = { runtime: 'edge' };

export default async function handler(req: Request): Promise<Response> {
  const origin = req.headers.get('origin');
  const pre = handlePreflight(req);
  if (pre) return pre;

  if (req.method !== 'POST' && req.method !== 'GET') {
    return errorResponse('METHOD_NOT_ALLOWED', 'POST/GET only', 405, origin);
  }

  const ip = clientIp(req);
  const rl = await checkRateLimit(ip, 'live_token');
  if (!rl.ok) {
    return errorResponse('RATE_LIMIT', 'Too many voice sessions today.', 429, origin, {
      retryAfterMs: rl.retryAfterMs,
    });
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return errorResponse('UPSTREAM', 'Server key missing', 500, origin);

  const ttlSec = 10 * 60;
  const expiresAt = Date.now() + ttlSec * 1000;

  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1alpha/auth-tokens:create?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          expire_time: new Date(expiresAt).toISOString(),
          new_session_expire_time: new Date(Date.now() + 60 * 1000).toISOString(),
          uses: 1,
        }),
      },
    );

    if (res.ok) {
      const data = (await res.json()) as { name?: string; token?: string };
      const token = data.token || data.name || '';
      if (token) {
        return new Response(JSON.stringify({ token, expiresAt }), {
          status: 200,
          headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': origin || '*',
            'Cache-Control': 'no-store',
            ...rateLimitHeaders(rl),
          },
        });
      }
    }

    return new Response(
      JSON.stringify({ token: apiKey, expiresAt, fallback: true }),
      {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': origin || '*',
          'Cache-Control': 'no-store',
          ...rateLimitHeaders(rl),
        },
      },
    );
  } catch (e) {
    return new Response(
      JSON.stringify({ token: apiKey, expiresAt, fallback: true }),
      {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': origin || '*',
          'Cache-Control': 'no-store',
          ...rateLimitHeaders(rl),
        },
      },
    );
  }
}
