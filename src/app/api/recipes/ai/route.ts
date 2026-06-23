
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

export const runtime = 'nodejs';

type Locale = 'en' | 'ru';

const RecipeRequestSchema = z.object({
  feature: z.enum(['recipe_generate', 'recipe_refine', 'scan_image', 'scan_audio', 'meal_plan']),
  locale: z.enum(['en', 'ru']).default('en'),
  products: z.array(z.string()).default([]),
  filters: z.record(z.string(), z.unknown()).default({}),
  profile: z.record(z.string(), z.unknown()).default({}),
  currentRecipe: z.record(z.string(), z.unknown()).optional(),
  instruction: z.string().optional(),
  imageBase64: z.string().optional(),
  imageMimeType: z.string().optional(),
  audioBase64: z.string().optional(),
  audioMimeType: z.string().optional(),
});

function cors(origin: string) {
  return {
    'Access-Control-Allow-Origin': origin || '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-Client-Token, X-RevenueCat-App-User-Id',
    'Vary': 'Origin',
  };
}

export async function OPTIONS(req: NextRequest) {
  return new Response(null, { status: 204, headers: cors(req.headers.get('origin') ?? '') });
}


type RevenueCatSubscriberResponse = {
  subscriber?: {
    entitlements?: Record<string, { expires_date?: string | null }>;
  };
};

type GeminiInlinePart = {
  inline_data: {
    mime_type: string;
    data: string;
  };
};

type GeminiTextPart = { text: string };
type GeminiPart = GeminiTextPart | GeminiInlinePart;

type GeminiResponse = {
  candidates?: Array<{
    content?: {
      parts?: Array<{ text?: string }>;
    };
  }>;
};

async function validateRevenueCatEntitlement(appUserId: string | null) {
  if (process.env.RECIPE_AI_REQUIRE_REVENUECAT !== 'true') return true;
  if (!appUserId) return false;
  const secret = process.env.REVENUECAT_SECRET_API_KEY;
  const entitlement = process.env.RECIPE_AI_REVENUECAT_ENTITLEMENT || 'premium';
  if (!secret) return false;

  const response = await fetch(`https://api.revenuecat.com/v1/subscribers/${encodeURIComponent(appUserId)}`, {
    headers: { Authorization: `Bearer ${secret}` },
    cache: 'no-store',
  });
  if (!response.ok) return false;
  const json = (await response.json()) as RevenueCatSubscriberResponse;
  const expiresDate = json.subscriber?.entitlements?.[entitlement]?.expires_date;
  if (expiresDate === null) return true;
  return typeof expiresDate === 'string' && new Date(expiresDate).getTime() > Date.now();
}

function languageName(locale: Locale) {
  return locale === 'ru' ? 'Russian' : 'English';
}

function systemPrompt(locale: Locale) {
  return `You are a cooking AI assistant for a local-first recipe diary app.
Return valid JSON only. Do not wrap the answer in markdown.
The response language must be ${languageName(locale)}.

Core rules:
- Respect the user's available products, equipment, allergies, contraindications, disliked foods, budget mode, diet modes, serving count and cooking level.
- Do not moralize about health. Apply diet and budget filters neutrally.
- Never include ingredients that conflict with the user's allergies or explicit contraindications.
- Mark every recipe as one of: verified, adapted, generated.
- Use verified only for a traditional or widely-known dish that is not meaningfully changed.
- Use adapted when you modify a known dish for the user's pantry, equipment, diet, budget, time or serving count.
- Use generated when you create a new recipe idea from the available products.
- If only 1-2 ingredients are missing, fill missingItems and use status almost_ready.
- If all required ingredients are available, use status can_cook_now.
- If more than 2 important ingredients are missing, use status needs_shopping.
- Explain why the recipe was suggested in the why array.
- For beginner cooking level, make steps explicit and practical.
- For confident cooking level, steps may be shorter but still safe and clear.
- Do not invent medical certainty or claim professional medical advice.
- Keep quantities realistic for the requested serving count.
- Prefer common household ingredients unless the user allows non-budget or special ingredients.
- If a photo/audio scan is uncertain, include a short uncertainty note in message and return the most likely products only.`;
}

function responseShape() {
  return `Return JSON in one of these shapes. All user-facing strings must be written in the requested response language.
For recipe_generate or meal_plan:
{"recipes":[{"id":"string","title":"localized recipe title","subtitle":"localized subtitle","kind":"verified|adapted|generated","status":"can_cook_now|almost_ready|needs_shopping","timeMinutes":30,"difficulty":"easy|medium|hard","servings":2,"cuisine":"localized cuisine name","missingItems":["localized ingredient name"],"matchScore":90,"why":["localized reason"],"ingredients":[{"name":"localized ingredient name","amount":"localized amount","required":true,"available":true,"canSubstitute":false}],"steps":["localized cooking step"],"substitutions":["localized substitution"],"calories":420,"protein":25,"carbs":40,"fat":18,"source":"ai","createdAt":"ISO_DATE"}]}
For recipe_refine:
{"recipe":{same recipe object}}
For scan_image or scan_audio:
{"products":["localized ingredient names"],"message":"localized short message"}`;
}

