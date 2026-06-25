export const runtime = 'nodejs';

declare const process: {
  env: Record<string, string | undefined>;
};

type AnalyzeInput =
  | { kind: 'image'; mimeType: string; data: string }
  | { kind: 'audio'; mimeType: string; data: string }
  | { kind: 'text'; text: string };

interface AnalyzeRequestBody {
  model?: string;
  tier?: string;
  /** Deprecated in analyze-v3. Prompts are owned by the backend. */
  prompt?: string;
  locale?: string;
  input: AnalyzeInput;
}

// --- НАЧАЛО БЛОКА RATE LIMIT ---
// Хранилище в оперативной памяти сервера
const rateLimitMap = new Map<string, { count: number; resetTime: number }>();

const LIMIT = 100; // 100 запросов
const WINDOW_MS = 60 * 60 * 1000; // 1 час

// Фоновая очистка старых записей каждые 10 минут
setInterval(() => {
  const now = Date.now();

  for (const [ip, data] of rateLimitMap.entries()) {
    if (now > data.resetTime) {
      rateLimitMap.delete(ip);
    }
  }
}, 10 * 60 * 1000);
// --- КОНЕЦ БЛОКА RATE LIMIT ---

function cors(origin: string) {
  return {
    'Access-Control-Allow-Origin': origin || '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-Client-Token',
    Vary: 'Origin',
  };
}

export async function OPTIONS(req: Request) {
  return new Response(null, {
    status: 204,
    headers: cors(req.headers.get('origin') ?? ''),
  });
}

const NUTRIENT_KEYS = [
  'dietaryFiber',
  'sugar',
  'saturatedFat',
  'monounsaturatedFat',
  'polyunsaturatedFat',
  'cholesterol',
  'sodium',
  'potassium',
  'calcium',
  'iron',
  'magnesium',
  'phosphorus',
  'zinc',
  'chloride',
  'chromium',
  'copper',
  'iodine',
  'manganese',
  'molybdenum',
  'selenium',
  'vitaminA',
  'thiamin',
  'riboflavin',
  'niacin',
  'pantothenicAcid',
  'vitaminB6',
  'biotin',
  'folate',
  'vitaminB12',
  'vitaminC',
  'vitaminD',
  'vitaminE',
  'vitaminK',
  'caffeine',
] as const;

const NUTRIENT_SCHEMA = NUTRIENT_KEYS.map((key) => `"${key}": null`).join(',');

const sanitizeLocale = (locale?: string | null): string => {
  const normalized = (locale || 'en').replace('_', '-').trim();

  if (!/^[a-zA-Z]{2,3}(-[a-zA-Z0-9]{2,8})?$/.test(normalized)) {
    return 'en';
  }

  return normalized;
};

const getLanguageName = (locale: string): string => {
  const languageCode = locale.split('-')[0] || 'en';

  try {
    const displayNames = new Intl.DisplayNames(['en'], { type: 'language' });
    return displayNames.of(languageCode) || languageCode;
  } catch {
    return languageCode;
  }
};

const buildLanguageInstruction = (
  locale?: string | null,
  mode: 'free' | 'premium' = 'free'
): string => {
  const safeLocale = sanitizeLocale(locale);
  const languageName = getLanguageName(safeLocale);

  const baseRules = [
    `The user's app locale is ${safeLocale} (${languageName}).`,
    mode === 'premium'
      ? `Write user-facing text values only in ${languageName}: the top-level "name" and every "components[].name".`
      : `Write user-facing text values only in ${languageName}: the top-level "name".`,
    'Do not translate JSON keys, units, numbers, boolean values, or null.',
  ];

  if (mode === 'premium') {
    return [
      ...baseRules,
      'Do not translate nutrient keys.',
      'Keep these architecture keys exactly as written: name, weight_g, calories_per_100g, protein_per_100g, fat_per_100g, carbs_per_100g, components, nutrients_per_100g.',
      `Keep every nutrient key exactly as written: ${NUTRIENT_KEYS.join(', ')}.`,
      'Use a dot as the decimal separator in numbers, even when the app language normally uses commas.',
    ].join('\n');
  }

  return [
    ...baseRules,
    'Keep these JSON keys exactly as written: name, weight_g, calories_per_100g, protein_per_100g, fat_per_100g, carbs_per_100g.',
    'Use a dot as the decimal separator in numbers, even when the app language normally uses commas.',
  ].join('\n');
};

const BASE_OUTPUT_RULES = `
Return JSON only. Do not wrap the response in Markdown.
All nutrition values must be estimates per 100 g of the final combined food/meal unless the key is weight_g.
Use numbers, not strings, for numeric values.
`;

