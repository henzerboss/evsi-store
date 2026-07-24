import {
  cors,
  checkRateLimit,
  callGemini,
  safeJsonParse,
} from '../_shared';

export const runtime = 'nodejs';
export const maxDuration = 120;

/**
 * Batch per-serving nutrition estimation.
 *
 * Built for the dishkin.com admin recalculation tool (60k+ existing recipes):
 * up to MAX_ITEMS dishes per request share one Gemini call, so the system
 * prompt is amortized and the model chain starts with the cheapest flash-lite
 * model. Temperature 0 and a tight output budget keep cost and variance down.
 *
 * Auth: the same X-Client-Token / COOKLY_CLIENT_TOKEN check as the other
 * cookly routes — dishkin-web already sends this token for bulk generation.
 */

const MAX_ITEMS = 20;
const MAX_INGREDIENTS_PER_ITEM = 30;

interface NutritionItem {
  id: string;
  title: string;
  servings?: number;
  ingredients?: Array<{ name?: string; amount?: string | number | null }>;
}

interface NutritionBody {
  items: NutritionItem[];
}

interface NutritionResult {
  id: string;
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
}

const SYSTEM_INSTRUCTION =
  'You are a professional nutritionist. Estimate realistic nutrition values for dishes. ' +
  'Return STRICT JSON only — no markdown, no backticks, no commentary.';

function sanitizeItem(raw: NutritionItem, index: number): { id: string; alias: string; line: string } | null {
  const id = String(raw?.id ?? '').trim().slice(0, 120);
  const title = String(raw?.title ?? '').trim().slice(0, 200);
  if (!id || !title) return null;

  // Short positional alias instead of the (often long) recipe id: the model
  // echoes it back in every result object, so this trims both prompt and
  // output tokens and removes id-mangling failures.
  const alias = String(index + 1);

  const servings = Math.min(100, Math.max(1, Math.round(Number(raw?.servings) || 1)));
  const ingredients = (Array.isArray(raw?.ingredients) ? raw.ingredients : [])
    .slice(0, MAX_INGREDIENTS_PER_ITEM)
    .map((ingredient) => {
      const name = String(ingredient?.name ?? '').trim().slice(0, 120);
      const amount = String(ingredient?.amount ?? '').trim().slice(0, 60);
      if (!name) return '';
      return amount ? `${name} — ${amount}` : name;
    })
    .filter(Boolean)
    .join('; ');

  const line = `id=${alias} | dish: ${title} | total servings: ${servings}` +
    (ingredients ? ` | ingredients (whole recipe): ${ingredients}` : ' | ingredients: unknown, estimate from the dish name');
  return { id, alias, line };
}

/**
 * Salvages a truncated JSON array (e.g. the model ran out of output budget
 * mid-object): cut back to the last complete object and close the array.
 */
function repairTruncatedArray(text: string): unknown[] | null {
  const start = text.indexOf('[');
  if (start === -1) return null;
  const lastObjectEnd = text.lastIndexOf('}');
  if (lastObjectEnd <= start) return null;
  try {
    const repaired = `${text.slice(start, lastObjectEnd + 1)}]`;
    const parsed = JSON.parse(repaired);
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function toFiniteNumber(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.round(parsed * 10) / 10 : null;
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

  let body: NutritionBody;
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: 'bad_request' }), { status: 400, headers });
  }

  const rawItems = Array.isArray(body?.items) ? body.items.slice(0, MAX_ITEMS) : [];
  const items = rawItems
    .map((raw, index) => sanitizeItem(raw, index))
    .filter((item): item is { id: string; alias: string; line: string } => item !== null);
  if (!items.length) {
    return new Response(JSON.stringify({ error: 'bad_request', detail: 'items required' }), { status: 400, headers });
  }

  const prompt =
    `Estimate nutrition PER ONE SERVING for each dish below (the whole recipe divided by its total servings). ` +
    `"calories" in kcal, "protein"/"carbs"/"fat" in grams — realistic positive numbers for a single serving. ` +
    `Respond with ONLY a JSON array (no wrapper object) of EXACTLY ${items.length} objects, one per dish, in the SAME order, ` +
    `each shaped as { "id": string (echo the given id, e.g. "1"), "calories": number, "protein": number, "carbs": number, "fat": number }. ` +
    `No other fields, no nesting, no commentary.\n\nDishes:\n${items.map((item) => item.line).join('\n')}`;

  // A generous budget: the cap only bounds worst-case cost (billing is by
  // actual tokens), while a tight cap truncates the JSON mid-array — that was
  // exactly the "bad_ai_response" failure mode. thinkingBudget: 0 explicitly
  // disables thinking so reasoning tokens can never eat the output budget.
  const result = await callGemini(SYSTEM_INSTRUCTION, prompt, undefined, {
    temperature: 0,
    maxOutputTokens: Math.max(512, items.length * 128 + 256),
    thinkingBudget: 0,
  });
  if (!result.ok) {
    return new Response(JSON.stringify({ error: result.error, detail: 'detail' in result ? result.detail : undefined }), {
      status: result.status,
      headers,
    });
  }

  const parsed = safeJsonParse<unknown>(result.text, null);
  let rows: unknown[] | null = Array.isArray(parsed) ? parsed : null;
  if (!rows && parsed && typeof parsed === 'object') {
    // Some models wrap the array despite instructions: { "results": [...] }.
    const firstArray = Object.values(parsed as Record<string, unknown>).find(Array.isArray);
    if (firstArray) rows = firstArray as unknown[];
  }
  if (!rows) rows = repairTruncatedArray(result.text);
  if (!rows) {
    return new Response(
      JSON.stringify({ error: 'bad_ai_response', detail: result.text.slice(0, 300) }),
      { status: 502, headers },
    );
  }

  // Match by the echoed short alias first; fall back to positional order for
  // models that return the right rows but mangle the echo. Numeric echoes are
  // also tolerated (id: 1 instead of "1").
  const byAlias = new Map<string, Record<string, unknown>>();
  for (const row of rows) {
    if (row && typeof row === 'object' && (row as Record<string, unknown>).id !== undefined) {
      byAlias.set(String((row as Record<string, unknown>).id), row as Record<string, unknown>);
    }
  }

  const results: Array<NutritionResult | { id: string; error: string }> = items.map((item, index) => {
    const row = byAlias.get(item.alias) ?? (rows.length === items.length ? (rows[index] as Record<string, unknown>) : undefined);
    const calories = toFiniteNumber(row?.calories);
    const protein = toFiniteNumber(row?.protein);
    const carbs = toFiniteNumber(row?.carbs);
    const fat = toFiniteNumber(row?.fat);
    if (calories === null || protein === null || carbs === null || fat === null || calories <= 0) {
      return { id: item.id, error: 'invalid_values' };
    }
    return { id: item.id, calories: Math.round(calories), protein, carbs, fat };
  });

  return new Response(JSON.stringify({ ok: true, results }), { status: 200, headers });
}
