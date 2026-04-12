import { getClient, MODELS, SYSTEM_INSTRUCTION_ARCHITECT } from './_shared/gemini';
import { AnalysisSchema } from './_shared/schemas';
import { handlePreflight, jsonResponse, errorResponse } from './_shared/cors';
import { checkRateLimit, clientIp, rateLimitHeaders } from './_shared/ratelimit';
import { normalizeAnalysis, sanitizeQuery } from './_shared/validate';

export const config = { runtime: 'edge' };

export default async function handler(req: Request): Promise<Response> {
  const origin = req.headers.get('origin');
  const pre = handlePreflight(req);
  if (pre) return pre;

  if (req.method !== 'POST') return errorResponse('METHOD_NOT_ALLOWED', 'POST only', 405, origin);

  const ip = clientIp(req);
  const rl = await checkRateLimit(ip, 'analyze');
  if (!rl.ok) {
    return errorResponse(
      'RATE_LIMIT',
      'Too many analyze requests. Try again later.',
      429,
      origin,
      { retryAfterMs: rl.retryAfterMs },
    );
  }

  let body: { query?: unknown; imageBase64?: unknown; tier?: unknown };
  try {
    body = await req.json();
  } catch {
    return errorResponse('BAD_REQUEST', 'Invalid JSON body', 400, origin);
  }

  const query = sanitizeQuery(body.query, 4000);
  const imageBase64 = typeof body.imageBase64 === 'string' ? body.imageBase64 : undefined;
  const tier = body.tier === 'flash' ? 'flash' : 'pro';

  if (!query && !imageBase64) {
    return errorResponse('BAD_REQUEST', 'query or imageBase64 required', 400, origin);
  }
  if (imageBase64 && imageBase64.length > 8_000_000) {
    return errorResponse('BAD_REQUEST', 'Image too large (max ~6MB)', 413, origin);
  }

  try {
    const ai = getClient();
    const modelId = tier === 'flash' ? MODELS.fast : MODELS.reasoning;

    const parts: Array<Record<string, unknown>> = [
      {
        text: imageBase64
          ? `Analyze this technical image. Deconstruct the object shown into a 3D engineering assembly. Context: ${query}`
          : `Perform a deep structural engineering breakdown and 3D reconstruction of: ${query}. Create realistic composite geometries for every part. If the system is complex (chip, engine, building), generate 20+ components.`,
      },
    ];
    if (imageBase64) {
      const mimeMatch = imageBase64.match(/^data:(image\/[a-z+]+);base64,/);
      const mime = mimeMatch ? mimeMatch[1] : 'image/jpeg';
      const data = mimeMatch ? imageBase64.slice(mimeMatch[0].length) : imageBase64;
      parts.push({ inlineData: { mimeType: mime, data } });
    }

    const response = await ai.models.generateContent({
      model: modelId,
      contents: { role: 'user', parts },
      config: {
        systemInstruction: SYSTEM_INSTRUCTION_ARCHITECT,
        responseMimeType: 'application/json',
        responseSchema: AnalysisSchema,
      },
    });

    const text = response.text;
    if (!text) return errorResponse('UPSTREAM', 'Empty response from model', 502, origin);

    const clean = text.replace(/```json|```/g, '').trim();
    let raw: unknown;
    try {
      raw = JSON.parse(clean);
    } catch {
      return errorResponse('UPSTREAM', 'Model returned invalid JSON', 502, origin);
    }

    let normalized;
    try {
      normalized = normalizeAnalysis(raw);
    } catch (e) {
      return errorResponse('UPSTREAM', (e as Error).message, 502, origin);
    }

    return new Response(JSON.stringify(normalized), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': origin || '*',
        ...rateLimitHeaders(rl),
      },
    });
  } catch (e) {
    const msg = (e as Error).message || 'Unknown error';
    const isQuota = /quota|429|RESOURCE_EXHAUSTED/i.test(msg);
    return errorResponse(
      isQuota ? 'QUOTA_EXCEEDED' : 'UPSTREAM',
      isQuota ? 'Gemini quota exhausted. Try flash tier or retry later.' : msg,
      isQuota ? 429 : 502,
      origin,
    );
  }
}
