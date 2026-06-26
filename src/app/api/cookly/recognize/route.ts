import { cors, checkRateLimit, callGemini, safeJsonParse } from '../_shared';

export const runtime = 'nodejs';

interface RecognizeBody {
  locale: string;
  imageBase64: string;
  mode?: 'photo' | 'receipt';
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
  const isReceipt = body.mode === 'receipt';
  const system = isReceipt
    ? `You are a receipt-parsing assistant. The image is a store/grocery receipt. ` +
      `Extract only EDIBLE food products (ignore non-food line items, totals, taxes, discounts, store name). ` +
      `Translate/normalize each product name to a clean, human-readable ${lang} grocery name (e.g. expand abbreviations). ` +
      `Respond in ${lang}. Return STRICT JSON only.`
    : `You are a food recognition assistant. Identify edible ingredients/products visible in the image. ` +
      `Respond in ${lang}. Return STRICT JSON only.`;
  const prompt = isReceipt
    ? `Parse the receipt. Return JSON: { "items": [{ "name": string, "confident": boolean, "quantity": number | null, "unit": "pcs"|"g"|"kg"|"ml"|"l"|"pack"|null }] }. ` +
      `Use quantity/unit from the receipt line when present (e.g. "2" for 2 pcs, weight in kg/g). Set null when unknown. ` +
      `Do NOT guess expiry dates. Skip anything that isn't food. Names must be in ${lang}.`
    : `List the ingredients/products you can see. For each, estimate quantity if visible. ` +
    `Return JSON: { "items": [{ "name": string, "confident": boolean, "quantity": number | null, "unit": "pcs"|"g"|"kg"|"ml"|"l"|"pack"|null }] }. ` +
    `Use "confident": false when unsure. Set quantity/unit to null if you cannot tell. ` +
    `Do NOT guess expiry dates. Names must be in ${lang}.`;

  const result = await callGemini(system, prompt, body.imageBase64);
  if (!result.ok) {
    return new Response(JSON.stringify({ error: result.error }), { status: result.status, headers });
  }

  const parsed = safeJsonParse<{ items: { name: string; confident: boolean; quantity: number | null; unit: string | null }[] }>(result.text, { items: [] });
  return new Response(JSON.stringify(parsed), { status: 200, headers });
}
