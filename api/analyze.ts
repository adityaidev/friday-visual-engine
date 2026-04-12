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

    // ─────────────────────── Phase 1: Pro reasons about the whole object ────────
    // Full skeleton + layout. Pro's reasoning is critical here to pick the right
    // 24-28 parts and position them coherently in shared world space.
    const skeletonPrompt = `Design a 3D engineering reconstruction of: ${query || 'the object in the image'}.

CRITICAL SHAPE RULES — READ CAREFULLY:
1. Pick REAL-WORLD proportions for the target. E.g.:
   - Washing machine: ~6 wide × 7 tall × 6 deep (rectangular cabinet with round door on front)
   - V8 engine: ~6 wide × 4 tall × 5 deep
   - TPU chip: ~4 × 0.3 × 4 (flat square with components on top)
2. The FIRST component MUST be the outer Chassis/Cabinet/Housing — a SINGLE large bounding shape (usually a BOX) that defines the silhouette. This IS the recognizable outline of the object.
3. All subsequent components fit INSIDE or ON this chassis. They are SMALLER than the chassis.
4. Generate 22-28 components total.
5. Position every component with its relativePosition inside the chassis volume. E.g. door on front face (z = +3), motor low-rear (y = -2, z = -2), control panel top-front (y = +3, z = +3).
6. primitiveHint tells the builder EXACTLY what to draw, with proportions relative to the full assembly:
   - Good: "thin vertical box 5×6.8×5 for outer cabinet", "cylinder r=2 L=3.5 horizontal for wash drum", "torus r=1.5 t=0.15 for door seal ring", "box 2×0.6×0.3 for control panel"
   - Bad: "some shape", "various parts"

JSON array ONLY, no prose, no markdown fence:
[{ "name": "Snake_Case_Name",
   "type": "MECHANICAL"|"COMPUTE"|"STORAGE"|"NETWORK"|"SENSOR"|"POWER",
   "description": "short",
   "relativePosition": [x,y,z],
   "connections": [ names ],
   "primitiveHint": "specific shape + size"
}]

The FIRST component must be the outer shell. Subsequent components ordered from largest to smallest.`;

    const skelParts: Array<Record<string, unknown>> = [{ text: skeletonPrompt }];
    if (imagePart) skelParts.push(imagePart);

    const skelResp = await ai.models.generateContent({
      model: modelId,
      contents: { role: 'user', parts: skelParts },
      config: {
        systemInstruction: SYSTEM_INSTRUCTION_ARCHITECT,
        responseMimeType: 'application/json',
        temperature: 0.6,
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
    if (skeleton.length < 6) {
      err(res, 'UPSTREAM', 'Too few components', 502);
      return;
    }

    // ─────────────────────── Phase 2: Flash-lite fills structures in parallel ─────
    // Each half gets the FULL skeleton as shared context so primitives stay
    // spatially coherent with the whole assembly, not just their subset.
    const mid = Math.ceil(skeleton.length / 2);
    const halves = [skeleton.slice(0, mid), skeleton.slice(mid)];

    const fullContext = skeleton.map((c) => ({
      name: c.name,
      type: c.type,
      pos: c.relativePosition,
      hint: c.primitiveHint,
    }));

    const buildStructPrompt = (targetHalf: Array<Record<string, unknown>>) => `Given the FULL assembly skeleton (for spatial context):
${JSON.stringify(fullContext)}

Output the 'structure' primitive array for THESE components only:
${JSON.stringify(targetHalf.map((c) => ({ name: c.name, hint: c.primitiveHint, pos: c.relativePosition })))}

Each component's structure[] is in LOCAL space (around 0,0,0). Primitives form a solid sub-assembly matching the primitiveHint. Use 2-4 primitives per component.

Colors: steel chassis #d8dde3, white panel #eef1f6, dark grey #4a4f58, rubber #2a2a2a, copper #b87333, glass #8899aa, accent orange #ff7a00.

JSON array only:
[{ "name": "...",
   "structure": [
     { "shape": "BOX"|"CYLINDER"|"SPHERE"|"CAPSULE"|"CONE"|"TORUS",
       "args": [...],
       "position": [x,y,z],
       "rotation": [rx,ry,rz],
       "colorHex": "#RRGGBB" }
   ]
}]`;

    const runStruct = (part: Array<Record<string, unknown>>) =>
      ai.models.generateContent({
        model: MODELS.fast,
        contents: buildStructPrompt(part),
        config: { responseMimeType: 'application/json', temperature: 0.4 },
      });

    const [s1, s2] = await Promise.all([runStruct(halves[0]), runStruct(halves[1])]);

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
    [...parseStruct(s1), ...parseStruct(s2)].forEach((row) => {
      const n = typeof row.name === 'string' ? row.name.toLowerCase() : '';
      if (n && row.structure) structByName.set(n, row.structure);
    });

    const merged = {
      systemName: query.split('.')[0].trim().slice(0, 80) || 'System',
      description: `Engineered reconstruction with ${skeleton.length} sub-assemblies.`,
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
          { shape: 'BOX', args: [1, 1, 1], position: [0, 0, 0], rotation: [0, 0, 0], colorHex: '#d8dde3' },
        ],
      })),
    };

    const response = { text: JSON.stringify(merged) };

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
