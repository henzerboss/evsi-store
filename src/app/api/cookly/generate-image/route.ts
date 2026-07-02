import { z } from 'zod';
import { cors, checkRateLimit } from '../_shared';

export const runtime = 'nodejs';

const MAX_RECIPE_TEXT_CHARS = 8_000;
const REQUEST_TIMEOUT_MS = 45_000;

const payloadSchema = z.object({
  locale: z.string().min(2).max(8).optional().nullable(),
  servings: z.number().int().min(1).max(100).optional().nullable(),
  recipeText: z.string().min(10).max(MAX_RECIPE_TEXT_CHARS),
});

function json(data: unknown, status: number, headers: Record<string, string>) {
  return new Response(JSON.stringify(data), { status, headers });
}

function buildImagePrompt(recipeText: string, servings?: number | null) {
  return [
    'Photorealistic food photography of the final cooked dish produced by this recipe.',
    'Show only the finished plated dish, ready to eat, based on the ingredients, cooking steps and number of servings.',
    servings ? `Number of servings: ${servings}.` : '',
    'Use natural appetizing restaurant-style lighting, realistic textures, true-to-recipe ingredients, no people, no hands, no text, no labels, no watermark, no packaging, no cartoon style.',
    'Recipe text:',
    recipeText,
  ].filter(Boolean).join('\n\n');
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

  const apiKey = process.env.DEEPINFRA_API_KEY;
  if (!apiKey) {
    return json({ error: 'deepinfra_not_configured' }, 500, headers);
  }

  let payload: z.infer<typeof payloadSchema>;
  try {
    payload = payloadSchema.parse(await req.json());
  } catch (error) {
    return json({ error: 'bad_request', detail: String(error) }, 400, headers);
  }

  const model = process.env.DEEPINFRA_IMAGE_MODEL?.trim() || 'black-forest-labs/FLUX-1-schnell';
  const size = process.env.DEEPINFRA_IMAGE_SIZE?.trim() || '512x512';
  const steps = Number.parseInt(process.env.DEEPINFRA_IMAGE_STEPS ?? '4', 10);
  const n = 1;
  const prompt = buildImagePrompt(payload.recipeText, payload.servings);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const res = await fetch('https://api.deepinfra.com/v1/openai/images/generations', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        prompt,
        size,
        n,
        response_format: 'b64_json',
        // DeepInfra exposes FLUX Schnell, which is designed for 1-4 steps. If the
        // OpenAI-compatible endpoint ignores this provider-specific field, the model
        // still runs with its default Schnell settings.
        steps,
      }),
      signal: controller.signal,
    });

    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      return json({ error: 'deepinfra_failed', detail }, 502, headers);
    }

    const body = await res.json() as { data?: { b64_json?: string }[] };
    const imageBase64 = body.data?.[0]?.b64_json;
    if (!imageBase64) {
      return json({ error: 'deepinfra_empty_image' }, 502, headers);
    }

    return json({ ok: true, imageBase64, mimeType: 'image/png' }, 200, headers);
  } catch (error) {
    return json({ error: 'deepinfra_request_failed', detail: String(error) }, 502, headers);
  } finally {
    clearTimeout(timeout);
  }
}
