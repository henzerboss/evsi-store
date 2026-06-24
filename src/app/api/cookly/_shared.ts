/**
 * Shared helpers for the Cookly AI routes.
 * Proxies Google Gemini using the recipe-specific key, mirrors the project's
 * existing gemini routes (nodejs runtime, CORS, X-Client-Token, rate limit).
 */

export const COOKLY_MODEL = 'gemini-2.5-flash-lite';

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
  "nutrition": { "calories": number, "protein": number, "carbs": number, "fat": number }
}
Set "have": true for ingredients that are in the user's provided list, false otherwise.`;

export async function callGemini(systemInstruction: string, userPrompt: string, imageBase64?: string) {
  const apiKey = process.env.RECIPE_GEMINI_API_KEY;
  if (!apiKey) {
    return { ok: false as const, status: 500, error: 'RECIPE_GEMINI_API_KEY missing' };
  }

  const parts: any[] = [{ text: userPrompt }];
  if (imageBase64) {
    parts.push({ inlineData: { mimeType: 'image/jpeg', data: imageBase64 } });
  }

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${COOKLY_MODEL}:generateContent?key=${apiKey}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: systemInstruction }] },
      contents: [{ role: 'user', parts }],
      generationConfig: { temperature: 0.7, responseMimeType: 'application/json' },
    }),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    return { ok: false as const, status: res.status, error: detail || 'Gemini error' };
  }

  const json = await res.json();
  const text: string = json?.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
  return { ok: true as const, text };
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