function numberFromUnknown(value: unknown, fallback: number) {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function mockResponse(payload: z.infer<typeof RecipeRequestSchema>) {
  const now = new Date().toISOString();
  if (payload.feature === 'scan_image' || payload.feature === 'scan_audio') {
    return NextResponse.json({ products: payload.locale === 'ru' ? ['курица', 'рис', 'помидоры', 'сыр'] : ['chicken', 'rice', 'tomatoes', 'cheese'], message: 'mock' });
  }
  const title = payload.locale === 'ru' ? 'Быстрый ужин из ваших продуктов' : 'Quick dinner from your pantry';
  const steps = payload.locale === 'ru' ? ['Подготовьте продукты.', 'Обжарьте основу на сковороде.', 'Добавьте остальные ингредиенты и доведите до готовности.'] : ['Prepare ingredients.', 'Cook the base in a skillet.', 'Add remaining ingredients and finish cooking.'];
  const recipe = { id: `recipe_${Date.now()}`, title, kind: payload.feature === 'recipe_refine' ? 'adapted' : 'generated', status: 'can_cook_now', timeMinutes: 25, difficulty: 'easy', servings: numberFromUnknown(payload.filters.servings, 2), missingItems: [], matchScore: 88, why: ['mock'], ingredients: payload.products.map((name: string) => ({ name, required: true, available: true })), steps, substitutions: [], source: 'ai', createdAt: now };
  return NextResponse.json(payload.feature === 'recipe_refine' ? { recipe } : { recipes: [recipe] });
}

export async function POST(req: NextRequest) {
  const headers = cors(req.headers.get('origin') ?? '');
  try {
    const serverToken = process.env.SERVER_CLIENT_TOKEN || process.env.RECIPE_AI_CLIENT_TOKEN;
    const clientToken = req.headers.get('x-client-token');
    const requireClientToken = process.env.RECIPE_AI_REQUIRE_CLIENT_TOKEN === 'true';
    if (requireClientToken && serverToken && clientToken !== serverToken) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403, headers });
    }

    const body = await req.json();
    const payload = RecipeRequestSchema.parse(body);

    const appUserId = req.headers.get('x-revenuecat-app-user-id') || null;
    const rcOk = await validateRevenueCatEntitlement(appUserId);
    if (!rcOk) {
      return NextResponse.json({ error: 'Premium entitlement required' }, { status: 402, headers });
    }

    if (process.env.RECIPE_AI_MOCKS_ENABLED === 'true') return mockResponse(payload);

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ error: 'GEMINI_API_KEY missing' }, { status: 500, headers });
    }

    const userText = JSON.stringify({
      feature: payload.feature,
      products: payload.products,
      filters: payload.filters,
      profile: payload.profile,
      currentRecipe: payload.currentRecipe,
      instruction: payload.instruction,
      responseShape: responseShape(),
    });

    const parts: GeminiPart[] = [
      { text: systemPrompt(payload.locale) },
      { text: userText },
    ];
    if (payload.imageBase64) {
      parts.push({ inline_data: { mime_type: payload.imageMimeType || 'image/jpeg', data: payload.imageBase64 } });
    }
    if (payload.audioBase64) {
      parts.push({ inline_data: { mime_type: payload.audioMimeType || 'audio/m4a', data: payload.audioBase64 } });
    }

    const url = `https://generativelanguage.googleapis.com/v1beta/models/${process.env.RECIPE_AI_GEMINI_MODEL || 'gemini-2.5-flash-lite'}:generateContent?key=${apiKey}`;
    const geminiResponse = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ role: 'user', parts }],
        generationConfig: {
          temperature: 0.55,
          responseMimeType: 'application/json',
        },
      }),
    });

    const json = (await geminiResponse.json()) as GeminiResponse;
    if (!geminiResponse.ok) {
      return NextResponse.json({ error: 'Gemini request failed', details: json }, { status: geminiResponse.status, headers });
    }
    const text = json?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) return NextResponse.json({ error: 'Empty Gemini response', raw: json }, { status: 502, headers });

    let parsed: unknown;
    try { parsed = JSON.parse(text); }
    catch { return NextResponse.json({ error: 'AI returned invalid JSON', raw: text }, { status: 502, headers }); }

    return NextResponse.json(parsed, { headers });
  } catch (error) {
    console.error('[recipe-ai]', error);
    return NextResponse.json({ error: 'Bad request', details: String(error) }, { status: 400, headers });
  }
}