const FREE_OUTPUT_RULES = `
${BASE_OUTPUT_RULES}
weight_g is the total estimated grams.
Use null only when the food cannot be identified.
`;

const PREMIUM_OUTPUT_RULES = `
${BASE_OUTPUT_RULES}
weight_g and components[].weight_g are total estimated grams.
Use null only when the food cannot be identified or when a premium nutrient is genuinely impossible to estimate.
`;

const FREE_SCHEMA = `{
  "name": "localized food name",
  "weight_g": 250,
  "calories_per_100g": 150,
  "protein_per_100g": 10,
  "fat_per_100g": 5,
  "carbs_per_100g": 20
}`;

const PREMIUM_SCHEMA = `{
  "name": "localized short meal name",
  "weight_g": 450,
  "calories_per_100g": 150,
  "protein_per_100g": 10,
  "fat_per_100g": 5,
  "carbs_per_100g": 20,
  "components": [
    {"name": "localized component name", "weight_g": 180},
    {"name": "localized component name", "weight_g": 160}
  ],
  "nutrients_per_100g": {${NUTRIENT_SCHEMA}}
}`;

const UNITS_INSTRUCTION = `
Units implied by keys:
- kcal: calories_per_100g
- g: protein_per_100g, fat_per_100g, carbs_per_100g, dietaryFiber, sugar, saturatedFat, monounsaturatedFat, polyunsaturatedFat
- mg: cholesterol, sodium, potassium, calcium, iron, magnesium, phosphorus, zinc, chloride, copper, manganese, vitaminC, vitaminE, caffeine, niacin, pantothenicAcid, thiamin, riboflavin, vitaminB6
- mcg: chromium, iodine, molybdenum, selenium, vitaminA, biotin, folate, vitaminB12, vitaminD, vitaminK
`;

const buildFreePrompt = (input: AnalyzeInput, locale?: string | null): string => {
  const languageInstruction = buildLanguageInstruction(locale, 'free');

  const task = (() => {
    if (input.kind === 'text') {
      return 'Analyze the food described by the user. Identify the main dish and estimate its weight in grams.';
    }

    if (input.kind === 'audio') {
      return 'Transcribe the speech mentally, analyze the mentioned food, identify the dish and estimate its weight in grams.';
    }

    return [
      'Analyze the food in the image. Identify the main dish and estimate its weight in grams.',
      'If the image contains no food but clearly shows a person or an animal, return a friendly, cute, food-related metaphorical compliment in the "name" field and set every numeric field to 0.',
    ].join('\n');
  })();

  const userText = input.kind === 'text' ? `\nUser description: ${input.text}` : '';

  return [
    task,
    languageInstruction,
    FREE_OUTPUT_RULES,
    `Use exactly this JSON shape for Free users: ${FREE_SCHEMA}`,
    'If you cannot identify food and the special image compliment case does not apply, return JSON with null values.',
    userText,
  ].join('\n\n');
};

const buildPremiumPrompt = (input: AnalyzeInput, locale?: string | null): string => {
  const languageInstruction = buildLanguageInstruction(locale, 'premium');

  const task = (() => {
    if (input.kind === 'text') {
      return 'Analyze the whole meal described by the user, not only the main dish. Include all stated or clearly implied components: main dish, side dishes, garnish, bread, sauces, toppings, snacks and drinks.';
    }

    if (input.kind === 'audio') {
      return 'Transcribe the speech mentally and analyze the whole meal mentioned, not only the main dish. Include all stated or clearly implied components: main dish, side dishes, garnish, bread, sauces, toppings, snacks and drinks.';
    }

    return 'Analyze the entire visible meal in the image, not only the main dish. Include every visible edible component: main dish, side dishes, garnish, bread, sauces, toppings, snacks and drinks.';
  })();

  const userText = input.kind === 'text' ? `\nUser description: ${input.text}` : '';

  return [
    task,
    'Estimate one combined meal entry with total weight in grams and nutrition per 100 g for the whole meal.',
    'Also estimate component weights so their sum approximately matches weight_g.',
    languageInstruction,
    PREMIUM_OUTPUT_RULES,
    UNITS_INSTRUCTION,
    `Use exactly this JSON shape for Premium users: ${PREMIUM_SCHEMA}`,
    'For nutrients_per_100g, make a best-effort estimate for every listed nutrient using typical food composition data for the identified ingredients.',
    'Prefer approximate numeric values over null when the ingredient is clear.',
    'Use 0 only when the nutrient is known to be absent, for example caffeine in a meal without coffee/tea/energy drinks/chocolate.',
    'Use null only when the ingredient or nutrient is genuinely impossible to estimate reliably.',
    userText,
  ].join('\n\n');
};

