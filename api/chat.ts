import { getClient, MODELS, SYSTEM_INSTRUCTION_CHAT } from './_shared/gemini';
import { handlePreflight, errorResponse, jsonResponse } from './_shared/cors';
import { checkRateLimit, clientIp, rateLimitHeaders } from './_shared/ratelimit';
import { sanitizeQuery } from './_shared/validate';

export const config = { runtime: 'edge' };

interface ChatReq {
  message?: string;
  history?: Array<{ role: string; content: string }>;
  systemContext?: string;
}

export default async function handler(req: Request): Promise<Response> {
  const origin = req.headers.get('origin');
  const pre = handlePreflight(req);
  if (pre) return pre;

  if (req.method !== 'POST') return errorResponse('METHOD_NOT_ALLOWED', 'POST only', 405, origin);

  const ip = clientIp(req);
  const rl = await checkRateLimit(ip, 'chat');
  if (!rl.ok) {
    return errorResponse('RATE_LIMIT', 'Chat rate limit hit.', 429, origin, {
      retryAfterMs: rl.retryAfterMs,
    });
  }

  let body: ChatReq;
  try {
    body = (await req.json()) as ChatReq;
  } catch {
    return errorResponse('BAD_REQUEST', 'Invalid JSON', 400, origin);
  }

  const message = sanitizeQuery(body.message, 4000);
  if (!message) return errorResponse('BAD_REQUEST', 'message required', 400, origin);

  const systemContext = sanitizeQuery(body.systemContext, 8000);
  const history = Array.isArray(body.history)
    ? body.history
        .filter((h) => h && typeof h.content === 'string' && (h.role === 'user' || h.role === 'model'))
        .slice(-20)
    : [];

  try {
    const ai = getClient();
    const instruction = systemContext
      ? `${SYSTEM_INSTRUCTION_CHAT}\n\nACTIVE SYSTEM CONTEXT:\n${systemContext}`
      : SYSTEM_INSTRUCTION_CHAT;

    const chat = ai.chats.create({
      model: MODELS.fast,
      config: { systemInstruction: instruction },
      history: history.map((h) => ({ role: h.role, parts: [{ text: h.content }] })),
    });

    const result = await chat.sendMessage({ message });
    return new Response(
      JSON.stringify({ text: result.text || 'Signal lost. Retry.' }),
      {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': origin || '*',
          ...rateLimitHeaders(rl),
        },
      },
    );
  } catch (e) {
    return errorResponse('UPSTREAM', (e as Error).message, 502, origin);
  }
}
