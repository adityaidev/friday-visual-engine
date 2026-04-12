import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { analyzeSystem, chatWithFriday } from '../services/geminiService';

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn());
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe('geminiService', () => {
  it('analyzeSystem POSTs to /api/analyze', async () => {
    const mockSystem = {
      systemName: 'X',
      description: 'd',
      components: [{ id: 'a', name: 'A', type: 'COMPUTE', structure: [], connections: [], status: 'optimal', description: '', details: {}, relativePosition: [0, 0, 0] }],
    };
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      new Response(JSON.stringify(mockSystem), { status: 200 }),
    );
    const result = await analyzeSystem({ query: 'test' });
    expect(result.systemName).toBe('X');
  });

  it('chatWithFriday returns text', async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      new Response(JSON.stringify({ text: 'hello' }), { status: 200 }),
    );
    const r = await chatWithFriday([], 'hi');
    expect(r).toBe('hello');
  });

  it('throws on API error with code', async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      new Response(
        JSON.stringify({ error: { code: 'RATE_LIMIT', message: 'too many' } }),
        { status: 429 },
      ),
    );
    await expect(analyzeSystem({ query: 'x' })).rejects.toThrow('too many');
  });
});