const buildPrompt = (input: AnalyzeInput, tier?: string, locale?: string | null): string => {
  if (tier === 'premium') {
    return buildPremiumPrompt(input, locale);
  }

  return buildFreePrompt(input, locale);
};

// Настройки генерации и порядок моделей берём из env, чтобы менять их без правок кода.
type AnalyzeTier = 'free' | 'premium';

interface GenerationSettings {
  maxOutputTokens: number;
  temperature: number;
  thinkingBudget: number;
}

const DEFAULT_FREE_MODEL_ORDER = ['gemini-2.5-flash-lite', 'gemini-3.1-flash-lite'];
const DEFAULT_PREMIUM_MODEL_ORDER = ['gemini-3.1-flash-lite', 'gemini-2.5-flash-lite'];

const normalizeTier = (tier?: string): AnalyzeTier =>
  tier === 'premium' ? 'premium' : 'free';

const uniqueNonEmpty = (values: string[]): string[] => [
  ...new Set(values.map((value) => value.trim()).filter(Boolean)),
];

const readModelOrderEnv = (envName: string, fallback: string[]): string[] => {
  const rawValue = process.env[envName];
  const envModels = rawValue ? uniqueNonEmpty(rawValue.split(',')) : [];

  return envModels.length > 0 ? envModels : fallback;
};

const readNumberEnv = (envName: string, fallback: number): number => {
  const rawValue = process.env[envName];

  if (!rawValue) {
    return fallback;
  }

  const parsed = Number(rawValue);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const readPositiveIntegerEnv = (envName: string, fallback: number): number => {
  const parsed = Math.trunc(readNumberEnv(envName, fallback));
  return parsed > 0 ? parsed : fallback;
};

const readNonNegativeIntegerEnv = (envName: string, fallback: number): number => {
  const parsed = Math.trunc(readNumberEnv(envName, fallback));
  return parsed >= 0 ? parsed : fallback;
};

const getModelOrder = (tier?: string): string[] => {
  const normalizedTier = normalizeTier(tier);

  if (normalizedTier === 'premium') {
    return readModelOrderEnv('GEMINI_PREMIUM_MODEL_ORDER', DEFAULT_PREMIUM_MODEL_ORDER);
  }

  return readModelOrderEnv('GEMINI_FREE_MODEL_ORDER', DEFAULT_FREE_MODEL_ORDER);
};

const getGenerationSettings = (tier?: string): GenerationSettings => {
  const normalizedTier = normalizeTier(tier);

  if (normalizedTier === 'premium') {
    return {
      maxOutputTokens: readPositiveIntegerEnv('GEMINI_PREMIUM_MAX_OUTPUT_TOKENS', 4096),
      temperature: readNumberEnv('GEMINI_PREMIUM_TEMPERATURE', 0.2),
      thinkingBudget: readNonNegativeIntegerEnv('GEMINI_PREMIUM_THINKING_BUDGET', 0),
    };
  }

  return {
    maxOutputTokens: readPositiveIntegerEnv('GEMINI_FREE_MAX_OUTPUT_TOKENS', 1024),
    temperature: readNumberEnv('GEMINI_FREE_TEMPERATURE', 0.2),
    thinkingBudget: readNonNegativeIntegerEnv('GEMINI_FREE_THINKING_BUDGET', 0),
  };
};

// --- НАЧАЛО БЛОКА GEMINI FALLBACK ---

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const RETRYABLE_STATUSES = new Set([429, 500, 502, 503, 504]);

const MAX_ATTEMPTS_PER_MODEL = 2;
const DELAY_BETWEEN_ATTEMPTS_MS = 1000;

const callGeminiWithFallback = async (
  apiKey: string,
  models: string[],
  payload: unknown
): Promise<{
  response: Response;
  text: string;
  model: string;
}> => {

  let lastResponse: Response | null = null;
  let lastText = '';
  let lastModel = models[0];

  for (let modelIndex = 0; modelIndex < models.length; modelIndex++) {
    const model = models[modelIndex];
    lastModel = model;

    for (let attempt = 0; attempt < MAX_ATTEMPTS_PER_MODEL; attempt++) {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

      let response: Response;
      let text: string;

      try {
        response = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });

        text = await response.text();
      } catch (error) {
        lastResponse = new Response(null, { status: 503 });
        lastText = JSON.stringify({
          error: 'Gemini fetch failed',
          model,
          attempt: attempt + 1,
          details: error instanceof Error ? error.message : String(error),
        });

        const hasNextAttempt = attempt < MAX_ATTEMPTS_PER_MODEL - 1;
        const hasNextModel = modelIndex < models.length - 1;

        if (hasNextAttempt || hasNextModel) {
          await sleep(DELAY_BETWEEN_ATTEMPTS_MS);
          continue;
        }

        break;
      }

      if (response.ok) {
        return { response, text, model };
      }

      lastResponse = response;
      lastText = text;

      const isModelUnavailable = response.status === 400 || response.status === 404;

      const shouldTryNext =
        RETRYABLE_STATUSES.has(response.status) || isModelUnavailable;

      if (!shouldTryNext) {
        return { response, text, model };
      }

      const hasNextAttempt = attempt < MAX_ATTEMPTS_PER_MODEL - 1;
      const hasNextModel = modelIndex < models.length - 1;

      if (hasNextAttempt || hasNextModel) {
        await sleep(DELAY_BETWEEN_ATTEMPTS_MS);
      }
    }
  }

  return {
    response: lastResponse ?? new Response(null, { status: 503 }),
    text:
      lastText ||
      JSON.stringify({
        error: 'Gemini unavailable after fallback attempts',
        models,
      }),
    model: lastModel,
  };
};

