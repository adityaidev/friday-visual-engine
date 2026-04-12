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

    const imagePart = (() => {
      if (!imageBase64) return null;
      const mimeMatch = imageBase64.match(/^data:(image\/[a-z+]+);base64,/);
      const mime = mimeMatch ? mimeMatch[1] : 'image/jpeg';
      const data = mimeMatch ? imageBase64.slice(mimeMatch[0].length) : imageBase64;
      return { inlineData: { mimeType: mime, data } };
    })();

    // ─────────────────────── Phase 1: skeleton ───────────────────────
    // Small output (~1.5k tokens) finishes in ~10-15s on Pro.
    const skeletonPrompt = imageBase64
      ? `Analyze this image. List 22-28 components of the object shown. Context: ${query}.
Return JSON array:
[{ "name": "Snake_Case_Specific_Name",
   "type": "MECHANICAL"|"COMPUTE"|"STORAGE"|"NETWORK"|"SENSOR"|"POWER",
   "description": "one short sentence",
   "relativePosition": [x,y,z]   (spread across roughly -5..5 in each axis with engineering-accurate layout),
   "connections": [ names of other components ],
   "primitiveHint": "short phrase describing visual shape — e.g. 'cylinder + top cone + 4 mount tabs'"
}]
No prose. JSON array only.`
      : `List 22-28 engineering components of: ${query}.
Return JSON array:
[{ "name": "Snake_Case_Specific_Name",
   "type": "MECHANICAL"|"COMPUTE"|"STORAGE"|"NETWORK"|"SENSOR"|"POWER",
   "description": "one short sentence",
   "relativePosition": [x,y,z]   (spread across roughly -5..5 in each axis with engineering-accurate layout),
   "connections": [ names of other components ],
   "primitiveHint": "short phrase describing visual shape — e.g. 'cylinder + top cone + 4 mount tabs'"
}]
Examples of good names: Chassis_Main_Frame, Wash_Drum_Inner, Drive_Motor_BLDC, Suspension_Strut_Rear_Left, Door_Gasket_Rubber.
No prose. JSON array only.`;

    const skelParts: Array<Record<string, unknown>> = [{ text: skeletonPrompt }];
    if (imagePart) skelParts.push(imagePart);

    const skelResp = await ai.models.generateContent({
      model: modelId,
      contents: { role: 'user', parts: skelParts },
      config: {
        systemInstruction: SYSTEM_INSTRUCTION_ARCHITECT,
        responseMimeType: 'application/json',
      },
    });
    const skelText = (skelResp.text || '').replace(/```json|```/g, '').trim();
    let skeleton: Array<Record<string, unknown>> = [];
    try {
      const parsed = JSON.parse(skelText);
      skeleton = Array.isArray(parsed)
        ? parsed
        : Array.isArray((parsed as Record<string, unknown>).components)
          ? ((parsed as Record<string, unknown>).components as Array<Record<string, unknown>>)
          : [];
    } catch {
      err(res, 'UPSTREAM', 'Skeleton JSON invalid', 502);
      return;
    }
    if (skeleton.length < 4) {
      err(res, 'UPSTREAM', 'Skeleton returned too few components', 502);
      return;
    }

    // ─────────────────────── Phase 2: structure (parallel halves) ───────────────────────
    const mid = Math.ceil(skeleton.length / 2);
    const half1 = skeleton.slice(0, mid);
    const half2 = skeleton.slice(mid);

    const buildStructurePrompt = (part: Array<Record<string, unknown>>) => `For each of the following components, generate a 'structure' array of 2-5 primitives whose combined shape forms a RECOGNISABLE, solid-looking part matching the primitiveHint. Position primitives in LOCAL space around (0,0,0) so they assemble into the part.
Components:
${JSON.stringify(part.map((c) => ({ name: c.name, hint: c.primitiveHint, type: c.type })))}

Return JSON array:
[{ "name": "...",
   "structure": [
     { "shape": "BOX"|"CYLINDER"|"SPHERE"|"CAPSULE"|"CONE"|"TORUS",
       "args": [...],
       "position": [x,y,z],
       "rotation": [rx,ry,rz],
       "colorHex": "#RRGGBB" (steel #C0C0C0, copper #b87333, rubber #2a2a2a, glass #8899aa, plastic #4a4a4a, wire #ff7a00)
     }
   ]
}]
No prose. JSON array only.`;

    const runStruct = (part: Array<Record<string, unknown>>) =>
      ai.models.generateContent({
        model: modelId,
        contents: buildStructurePrompt(part),
        config: { responseMimeType: 'application/json' },
      });

    const [struct1Resp, struct2Resp] = await Promise.all([runStruct(half1), runStruct(half2)]);

    const parseStruct = (r: { text?: string }): Array<Record<string, unknown>> => {
      try {
        const t = (r.text || '').replace(/```json|```/g, '').trim();
        const p = JSON.parse(t);
        return Array.isArray(p) ? p : (p.components as Array<Record<string, unknown>>) || [];
      } catch {
        return [];
      }
    };

    const structByName = new Map<string, unknown>();
    [...parseStruct(struct1Resp), ...parseStruct(struct2Resp)].forEach((row) => {
      const name = typeof row.name === 'string' ? row.name.toLowerCase() : '';
      if (name && row.structure) structByName.set(name, row.structure);
    });

    // ─────────────────────── Merge + normalize ───────────────────────
    const merged = {
      systemName: `${query.split('.')[0].trim().slice(0, 80) || 'System'}`,
      description: `Engineering reconstruction with ${skeleton.length} sub-assemblies.`,
      components: skeleton.map((s) => ({
        name: s.name,
        type: s.type,
        description: s.description,
        status: 'optimal',
        connections: s.connections,
        relativePosition: s.relativePosition,
        structure: structByName.get(
          typeof s.name === 'string' ? s.name.toLowerCase() : '',
        ) || [
          {
            shape: 'BOX',
            args: [1, 1, 1],
            position: [0, 0, 0],
            rotation: [0, 0, 0],
            colorHex: '#c0c0c0',
          },
        ],
      })),
    };

    let normalized;
    try {
      normalized = normalizeAnalysis(merged);
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
