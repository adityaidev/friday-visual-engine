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
    const skeletonPrompt = `You are laying out a 3D engineering assembly of: ${query || 'the object in the image'}.

You are an expert engineering mind. Use your own reasoning to decide what this object actually looks like, its real-world proportions, and every functional sub-assembly. The rules below are a SPATIAL FRAMEWORK - you fill it in intelligently.

COORDINATE FRAME (shared by all components):
• X: left(-) ↔ right(+)
• Y: bottom(-) ↔ top(+)
• Z: back(-) ↔ front(+)
• Origin (0,0,0) = geometric centre of the outer shell

STEP 1 - decide proportions yourself:
Think about how the real object looks from the outside. Pick a bounding box W × H × D that reflects its natural aspect ratio (tall vs flat vs long vs cubic). Keep the longest side ≤ 12 so it fits the camera.

STEP 2 - Component #1 is ALWAYS the outer shell:
A single primitive (usually BOX, or CYLINDER / SPHERE for curved bodies) sized to that bounding box, at relativePosition [0,0,0]. This primitive IS the recognisable silhouette.

STEP 3 - every other component:
Sits INSIDE or ON the shell. Decide for each: which face does it belong to? what's its role? Then place its relativePosition consistently:
• roofs/lids/top panels → y near +H/2
• feet/bases/floor → y near -H/2
• doors/displays/front-facing intakes → z near +D/2
• rear exhausts/cables/ports → z near -D/2
• side vents/handles/wheels → x near ±W/2
• primary internal (rotor, crankshaft, die, drum) → near origin
• secondary internals (motor, pump, PSU) → offset within volume
• fasteners/feet/mounts → 4 symmetric corners at [±X, ±Y, ±Z]
• wiring/pipes → positioned between their connecting endpoints

STEP 4 - SPREAD: no two components share identical relativePosition. Symmetric pairs mirror across an axis. Spread parts across ALL six face regions plus interior - don't cluster everything at origin.

STEP 5 - primitiveHint: tell the builder EXACTLY what to draw with specific size. Examples of a GOOD hint:
  "box 0.4×0.4×0.3 for water inlet valve body"
  "cylinder r=0.2 L=1.5 horizontal for exhaust pipe"
  "torus r=1.5 t=0.15 for door seal ring"
Bad hint: "some shape", "a part", "cylinder".

Produce 22-30 components for any non-trivial object. For a simple item (bolt, gear, wrench) match the real part count (5-12).

Output ONLY a JSON array, no prose, no markdown fence:
[{ "name": "Snake_Case_Descriptive_Name",
   "type": "MECHANICAL"|"COMPUTE"|"STORAGE"|"NETWORK"|"SENSOR"|"POWER",
   "description": "short",
   "relativePosition": [x,y,z],
   "connections": [ names of adjacent components ],
   "primitiveHint": "specific shape + exact size"
}]

First component = outer shell at [0,0,0]. Subsequent components ordered largest→smallest. Use the FULL 3D volume.`;

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
