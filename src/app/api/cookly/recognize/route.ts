import { cors, checkRateLimit, callGemini, safeJsonParse } from '../_shared';

export const runtime = 'nodejs';

interface RecognizeBody {
  locale: string;
  imageBase64: string;
}

export async function OPTIONS(req: Request) {
  return new Response(null, { status: 204, headers: cors(req.headers.get('origin') ?? '') });
}

export async function POST(req: Request) {
  const origin = req.headers.get('origin') ?? '';
  const headers = { 'Content-Type': 'application/json', ...cors(origin) };

  const token = req.headers.get('X-Client-Token');
  if (process.env.COOKLY_CLIENT_TOKEN && token !== process.env.COOKLY_CLIENT_TOKEN) {
    return new Response(JSON.stringify({ error: 'unauthorized' }), { status: 401, headers });
  }

  const ip = req.headers.get('x-forwarded-for')?.split(',')[0] ?? 'unknown';
  if (!checkRateLimit(ip)) {
    return new Response(JSON.stringify({ error: 'rate_limited' }), { status: 429, headers });
  }

  let body: RecognizeBody;
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: 'bad_request' }), { status: 400, headers });
  }

  const lang = body.locale === 'ru' ? 'Russian' : 'English';
  const system =
    `You are a food recognition assistant. Identify edible ingredients/products visible in the image. ` +
    `Respond in ${lang}. Return STRICT JSON only.`;
  const prompt =
    `List the ingredients you can see. For each, include a confidence flag. ` +
    `Return JSON: { "items": [{ "name": string, "confident": boolean }] }. ` +
    `Use "confident": false when unsure. Names must be in ${lang}.`;

  const result = await callGemini(system, prompt, body.imageBase64);
  if (!result.ok) {
    return new Response(JSON.stringify({ error: result.error }), { status: result.status, headers });
  }

  const parsed = safeJsonParse<{ items: { name: string; confident: boolean }[] }>(result.text, { items: [] });
  return new Response(JSON.stringify(parsed), { status: 200, headers });
}
