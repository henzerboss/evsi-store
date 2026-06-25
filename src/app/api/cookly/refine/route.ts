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

interface RefineBody {
  mode: 'refine';
  locale: string;
  instruction: string;
  recipe: unknown;
  profile: Profile;
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

  let body: RefineBody;
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: 'bad_request' }), { status: 400, headers });
  }

  const system = buildSystemInstruction(body.locale, body.profile ?? {});
  const userPrompt =
    `Here is an existing recipe as JSON:\n${JSON.stringify(body.recipe)}\n\n` +
    `Apply this change requested by the user: "${body.instruction}". ` +
    `Re-evaluate authenticity_percent after the change. ` +
    `${RECIPE_JSON_SHAPE} Return JSON: { "recipe": Recipe }.`;

  const result = await callGemini(system, userPrompt);
  if (!result.ok) {
    return new Response(JSON.stringify({ error: result.error }), { status: result.status, headers });
  }

  const parsed = safeJsonParse<{ recipe: unknown }>(result.text, { recipe: body.recipe });
  return new Response(JSON.stringify(parsed), { status: 200, headers });
}
