export const config = { runtime: 'edge' };

export default async function handler(): Promise<Response> {
  return new Response(
    JSON.stringify({
      status: 'ok',
      version: '1.0.0',
      timestamp: new Date().toISOString(),
      models: {
        reasoning: 'gemini-3.1-pro-preview',
        fast: 'gemini-3.1-flash-lite-preview',
        live: 'gemini-3.1-flash-live-preview',
      },
    }),
    {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'public, max-age=30',
      },
    },
  );
}
