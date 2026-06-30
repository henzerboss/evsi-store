import {
  cors,
  checkRateLimit,
  buildSystemInstruction,
  RECIPE_JSON_SHAPE,
  callGemini,
  safeJsonParse,
  type Profile,
} from '../_shared';

export const runtime = 'nodejs';

interface GenerateBody {
  mode: 'generate';
  locale: string;
  method: 'photo' | 'voice' | 'text' | 'pantry';
  ingredients: string[];
  imageBase64?: string;
  requestedCategories?: string[];
  knownCategories?: string[];
  /** Optional dish the user explicitly wants — at least the first recipe should target it. */
  dishName?: string;
  /** User is willing to buy missing ingredients — relaxes the "cookable right now" constraint. */
  willBuyMissing?: boolean;
  profile: Profile;
}

export async function OPTIONS(req: Request) {
  return new Response(null, { status: 204, headers: cors(req.headers.get('origin') ?? '') });
}

export async function POST(req: Request) {
  const origin = req.headers.get('origin') ?? '';
  const headers = { 'Content-Type': 'application/json', ...cors(origin) };

  // Lightweight shared-secret check, consistent with other routes.
  const token = req.headers.get('X-Client-Token');
  if (process.env.COOKLY_CLIENT_TOKEN && token !== process.env.COOKLY_CLIENT_TOKEN) {
    return new Response(JSON.stringify({ error: 'unauthorized' }), { status: 401, headers });
  }

  const ip = req.headers.get('x-forwarded-for')?.split(',')[0] ?? 'unknown';
  if (!checkRateLimit(ip)) {
    return new Response(JSON.stringify({ error: 'rate_limited' }), { status: 429, headers });
  }

  let body: GenerateBody;
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: 'bad_request' }), { status: 400, headers });
  }

  const system = buildSystemInstruction(body.locale, body.profile ?? {});

  const ingredientList = (body.ingredients ?? []).filter(Boolean).join(', ');
  const known = (body.knownCategories ?? []).filter(Boolean);
  const wanted = (body.requestedCategories ?? []).filter(Boolean);
  const categoryHint =
    (known.length ? `Known categories to choose from: ${known.join(', ')}. ` : '') +
    (wanted.length ? `The user wants to cook something in these categories: ${wanted.join(', ')} — strongly prefer recipes that fit them. ` : '');

  // Optional explicit dish the user typed on the "what are we cooking" step.
  const dish = (body.dishName ?? '').trim();
  const dishHint = dish
    ? `The user specifically wants to make "${dish}". The FIRST recipe MUST be a version of "${dish}" ` +
      `(adapt it to their ingredients if needed and reflect that in authenticity_percent). The other recipes may be related alternatives. `
    : '';

  // Whether the user will buy missing items changes how strict the "cookable now" rule is.
  const willBuy = !!body.willBuyMissing;

  // Shared quality bar applied to both photo and text/pantry generation.
  const availableList = ingredientList || '(none provided)';
  const qualityRules =
    `HARD REQUIREMENT — read carefully: The user's available ingredients are: ${availableList}. ` +
    `You may also assume ONLY these trivial seasonings are on hand: salt, black pepper, water. ` +
    `Do NOT assume anything else is available — in particular do NOT assume sugar, butter, flour, milk, ` +
    `eggs, or any cooking oil unless that exact item appears in the available list. Note that "vegetable oil" ` +
    `is NOT the same as "butter", and having one does not mean the other is available. ` +
    (willBuy
      ? `The user is willing to BUY a few missing ingredients, so recipes may include items not on hand (mark those "have": false). Still prioritize using what they already have and keep the shopping list short. `
      : `The FIRST recipe in your list MUST be fully cookable RIGHT NOW using only the available ingredients plus those three seasonings (every one of its "ingredients" must have "have": true). `) +
    `Make it a real, appetizing dish — if the available items are limited, pick the best simple classic ` +
    `that genuinely works with them (e.g. an omelette, a simple pasta, a salad), never an implausible mashup. ` +
    `Then propose 2 more recipes that may need a few extra items (mark those "have": false). ` +
    `Additional rules: never suggest unappetizing or absurd combinations; include at least one ` +
    `traditional/canonical dish with a high authenticity_percent (ideally 90-100). ` +
    `CRITICAL: set "have": true ONLY for an ingredient whose name clearly matches an item in the available ` +
    `list (or is salt/black pepper/water). For every other ingredient set "have": false. When unsure, use false. ` +
    `Quantity tolerance: if the user has a quantity of an ingredient, you may design a recipe that uses up to ~20% ` +
    `MORE than they have and still treat it as available ("have": true) — e.g. if they have 75 g cheese, a recipe ` +
    `calling for 80-90 g is fine. Only mark an ingredient as "have": false when the recipe truly needs substantially ` +
    `more than is on hand, or the ingredient is absent entirely. `;

  const userPrompt =
    body.method === 'photo' && body.imageBase64
      ? `Look at the photo of ingredients. Recognize what's there, then propose 3 recipes the user can make. ` +
        `Consider also any text ingredients: ${ingredientList || '(none)'}. ` +
        categoryHint + dishHint +
        qualityRules +
        `${RECIPE_JSON_SHAPE} ` +
        `Return JSON: { "recipes": Recipe[] } with exactly 3 recipes ordered best-first.`
      : `The user has these ingredients: ${ingredientList || '(none provided)'}. ` +
        categoryHint + dishHint +
        `Propose 3 recipes, prioritizing ones that use what they have. ` +
        qualityRules +
        `${RECIPE_JSON_SHAPE} Return JSON: { "recipes": Recipe[] } with exactly 3 recipes ordered best-first.`;

  const result = await callGemini(system, userPrompt, body.imageBase64);
  if (!result.ok) {
    return new Response(JSON.stringify({ error: result.error }), { status: result.status, headers });
  }

  const parsed = safeJsonParse<{ recipes: unknown[] }>(result.text, { recipes: [] });
  return new Response(JSON.stringify(parsed), { status: 200, headers });
}
