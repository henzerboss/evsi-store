import { z } from 'zod';
import { cors, checkRateLimit } from '../../../cookly/_shared';

export const runtime = 'nodejs';

const MAX_BODY_BYTES = 4_500_000;
const FORWARD_TIMEOUT_MS = 15_000;

const recipeSchema = z.object({
  id: z.string().min(3).max(120),
  title: z.string().min(1).max(180),
}).passthrough();

const payloadSchema = z.object({
  locale: z.string().min(2).max(8),
  recipe: recipeSchema,
  rating: z.number().int().min(0).max(5).optional().nullable(),
  photoBase64: z.string().max(4_000_000).optional().nullable(),
  photoMimeType: z.enum(['image/jpeg', 'image/png', 'image/webp']).optional().nullable(),
}).passthrough();

function json(data: unknown, status: number, headers: Record<string, string>) {
  return new Response(JSON.stringify(data), { status, headers });
}

function siteUpsertEndpoint() {
  const explicit = process.env.DISHKIN_RECIPE_UPSERT_URL?.trim();
  if (explicit) return explicit;
  const base = (process.env.DISHKIN_SITE_URL ?? 'https://dishkin.com').replace(/\/$/, '');
  return `${base}/api/v1/recipes/upsert`;
}

export async function OPTIONS(req: Request) {
  return new Response(null, { status: 204, headers: cors(req.headers.get('origin') ?? '') });
}

export async function POST(req: Request) {
  const origin = req.headers.get('origin') ?? '';
  const headers = { 'Content-Type': 'application/json', ...cors(origin) };

  const clientToken = req.headers.get('X-Client-Token');
  if (process.env.COOKLY_CLIENT_TOKEN && clientToken !== process.env.COOKLY_CLIENT_TOKEN) {
    return json({ error: 'unauthorized' }, 401, headers);
  }

  const ip = req.headers.get('cf-connecting-ip') || req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
  if (!checkRateLimit(ip)) {
    return json({ error: 'rate_limited' }, 429, headers);
  }

  const syncToken = process.env.DISHKIN_SYNC_TOKEN;
  if (!syncToken) {
    return json({ error: 'dishkin_sync_not_configured' }, 500, headers);
  }

  const raw = await req.text();
  if (Buffer.byteLength(raw, 'utf8') > MAX_BODY_BYTES) {
    return json({ error: 'payload_too_large' }, 413, headers);
  }

  let payload: z.infer<typeof payloadSchema>;
  try {
    payload = payloadSchema.parse(JSON.parse(raw));
  } catch (error) {
    return json({ error: 'bad_request', detail: String(error) }, 400, headers);
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FORWARD_TIMEOUT_MS);
  try {
    const upstream = await fetch(siteUpsertEndpoint(), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Dishkin-Sync-Token': syncToken,
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    const text = await upstream.text().catch(() => '');
    return new Response(text || JSON.stringify({ ok: upstream.ok }), {
      status: upstream.ok ? 200 : 502,
      headers,
    });
  } catch (error) {
    return json({ error: 'dishkin_sync_failed', detail: String(error) }, 502, headers);
  } finally {
    clearTimeout(timeout);
  }
}
