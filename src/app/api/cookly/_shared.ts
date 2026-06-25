/**
 * Shared helpers for the Cookly AI routes.
 * Proxies Google Gemini using the recipe-specific key, mirrors the project's
 * existing gemini routes (nodejs runtime, CORS, X-Client-Token, rate limit).
 */

/**
 * Model fallback chain. Each model is tried twice (with a short delay) before moving
 * to the next; if all attempts fail, the route returns an error the app localizes.
 * Configurable via env: COOKLY_MODELS="gemini-2.5-flash-lite,gemini-3.1-flash-lite".
 */
export const COOKLY_MODELS: string[] = (process.env.COOKLY_MODELS ?? 'gemini-2.5-flash-lite,gemini-3.1-flash-lite')
  .split(',')
  .map((m) => m.trim())
  .filter(Boolean); 

export const COOKLY_MODEL = COOKLY_MODELS[0];

// Generation tuning — all overridable from the server .env.
const TEMPERATURE = parseFloat(process.env.COOKLY_TEMPERATURE ?? '0.7');
const MAX_OUTPUT_TOKENS = parseInt(process.env.COOKLY_MAX_OUTPUT_TOKENS ?? '4096', 10);
const THINKING_BUDGET = parseInt(process.env.COOKLY_THINKING_BUDGET ?? '0', 10);
const ATTEMPTS_PER_MODEL = 2;
const RETRY_DELAY_MS = 100;

export function cors(origin: string) {
  return {
    'Access-Control-Allow-Origin': origin || '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-Client-Token',
    Vary: 'Origin',
  };
}

// In-memory rate limit (per IP), consistent with other routes in this project.
const rateLimitMap = new Map<string, { count: number; resetTime: number }>();
const LIMIT = 120;
const WINDOW_MS = 60 * 60 * 1000;

export function checkRateLimit(ip: string): boolean {
  const now = Date.now();
  const rec = rateLimitMap.get(ip);
  if (!rec || now > rec.resetTime) {
    rateLimitMap.set(ip, { count: 1, resetTime: now + WINDOW_MS });
    return true;
  }
  if (rec.count >= LIMIT) return false;
  rec.count += 1;
  return true;
}

export interface Profile {
  appliances?: string[];
  cuisines?: string[];
  likes?: string[];
  dislikes?: string[];
  allergies?: string[];
  servings?: number;
  skill?: string;
  location?: string;
}

const LANG_NAME: Record<string, string> = { en: 'English', ru: 'Russian' };

/** Builds the system instruction enforcing locale, preferences, and JSON-only output. */
export function buildSystemInstruction(locale: string, profile: Profile): string {
  const lang = LANG_NAME[locale] ?? 'English';
  const parts: string[] = [
    `You are Cookly, a professional culinary assistant.`,
    `Respond ENTIRELY in ${lang}. All recipe titles, ingredients, and steps MUST be in ${lang}.`,
    `Return STRICT JSON only — no markdown, no backticks, no commentary.`,
  ];
  if (profile.allergies?.length)
    parts.push(`NEVER include these allergens or anything containing them: ${profile.allergies.join(', ')}.`);
  if (profile.dislikes?.length) parts.push(`Avoid these disliked foods: ${profile.dislikes.join(', ')}.`);
  if (profile.appliances?.length)
    parts.push(`The user only has these appliances; do not require others: ${profile.appliances.join(', ')}.`);
  if (profile.cuisines?.length) parts.push(`Prefer these cuisines when natural: ${profile.cuisines.join(', ')}.`);
  if (profile.skill) parts.push(`Match step detail to a ${profile.skill} cook.`);
  if (profile.servings) parts.push(`Default to ${profile.servings} servings unless specified.`);
  return parts.join(' ');
}

/**
 * For each recipe, Gemini must self-report `authenticity_percent`:
 * 100 = a fully traditional, canonical version of the dish;
 * lower values = the AI adapted/substituted ingredients or invented the dish.
 */
export const RECIPE_JSON_SHAPE = `
Each recipe object MUST have exactly:
{
  "title": string,
  "authenticity_percent": number (0-100; 100 = fully traditional/canonical, lower = adapted or invented),
  "cuisine": string,
  "description": string,
  "time_minutes": number,
  "difficulty": "easy" | "medium" | "hard",
  "servings": number,
  "ingredients": [{ "name": string, "amount": string, "have": boolean }],
  "steps": [{ "text": string, "timer_seconds": number | null }],
  "nutrition": { "calories": number, "protein": number, "carbs": number, "fat": number },
  "categories": string[]
}
Set "have": true for ingredients that are in the user's provided list, false otherwise.
For "categories": pick the most fitting from the provided known-categories list when given; you may also add one short new category if none fit. Keep 1-3 categories.`;

type GeminiPart = { text: string } | { inlineData: { mimeType: string; data: string } };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function callModelOnce(
  model: string,
  apiKey: string,
  systemInstruction: string,
  parts: GeminiPart[]
): Promise<{ ok: true; text: string } | { ok: false; status: number; error: string }> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

  // Build generationConfig from env. thinkingConfig is only sent when a budget is set
  // (and is silently ignored by models that don't support it).
  const generationConfig: Record<string, unknown> = {
    temperature: TEMPERATURE,
    maxOutputTokens: MAX_OUTPUT_TOKENS,
    responseMimeType: 'application/json',
  };
  if (THINKING_BUDGET > 0) {
    generationConfig.thinkingConfig = { thinkingBudget: THINKING_BUDGET };
  }

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: systemInstruction }] },
      contents: [{ role: 'user', parts }],
      generationConfig,
    }),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    return { ok: false, status: res.status, error: detail || `Gemini ${res.status}` };
  }
  const json: { candidates?: { content?: { parts?: { text?: string }[] } }[] } = await res.json();
  const text = json?.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
  if (!text) return { ok: false, status: 502, error: 'empty_response' };
  return { ok: true, text };
}

export async function callGemini(systemInstruction: string, userPrompt: string, imageBase64?: string) {
  const apiKey = process.env.RECIPE_GEMINI_API_KEY;
  if (!apiKey) {
    return { ok: false as const, status: 500, error: 'RECIPE_GEMINI_API_KEY missing' };
  }

  const parts: GeminiPart[] = [{ text: userPrompt }];
  if (imageBase64) {
    parts.push({ inlineData: { mimeType: 'image/jpeg', data: imageBase64 } });
  }

  // Try each model ATTEMPTS_PER_MODEL times, RETRY_DELAY_MS apart, before falling
  // through to the next model. Total attempts = models.length * ATTEMPTS_PER_MODEL
  // (e.g. 2 models × 2 = 4 attempts), per the product spec.
  let lastError = 'unavailable';
  for (const model of COOKLY_MODELS) {
    for (let attempt = 0; attempt < ATTEMPTS_PER_MODEL; attempt++) {
      try {
        const r = await callModelOnce(model, apiKey, systemInstruction, parts);
        if (r.ok) return { ok: true as const, text: r.text };
        lastError = r.error;
      } catch (e) {
        lastError = String(e);
      }
      await sleep(RETRY_DELAY_MS);
    }
  }
  // All attempts exhausted — signal a specific code the app maps to a localized message.
  return { ok: false as const, status: 503, error: 'all_models_failed', detail: lastError };
}

export function safeJsonParse<T>(text: string, fallback: T): T {
  try {
    return JSON.parse(text) as T;
  } catch {
    // Strip stray markdown fences if the model added them.
    const cleaned = text.replace(/```json|```/g, '').trim();
    try {
      return JSON.parse(cleaned) as T;
    } catch {
      return fallback;
    }
  }
}
