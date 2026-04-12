import { createClient } from '@supabase/supabase-js';
import { handlePreflight, errorResponse } from '../_shared/cors';

export const config = { runtime: 'edge' };

export default async function handler(req: Request): Promise<Response> {
  const origin = req.headers.get('origin');
  const pre = handlePreflight(req);
  if (pre) return pre;
  if (req.method !== 'GET') return errorResponse('METHOD_NOT_ALLOWED', 'GET only', 405, origin);

  const { searchParams } = new URL(req.url);
  const hash = searchParams.get('hash');
  if (!hash || hash.length < 8 || hash.length > 32) {
    return errorResponse('BAD_REQUEST', 'hash query required', 400, origin);
  }

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return errorResponse('UPSTREAM', 'DB not configured', 500, origin);

  try {
    const sb = createClient(url, key, { auth: { persistSession: false } });
    const { data, error } = await sb
      .from('systems')
      .select('id, system_name, description, share_hash, data, created_at')
      .eq('share_hash', hash)
      .maybeSingle();

    if (error) return errorResponse('UPSTREAM', error.message, 502, origin);
    if (!data) return errorResponse('NOT_FOUND', 'System not found', 404, origin);

    return new Response(
      JSON.stringify({
        id: data.id,
        systemName: data.system_name,
        description: data.description,
        shareHash: data.share_hash,
        createdAt: data.created_at,
        ...(data.data as Record<string, unknown>),
      }),
      {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': origin || '*',
          'Cache-Control': 'public, max-age=60, s-maxage=3600',
        },
      },
    );
  } catch (e) {
    return errorResponse('UPSTREAM', (e as Error).message, 502, origin);
  }
}
