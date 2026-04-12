import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getClient, MODELS, SYSTEM_INSTRUCTION_ARCHITECT } from './_shared/gemini.js';
import { checkRateLimit } from './_shared/ratelimit.js';
import { normalizeAnalysis, sanitizeQuery } from './_shared/validate.js';

export const config = { maxDuration: 60 };
export const maxDuration = 60;

function applyCors(res: VercelResponse, origin: string | null) {
  res.setHeader('Access-Control-Allow-Origin', origin || '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Vary', 'Origin');
}

function applyRateHeaders(res: VercelResponse, rl: { remaining: number; resetMs: number; retryAfterMs?: number }) {
  res.setHeader('X-RateLimit-Remaining', String(rl.remaining));
  res.setHeader('X-RateLimit-Reset', String(Math.floor(rl.resetMs / 1000)));
  if (rl.retryAfterMs) res.setHeader('Retry-After', String(Math.ceil(rl.retryAfterMs / 1000)));
}

function err(res: VercelResponse, code: string, message: string, status = 500, extra: Record<string, unknown> = {}) {
  return res.status(status).json({ error: { code, message, ...extra } });
}

function clientIpFromNode(req: VercelRequest): string {
  const fwd = req.headers['x-forwarded-for'];
  if (typeof fwd === 'string') return fwd.split(',')[0]?.trim() || 'unknown';
  if (Array.isArray(fwd) && fwd[0]) return fwd[0].split(',')[0]?.trim() || 'unknown';
  const real = req.headers['x-real-ip'];
  if (typeof real === 'string') return real;
  return req.socket?.remoteAddress || 'unknown';
}

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  const origin = (req.headers.origin as string | undefined) || null;
  applyCors(res, origin);

  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }
  if (req.method !== 'POST') {
    err(res, 'METHOD_NOT_ALLOWED', 'POST only', 405);
    return;
  }

  const ip = clientIpFromNode(req);
  const rl = await checkRateLimit(ip, 'analyze');
  applyRateHeaders(res, rl);
  if (!rl.ok) {
    err(res, 'RATE_LIMIT', 'Too many analyze requests. Try again later.', 429, {
      retryAfterMs: rl.retryAfterMs,
    });
    return;
  }

  const body = (req.body || {}) as { query?: unknown; imageBase64?: unknown; tier?: unknown };
  const query = sanitizeQuery(body.query, 4000);
  const imageBase64 = typeof body.imageBase64 === 'string' ? body.imageBase64 : undefined;
  const tier = body.tier === 'flash' ? 'flash' : 'pro';

  if (!query && !imageBase64) {
    err(res, 'BAD_REQUEST', 'query or imageBase64 required', 400);
    return;
  }
  if (imageBase64 && imageBase64.length > 8_000_000) {
    err(res, 'BAD_REQUEST', 'Image too large (max ~6MB)', 413);
    return;
  }

  try {
    const ai = getClient();
    const modelId = tier === 'flash' ? MODELS.fast : MODELS.reasoning;

    const schemaHint = `
Return JSON matching EXACTLY this shape:
{
  "systemName": string,
  "description": string (1-2 sentences),
  "components": [
    {
      "name": "Snake_Case_Name",
      "type": "COMPUTE" | "STORAGE" | "NETWORK" | "SENSOR" | "MECHANICAL" | "POWER",
      "status": "optimal",
      "description": string (short),
      "connections": [string names of other components],
      "relativePosition": [x, y, z],
      "structure": [
        { "shape": "BOX"|"CYLINDER"|"SPHERE"|"CAPSULE"|"CONE"|"TORUS",
          "args": [w, h, d] or [r, h] or [r],
          "position": [x, y, z],
          "rotation": [rx, ry, rz],
          "colorHex": "#RRGGBB" }
      ]
    }
  ]
}`;

    const parts: Array<Record<string, unknown>> = [
      {
        text: imageBase64
          ? `Engineering breakdown of the object in this image. Generate 20-30 components, each a composite of 2-6 primitives forming a recognisable shape. Context: ${query}\n${schemaHint}`
          : `Engineering breakdown and 3D reconstruction of: ${query}.
Rules:
- Generate 20-30 functional components for complex machines. List every visible + inferred part.
- Each component is a composite of 2-6 primitives placed to form a realistic recognisable shape.
- Position components in 3D space with proper engineering spacing (housing around internals, shaft through bearings, etc.).
- Use colorHex per primitive for materials (steel #C0C0C0, copper #b87333, rubber #2a2a2a, glass #8899aa, plastic #444, wiring #ff7a00).
- Names in Snake_Case_With_Context (e.g. Suspension_Strut_Rear_Left, not "Part1").
${schemaHint}`,
      },
    ];
    if (imageBase64) {
      const mimeMatch = imageBase64.match(/^data:(image\/[a-z+]+);base64,/);
      const mime = mimeMatch ? mimeMatch[1] : 'image/jpeg';
      const data = mimeMatch ? imageBase64.slice(mimeMatch[0].length) : imageBase64;
      parts.push({ inlineData: { mimeType: mime, data } });
    }

    // Strict responseSchema with Pro adds 30s+ of constrained-decoding overhead.
    // Using mimetype-only lets Pro generate the same content in ~half the time.
    const response = await ai.models.generateContent({
      model: modelId,
      contents: { role: 'user', parts },
      config: {
        systemInstruction: SYSTEM_INSTRUCTION_ARCHITECT,
        responseMimeType: 'application/json',
      },
    });

    const text = response.text;
    if (!text) {
      err(res, 'UPSTREAM', 'Empty response from model', 502);
      return;
    }

    const clean = text.replace(/```json|```/g, '').trim();
    let raw: unknown;
    try {
      raw = JSON.parse(clean);
    } catch {
      err(res, 'UPSTREAM', 'Model returned invalid JSON', 502);
      return;
    }

    let normalized;
    try {
      normalized = normalizeAnalysis(raw);
    } catch (e) {
      err(res, 'UPSTREAM', (e as Error).message, 502);
      return;
    }

    res.status(200).json(normalized);
  } catch (e) {
    const msg = (e as Error).message || 'Unknown error';
    const isQuota = /quota|429|RESOURCE_EXHAUSTED/i.test(msg);
    err(
      res,
      isQuota ? 'QUOTA_EXCEEDED' : 'UPSTREAM',
      isQuota ? 'Gemini quota exhausted. Try flash tier or retry later.' : msg,
      isQuota ? 429 : 502,
    );
  }
}
