import { handlePreflight, errorResponse } from './_shared/cors';
import { checkRateLimit, clientIp, rateLimitHeaders } from './_shared/ratelimit';

export const config = { runtime: 'edge' };

interface TokenResponse {
  name?: string;
  token?: string;
  expireTime?: string;
}

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

  const sessionTtlSec = 30 * 60;
  const newSessionWindowSec = 2 * 60;
  const expireTime = new Date(Date.now() + sessionTtlSec * 1000).toISOString();
  const newSessionExpireTime = new Date(Date.now() + newSessionWindowSec * 1000).toISOString();

  const endpoints = [
    `https://generativelanguage.googleapis.com/v1alpha/auth-tokens:create?key=${apiKey}`,
    `https://generativelanguage.googleapis.com/v1beta/auth-tokens:create?key=${apiKey}`,
  ];

  const payload = {
    config: {
      uses: 1,
      expire_time: expireTime,
      new_session_expire_time: newSessionExpireTime,
      http_options: { api_version: 'v1beta' },
    },
  };

  for (const url of endpoints) {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) continue;
      const data = (await res.json()) as TokenResponse;
      const token = data.name || data.token;
      if (token) {
        return new Response(
          JSON.stringify({
            token,
            expiresAt: new Date(expireTime).getTime(),
            ephemeral: true,
          }),
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
    } catch (e) {
      console.warn('live-token endpoint failed:', url, (e as Error).message);
    }
  }

  // Fallback: hand over the long-lived key. Not ideal, but voice breaks otherwise.
  // Mitigations: per-IP rate-limit on this endpoint (20/day), HTTP referrer restrictions
  // should be configured on the key in Google Cloud Console.
  return new Response(
    JSON.stringify({
      token: apiKey,
      expiresAt: Date.now() + sessionTtlSec * 1000,
      ephemeral: false,
    }),
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
