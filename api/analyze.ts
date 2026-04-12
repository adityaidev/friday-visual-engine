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

function applyRateHeaders(
  res: VercelResponse,
  rl: { remaining: number; resetMs: number; retryAfterMs?: number },
) {
  res.setHeader('X-RateLimit-Remaining', String(rl.remaining));
  res.setHeader('X-RateLimit-Reset', String(Math.floor(rl.resetMs / 1000)));
  if (rl.retryAfterMs) res.setHeader('Retry-After', String(Math.ceil(rl.retryAfterMs / 1000)));
}

function err(
  res: VercelResponse,
  code: string,
  message: string,
  status = 500,
  extra: Record<string, unknown> = {},
) {
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

    const imagePart = (() => {
      if (!imageBase64) return null;
      const mimeMatch = imageBase64.match(/^data:(image\/[a-z+]+);base64,/);
      const mime = mimeMatch ? mimeMatch[1] : 'image/jpeg';
      const data = mimeMatch ? imageBase64.slice(mimeMatch[0].length) : imageBase64;
      return { inlineData: { mimeType: mime, data } };
    })();

    const mainPrompt = `You are reconstructing: ${query || 'the object in the image'}

HARD REQUIREMENTS:
• Output 20-24 components that ASSEMBLE INTO A RECOGNIZABLE shape matching the target. The viewer MUST be able to tell what this is.
• All components share ONE world coordinate system. relativePosition[] places each component in world space so they fit together (not random clouds).
• Each component has 2-4 primitives in LOCAL space (around 0,0,0) that form ONE solid sub-assembly.
• Primary structure first: outer shell / chassis / frame that defines the silhouette. Secondary parts (internals, controls, fasteners) fit inside or on the outer shell.
• Overall assembly fits roughly in a 10×10×10 bounding box centered at origin.
• colorHex is crucial: main chassis panels should be light gray/white #d8dde3 or #e8ecf2; accent trim/pipes in steel #b8c0cc, copper #b87333, rubber seals #2a2a2a, control screens #1a1a1a, wiring #ff7a00. No neon colors.

OUTPUT — JSON only, no prose, no markdown fence:
{
 "systemName": "...",
 "description": "one short sentence",
 "components": [
  {
   "name": "Snake_Case_Descriptive_Name",
   "type": "MECHANICAL"|"COMPUTE"|"STORAGE"|"NETWORK"|"SENSOR"|"POWER",
   "status": "optimal",
   "description": "short",
   "connections": ["names of components touching this one"],
   "relativePosition": [x,y,z],
   "structure": [
    {"shape":"BOX"|"CYLINDER"|"SPHERE"|"CAPSULE"|"CONE"|"TORUS",
     "args":[...],
     "position":[x,y,z],
     "rotation":[rx,ry,rz],
     "colorHex":"#RRGGBB"}
   ]
  }
 ]
}

args conventions:
 BOX [w,h,d]   CYLINDER [radiusTop, radiusBottom, height]   SPHERE [radius]
 CAPSULE [radius, length]   CONE [radius, height]   TORUS [majorR, minorR]`;

    const parts: Array<Record<string, unknown>> = [{ text: mainPrompt }];
    if (imagePart) parts.push(imagePart);

    const response = await ai.models.generateContent({
      model: modelId,
      contents: { role: 'user', parts },
      config: {
        systemInstruction: SYSTEM_INSTRUCTION_ARCHITECT,
        responseMimeType: 'application/json',
        temperature: 0.6,
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
      isQuota ? 'Gemini quota exhausted. Try again in a minute.' : msg,
      isQuota ? 429 : 502,
    );
  }
}
