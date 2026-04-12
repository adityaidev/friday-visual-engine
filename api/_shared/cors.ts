const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || '*').split(',').map(s => s.trim());

export function corsHeaders(origin: string | null): HeadersInit {
  const allow = ALLOWED_ORIGINS.includes('*') || (origin && ALLOWED_ORIGINS.includes(origin))
    ? origin || '*'
    : ALLOWED_ORIGINS[0];
  return {
    'Access-Control-Allow-Origin': allow,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin',
  };
}

export function handlePreflight(req: Request): Response | null {
  if (req.method !== 'OPTIONS') return null;
  return new Response(null, { status: 204, headers: corsHeaders(req.headers.get('origin')) });
}

export function jsonResponse(data: unknown, status = 200, origin: string | null = null): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      ...corsHeaders(origin),
    },
  });
}

export function errorResponse(
  code: string,
  message: string,
  status = 500,
  origin: string | null = null,
  extra: Record<string, unknown> = {},
): Response {
  return jsonResponse({ error: { code, message, ...extra } }, status, origin);
}
