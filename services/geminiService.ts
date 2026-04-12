import type { SystemAnalysis, DiagnosticResult, ModelTier } from '../types';

const API_BASE = (import.meta.env.VITE_API_BASE as string | undefined) || '/api';

export interface AnalyzeOptions {
  query: string;
  imageBase64?: string;
  tier?: ModelTier;
  signal?: AbortSignal;
}

const NO_RETRY_STATUSES = new Set([400, 401, 403, 404, 413, 504]);

async function fetchWithBackoff(
  url: string,
  init: RequestInit,
  maxRetries = 2,
): Promise<Response> {
  let attempt = 0;
  let lastErr: unknown;
  while (attempt < maxRetries) {
    try {
      const res = await fetch(url, init);
      if (NO_RETRY_STATUSES.has(res.status)) return res;
      if (res.status === 429 || res.status >= 500) {
        const body = await res.clone().json().catch(() => null);
        const retryAfter =
          body?.error?.retryAfterMs ||
          Number(res.headers.get('retry-after')) * 1000 ||
          Math.min(30_000, 2 ** attempt * 1000 + Math.random() * 500);
        if (attempt < maxRetries - 1) {
          await sleep(retryAfter);
          attempt++;
          continue;
        }
      }
      return res;
    } catch (e) {
      lastErr = e;
      if ((init.signal as AbortSignal | undefined)?.aborted) throw e;
      if (attempt >= maxRetries - 1) throw e;
      await sleep(Math.min(30_000, 2 ** attempt * 1000 + Math.random() * 500));
      attempt++;
    }
  }
  if (lastErr) throw lastErr;
  throw new Error('Request failed after retries');
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function parseOrThrow<T>(res: Response): Promise<T> {
  let body: unknown;
  try {
    body = await res.json();
  } catch {
    throw new Error(`Server returned invalid JSON (HTTP ${res.status})`);
  }
  if (!res.ok) {
    const err = (body as { error?: { code?: string; message?: string } }).error;
    const msg = err?.message || `HTTP ${res.status}`;
    const e = new Error(msg);
    (e as Error & { code?: string }).code = err?.code;
    throw e;
  }
  return body as T;
}

export async function analyzeSystem(
  opts: AnalyzeOptions,
  _onFallback?: (reason: string) => void,
): Promise<SystemAnalysis> {
  const tier = opts.tier || 'pro';
  const res = await fetchWithBackoff(
    `${API_BASE}/analyze`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query: opts.query,
        imageBase64: opts.imageBase64,
        tier,
      }),
      signal: opts.signal,
    },
    1,
  );
  return parseOrThrow<SystemAnalysis>(res);
}

export async function runDiagnostics(
  system: SystemAnalysis,
  signal?: AbortSignal,
): Promise<DiagnosticResult[]> {
  const res = await fetchWithBackoff(`${API_BASE}/diagnostics`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      systemName: system.systemName,
      components: system.components.map((c) => ({
        id: c.id,
        name: c.name,
        status: c.status,
        type: c.type,
      })),
    }),
    signal,
  });
  const data = await parseOrThrow<{ issues: DiagnosticResult[] }>(res);
  return data.issues || [];
}

export async function chatWithFriday(
  history: Array<{ role: string; content: string }>,
  message: string,
  systemContext?: string,
  signal?: AbortSignal,
): Promise<string> {
  const res = await fetchWithBackoff(`${API_BASE}/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message, history, systemContext }),
    signal,
  });
  const data = await parseOrThrow<{ text: string }>(res);
  return data.text;
}

export async function fetchLiveToken(
  signal?: AbortSignal,
): Promise<{ token: string; expiresAt: number; fallback?: boolean; ephemeral?: boolean }> {
  const res = await fetchWithBackoff(
    `${API_BASE}/live-token`,
    { method: 'POST', signal },
    2,
  );
  return parseOrThrow<{
    token: string;
    expiresAt: number;
    fallback?: boolean;
    ephemeral?: boolean;
  }>(res);
}
