import { getClient, MODELS } from './_shared/gemini';
import { DiagnosticSchema } from './_shared/schemas';
import { handlePreflight, errorResponse } from './_shared/cors';
import { checkRateLimit, clientIp, rateLimitHeaders } from './_shared/ratelimit';

export const config = { runtime: 'edge' };

interface DiagReq {
  systemName?: string;
  components?: Array<{ id: string; name: string; status: string; type?: string }>;
}

export default async function handler(req: Request): Promise<Response> {
  const origin = req.headers.get('origin');
  const pre = handlePreflight(req);
  if (pre) return pre;

  if (req.method !== 'POST') return errorResponse('METHOD_NOT_ALLOWED', 'POST only', 405, origin);

  const ip = clientIp(req);
  const rl = await checkRateLimit(ip, 'diagnostics');
  if (!rl.ok) {
    return errorResponse('RATE_LIMIT', 'Too many diagnostic runs.', 429, origin, {
      retryAfterMs: rl.retryAfterMs,
    });
  }

  let body: DiagReq;
  try {
    body = (await req.json()) as DiagReq;
  } catch {
    return errorResponse('BAD_REQUEST', 'Invalid JSON', 400, origin);
  }

  const components = Array.isArray(body.components) ? body.components.slice(0, 100) : [];
  if (components.length === 0) {
    return errorResponse('BAD_REQUEST', 'components required', 400, origin);
  }

  try {
    const ai = getClient();
    const summary = components
      .map((c) => `${c.name} [${c.type || 'UNKNOWN'}] (Status: ${c.status})`)
      .join(', ');

    const response = await ai.models.generateContent({
      model: MODELS.fast,
      contents: `You are a senior reliability engineer. Analyze this system for potential failures: ${summary}. For any component marked 'warning' or 'critical', give a specific technical issue and a repair recommendation. If all are optimal, hypothesize the single most likely stress point. Keep output terse.`,
      config: {
        responseMimeType: 'application/json',
        responseSchema: DiagnosticSchema,
      },
    });

    const text = response.text || '{"issues":[]}';
    const clean = text.replace(/```json|```/g, '').trim();
    let parsed: { issues?: unknown[] };
    try {
      parsed = JSON.parse(clean);
    } catch {
      parsed = { issues: [] };
    }

    const nameToId = new Map(components.map((c) => [c.name.toLowerCase(), c.id]));
    const issues = Array.isArray(parsed.issues)
      ? parsed.issues.map((raw) => {
          const r = raw as Record<string, unknown>;
          const cid = String(r.componentId || '');
          const match =
            nameToId.get(cid.toLowerCase()) ||
            [...nameToId.entries()].find(([n]) => n.includes(cid.toLowerCase()) || cid.toLowerCase().includes(n))?.[1] ||
            cid;
          return {
            componentId: match,
            issue: String(r.issue || ''),
            recommendation: String(r.recommendation || ''),
            severity: ['low', 'medium', 'high'].includes(r.severity as string)
              ? (r.severity as string)
              : 'low',
          };
        })
      : [];

    return new Response(JSON.stringify({ issues }), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': origin || '*',
        ...rateLimitHeaders(rl),
      },
    });
  } catch (e) {
    return errorResponse('UPSTREAM', (e as Error).message, 502, origin);
  }
}
