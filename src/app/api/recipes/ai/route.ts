
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

export const runtime = 'nodejs';

type Locale = 'en' | 'ru';

const RecipeRequestSchema = z.object({
  feature: z.enum(['recipe_generate', 'recipe_refine', 'scan_image', 'scan_audio', 'meal_plan']),
  locale: z.enum(['en', 'ru']).default('en'),
  products: z.array(z.string()).default([]),
  filters: z.record(z.string(), z.any()).default({}),
  profile: z.record(z.string(), z.any()).default({}),
  currentRecipe: z.record(z.string(), z.any()).optional(),
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
  const json = await response.json();
  const expiresDate = json?.subscriber?.entitlements?.[entitlement]?.expires_date;
  if (expiresDate === null) return true;
  return typeof expiresDate === 'string' && new Date(expiresDate).getTime() > Date.now();
}

function systemPrompt(locale: Locale) {
  if (locale === 'ru') {
    return `Ты кулинарный ИИ-ассистент для приложения дневника рецептов. Отвечай только валидным JSON без markdown. Язык ответа: русский.
Требования:
- Учитывай продукты пользователя, технику, аллергии, нелюбимые продукты, бюджет, диету, порции, уровень готовки.
- Не морализируй про здоровье. Просто соблюдай фильтры.
- Маркируй рецепт: verified, adapted или generated.
- verified только для традиционного блюда без существенных изменений.
- adapted если взял известное блюдо и изменил под продукты пользователя.
- generated если придумал новый рецепт.
- Для аллергенов и противопоказаний не предлагай опасные ингредиенты.
- Возвращай practical steps, понятные новичку, если уровень beginner.
- Если не хватает 1-2 ингредиентов, заполни missingItems.
- Не выдумывай точную медицинскую информацию.`;
  }
  return `You are a cooking AI assistant for a recipe diary app. Return valid JSON only, no markdown. Response language: English.
Requirements:
- Respect user's products, equipment, allergies, dislikes, budget, diet, servings and cooking level.
- Do not moralize about health; just apply filters.
- Mark recipe as verified, adapted or generated.
- verified only for a traditional dish without meaningful changes.
- adapted if you modify a known dish for the user's pantry.
- generated if you invent a new recipe.
- Avoid allergens and contraindicated ingredients.
- Use beginner-friendly steps if cooking level is beginner.
- If only 1-2 ingredients are missing, fill missingItems.
- Do not invent medical certainty.`;
}

function responseShape(locale: Locale) {
  const title = locale === 'ru' ? 'Название рецепта' : 'Recipe title';
  return `Return JSON in one of these shapes:
For recipe_generate or meal_plan:
{"recipes":[{"id":"string","title":"${title}","subtitle":"string","kind":"verified|adapted|generated","status":"can_cook_now|almost_ready|needs_shopping","timeMinutes":30,"difficulty":"easy|medium|hard","servings":2,"cuisine":"string","missingItems":["string"],"matchScore":90,"why":["string"],"ingredients":[{"name":"string","amount":"string","required":true,"available":true,"canSubstitute":false}],"steps":["string"],"substitutions":["string"],"calories":420,"protein":25,"carbs":40,"fat":18,"source":"ai","createdAt":"ISO_DATE"}]}
For recipe_refine:
{"recipe":{same recipe object}}
For scan_image or scan_audio:
{"products":["ingredient names"],"message":"short message"}`;
}

function mockResponse(payload: z.infer<typeof RecipeRequestSchema>) {
  const now = new Date().toISOString();
  if (payload.feature === 'scan_image' || payload.feature === 'scan_audio') {
    return NextResponse.json({ products: payload.locale === 'ru' ? ['курица', 'рис', 'помидоры', 'сыр'] : ['chicken', 'rice', 'tomatoes', 'cheese'], message: 'mock' });
  }
  const title = payload.locale === 'ru' ? 'Быстрый ужин из ваших продуктов' : 'Quick dinner from your pantry';
  const steps = payload.locale === 'ru' ? ['Подготовьте продукты.', 'Обжарьте основу на сковороде.', 'Добавьте остальные ингредиенты и доведите до готовности.'] : ['Prepare ingredients.', 'Cook the base in a skillet.', 'Add remaining ingredients and finish cooking.'];
  const recipe = { id: `recipe_${Date.now()}`, title, kind: payload.feature === 'recipe_refine' ? 'adapted' : 'generated', status: 'can_cook_now', timeMinutes: 25, difficulty: 'easy', servings: payload.filters?.servings ?? 2, missingItems: [], matchScore: 88, why: ['mock'], ingredients: payload.products.map((name: string) => ({ name, required: true, available: true })), steps, substitutions: [], source: 'ai', createdAt: now };
  return NextResponse.json(payload.feature === 'recipe_refine' ? { recipe } : { recipes: [recipe] });
}

export async function POST(req: NextRequest) {
  const headers = cors(req.headers.get('origin') ?? '');
  try {
    const serverToken = process.env.SERVER_CLIENT_TOKEN || process.env.RECIPE_AI_CLIENT_TOKEN;
    const clientToken = req.headers.get('x-client-token');
    if (serverToken && clientToken !== serverToken) {
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
      responseShape: responseShape(payload.locale),
    });

    const parts: any[] = [
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

    const json = await geminiResponse.json();
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
