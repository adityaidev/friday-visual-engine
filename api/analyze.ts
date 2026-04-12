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

COORDINATE SYSTEM — EVERY COMPONENT USES THIS SHARED FRAME:
• X-axis: left(-) ↔ right(+)
• Y-axis: bottom(-) ↔ top(+)
• Z-axis: back(-) ↔ front(+) (front = where user looks from)
• Origin (0,0,0) is the geometric centre of the outer chassis.

DETERMINE THE BOUNDING BOX for the target:
• Washing machine: W=6, H=7, D=6 (tall rectangular cabinet)
• V8/I4 engine: W=6, H=4, D=5
• Turbojet: W=4, H=4, D=10 (long cylindrical)
• CPU/TPU chip: W=4, H=0.3, D=4 (flat)
• Passenger car: W=5, H=3, D=10
• Smartphone: W=0.7, H=3, D=0.1 (very thin)
• Building: W=6, H=12, D=6
• Drone: W=4, H=1, D=4
• Robot arm: W=2, H=5, D=2
• Rocket engine: W=3, H=6, D=3
Match an appropriate bounding box to the target query.

COMPONENT #1 — always the outer shell/chassis:
• A SINGLE BOX (or CYLINDER for curved bodies) sized exactly to the bounding box W×H×D
• relativePosition: [0, 0, 0]
• Example hint: "box W=6 H=7 D=6 for outer washing machine cabinet"

COMPONENT #2..N — placed INSIDE or ON the shell. Positions spread across the volume:
• Top face parts: y = +H/2 (e.g. lid at [0, 3.5, 0])
• Bottom face / feet: y = -H/2 (e.g. foot_rear_left at [-2.3, -3.5, -2.3])
• Front face parts: z = +D/2 (e.g. door at [0, 0, 3.0], control panel at [0, 3.0, 2.8])
• Back face: z = -D/2 (e.g. power cable at [1.5, -2.8, -3.0])
• Left side: x = -W/2 (e.g. left vent at [-3.0, 1, 0])
• Right side: x = +W/2
• INSIDE the volume: any x,y,z within (-W/2+0.5, -H/2+0.5, -D/2+0.5) .. (+W/2-0.5, +H/2-0.5, +D/2-0.5)
  (e.g. inner drum at [0, 0.3, 0.5], motor at [0, -2.3, -1.5])

SPREAD RULE: positions must be genuinely distributed. NO TWO COMPONENTS should have identical relativePosition. If two parts (e.g. left/right springs) are symmetric, mirror them across an axis (one at x=-2.3, other at x=+2.3).

WASHING MACHINE EXAMPLE POSITIONS (follow this pattern, do not copy verbatim):
• Outer_Cabinet [0,0,0] (box 6×7×6)
• Top_Lid [0,3.6,0] (box 5.8×0.2×5.8)
• Control_Panel [0,3.1,2.7] (box 4×0.6×0.2)
• Interface_Display [-0.8,3.1,2.82] (box 1.2×0.4×0.05)
• Detergent_Drawer [-1.5,3.15,2.75] (box 1.4×0.4×0.4)
• Door_Frame [0,0,2.9] (torus r=1.5 t=0.15)
• Door_Glass [0,0,2.85] (cylinder r=1.3 L=0.15)
• Door_Latch [1.5,0,2.9] (box 0.3×0.15×0.3)
• Inner_Drum [0,0.3,0.3] (cylinder r=2 L=3 horizontal)
• Drum_Housing [0,0.3,0.3] (cylinder r=2.3 L=3.2 horizontal)
• Main_Drive_Pulley [0,0.3,-1.9] (cylinder r=1 L=0.15)
• Drive_Belt [0,-1,-1.9] (torus r=1.4 t=0.08)
• Drive_Motor [1,-2.1,-1.5] (cylinder r=0.7 L=1)
• Drain_Pump [-2,-2.5,1] (cylinder r=0.5 L=0.6)
• Water_Inlet_Valve [2,2.5,-2.9] (box 0.4×0.4×0.3)
• Water_Inlet_Hose [2,1.5,-2.9] (cylinder r=0.1 L=2)
• Heating_Element [0,-2,0] (cylinder r=0.1 L=2.5)
• Temperature_Sensor [-1,-2,0.5] (cylinder r=0.15 L=0.3)
• Pressure_Sensor [1,-2,0.5] (cylinder r=0.15 L=0.3)
• Control_PCB [0,3.1,2.3] (box 3×0.2×0.8)
• Counterweight_Front [0,0.5,1.5] (box 3×1×0.5 heavy)
• Counterweight_Top [0,2,0.3] (box 3×0.4×2)
• Suspension_Spring_Front_Left [-2,2.5,2] (capsule r=0.15 L=1.8)
• Suspension_Spring_Front_Right [2,2.5,2] (capsule r=0.15 L=1.8)
• Suspension_Spring_Rear_Left [-2,2.5,-2] (capsule r=0.15 L=1.8)
• Suspension_Spring_Rear_Right [2,2.5,-2] (capsule r=0.15 L=1.8)
• Shock_Absorber_Front [0,-2.5,1.8] (cylinder r=0.2 L=1.5)
• Shock_Absorber_Rear [0,-2.5,-1.8] (cylinder r=0.2 L=1.5)
• Foot_Front_Left [-2.7,-3.5,2.7] (cylinder r=0.15 L=0.3)
• Foot_Front_Right [2.7,-3.5,2.7] (cylinder r=0.15 L=0.3)
• Foot_Rear_Left [-2.7,-3.5,-2.7] (cylinder r=0.15 L=0.3)
• Foot_Rear_Right [2.7,-3.5,-2.7] (cylinder r=0.15 L=0.3)
• Power_Cable_Gland [2,-3,-2.9] (cylinder r=0.12 L=0.3)
• Drain_Hose [-2.5,-2.8,0] (cylinder r=0.2 L=2)
That's 30 components — use similar density.

Produce 22-30 components. Use symmetric naming for paired parts (Front_Left, Front_Right). Output ONLY a JSON array (no prose, no markdown fence):
[{ "name": "Snake_Case_Name",
   "type": "MECHANICAL"|"COMPUTE"|"STORAGE"|"NETWORK"|"SENSOR"|"POWER",
   "description": "short",
   "relativePosition": [x,y,z],
   "connections": [ names ],
   "primitiveHint": "specific shape + size (e.g. 'cylinder r=0.5 L=1.2 vertical for drain pump body')"
}]

First component MUST be the outer shell at [0,0,0]. Remaining components ordered largest→smallest. NO duplicate positions.`;

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