// --- КОНЕЦ БЛОКА GEMINI FALLBACK ---

export async function POST(req: Request) {
  const headers = cors(req.headers.get('origin') ?? '');

  // --- ПРОВЕРКА RATE LIMIT ---
  // В x-forwarded-for часто лежит строка вида: "clientIp, proxy1, proxy2"
  const forwardedFor = req.headers.get('x-forwarded-for');
  const ip = forwardedFor?.split(',')[0]?.trim() || 'unknown-ip';

  if (ip !== 'unknown-ip') {
    const now = Date.now();
    const record = rateLimitMap.get(ip);

    if (!record || now > record.resetTime) {
      rateLimitMap.set(ip, { count: 1, resetTime: now + WINDOW_MS });
    } else if (record.count < LIMIT) {
      record.count++;
    } else {
      return new Response(JSON.stringify({ error: 'Too Many Requests', limit: LIMIT }), {
        status: 429,
        headers: {
          ...headers,
          'Content-Type': 'application/json',
          'Retry-After': String(Math.ceil((record.resetTime - now) / 1000)),
        },
      });
    }
  }
  // --- КОНЕЦ ПРОВЕРКИ ---

  const apiKey = process.env.GEMINI_API_KEY;

  if (!apiKey) {
    return new Response(JSON.stringify({ error: 'GEMINI_API_KEY missing' }), {
      status: 500,
      headers: { ...headers, 'Content-Type': 'application/json' },
    });
  }

  const serverToken = process.env.SERVER_CLIENT_TOKEN;
  const clientToken = req.headers.get('x-client-token');

  if (serverToken && clientToken !== serverToken) {
    return new Response(JSON.stringify({ error: 'Forbidden' }), {
      status: 403,
      headers: { ...headers, 'Content-Type': 'application/json' },
    });
  }

  let body: AnalyzeRequestBody;

  try {
    body = (await req.json()) as AnalyzeRequestBody;
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON body' }), {
      status: 400,
      headers: { ...headers, 'Content-Type': 'application/json' },
    });
  }

  if (!body.input || !body.input.kind) {
    return new Response(JSON.stringify({ error: 'Invalid input' }), {
      status: 400,
      headers: { ...headers, 'Content-Type': 'application/json' },
    });
  }

  const modelOrder = getModelOrder(body.tier);
  const generationSettings = getGenerationSettings(body.tier);

  const parts: Array<Record<string, unknown>> = [
    {
      // analyze-v3 owns prompts on the backend. body.prompt is intentionally ignored
      // so current app behavior is stable and cannot drift with localization files.
      text: buildPrompt(body.input, body.tier, body.locale),
    },
  ];

  if (body.input.kind === 'image' || body.input.kind === 'audio') {
    parts.push({
      inline_data: {
        mime_type: body.input.mimeType,
        data: body.input.data,
      },
    });
  }

  const payload = {
    contents: [{ parts }],
    generationConfig: {
      responseMimeType: 'application/json',
      maxOutputTokens: generationSettings.maxOutputTokens,
      temperature: generationSettings.temperature,
      thinkingConfig: {
        thinkingBudget: generationSettings.thinkingBudget,
      },
    },
  };

  const result = await callGeminiWithFallback(apiKey, modelOrder, payload);

  return new Response(result.text, {
    status: result.response.status,
    headers: {
      ...headers,
      'Content-Type': 'application/json',

      // Можно смотреть в Network/логах, какая модель реально ответила
      'X-Gemini-Model-Used': result.model,
      'X-Gemini-Model-Order': modelOrder.join(','),
      'X-CalorieCounterAI-Analyze-Version': 'v3',
    },
  });
}
