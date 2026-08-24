import { authorizeCalorieCounterRequest } from '@/lib/calorieCounterRequestAuth';

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
  /** Deprecated in analyze-v4. Prompts are owned by the backend. */
  prompt?: string;
  locale?: string;
  input: AnalyzeInput;
}

// --- НАЧАЛО БЛОКА RATE LIMIT ---
// Хранилище в оперативной памяти сервера
const rateLimitMap = new Map<string, { count: number; resetTime: number }>();

const LIMIT = 100; // 100 запросов
const WINDOW_MS = 60 * 60 * 1000; // 1 час
const MAX_REQUEST_BYTES = 16 * 1024 * 1024;
const MAX_MEDIA_DATA_CHARS = 14_000_000;
const MAX_TEXT_INPUT_CHARS = 50_000;

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

const buildLanguageInstruction = (locale?: string | null): string => {
  const safeLocale = sanitizeLocale(locale);
  const languageName = getLanguageName(safeLocale);

  return [
    `The user's app locale is ${safeLocale} (${languageName}).`,
    `Write only the top-level "name" and every "components[].name" in ${languageName}.`,
  ].join('\n');
};

const UNITS_INSTRUCTION = `
Units implied by keys:
- kcal: calories_per_100g
- g: protein_per_100g, fat_per_100g, carbs_per_100g, dietaryFiber, sugar, saturatedFat, monounsaturatedFat, polyunsaturatedFat
- mg: cholesterol, sodium, potassium, calcium, iron, magnesium, phosphorus, zinc, chloride, copper, manganese, vitaminC, vitaminE, caffeine, niacin, pantothenicAcid, thiamin, riboflavin, vitaminB6
- mcg: chromium, iodine, molybdenum, selenium, vitaminA, biotin, folate, vitaminB12, vitaminD, vitaminK
`;

const buildPrompt = (input: AnalyzeInput, tier?: string, locale?: string | null): string => {
  const isPremium = tier === 'premium';
  const task = input.kind === 'image'
    ? 'Analyze the entire visible meal, including sides, sauces, toppings and drinks.'
    : input.kind === 'audio'
      ? 'Transcribe mentally and analyze the entire meal mentioned, including sides, sauces, toppings and drinks.'
      : 'Analyze the entire meal described by the user, including sides, sauces, toppings and drinks.';
  const userText = input.kind === 'text' ? `User description: ${input.text}` : '';

  return [
    task,
    'Identify 1-10 meaningful edible components. A homogeneous food is one component. Separate meaningful sides and sauces; combine tiny garnishes and seasonings. Do not split absorbed cooking oil unless it is visibly separate.',
    'For each component, weight_g is serving grams; all four nutrition values are per 100 g.',
    'Component weights must cover the whole edible meal. Prefer stated amounts or counts; otherwise estimate from visible scale, food density and a dish-specific typical portion. Exclude tableware and packaging. Round weights to the nearest 5 g.',
    'If food is identifiable, provide realistic numeric estimates. If it is not identifiable, return name: null and components: [].',
    isPremium
      ? 'Also return nutrients_per_100g for the combined meal. Estimate every listed nutrient; use null only when genuinely impossible and 0 only when absent.'
      : '',
    isPremium ? UNITS_INSTRUCTION : '',
    buildLanguageInstruction(locale),
    userText,
  ].filter(Boolean).join('\n');
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

const nullableNumberSchema = { type: 'NUMBER', nullable: true } as const;
const nullableStringSchema = { type: 'STRING', nullable: true } as const;

const componentProperties = {
  name: nullableStringSchema,
  weight_g: nullableNumberSchema,
  calories_per_100g: nullableNumberSchema,
  protein_per_100g: nullableNumberSchema,
  fat_per_100g: nullableNumberSchema,
  carbs_per_100g: nullableNumberSchema,
};

const getResponseSchema = (tier?: string): Record<string, unknown> => {
  const properties: Record<string, unknown> = {
    name: nullableStringSchema,
    components: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: componentProperties,
        required: Object.keys(componentProperties),
        propertyOrdering: Object.keys(componentProperties),
      },
    },
  };

  if (normalizeTier(tier) === 'premium') {
    const nutrientProperties = Object.fromEntries(
      NUTRIENT_KEYS.map((key) => [key, nullableNumberSchema]),
    );
    properties.nutrients_per_100g = {
      type: 'OBJECT',
      properties: nutrientProperties,
      required: [...NUTRIENT_KEYS],
      propertyOrdering: [...NUTRIENT_KEYS],
    };
  }

  return {
    type: 'OBJECT',
    properties,
    required: Object.keys(properties),
    propertyOrdering: Object.keys(properties),
  };
};

type AnalyzeFoodComponent = {
  name?: string | null;
  weight_g?: number | null;
  calories_per_100g?: number | null;
  protein_per_100g?: number | null;
  fat_per_100g?: number | null;
  carbs_per_100g?: number | null;
};

type AnalyzeFoodOutput = {
  name?: string | null;
  components?: AnalyzeFoodComponent[];
  [key: string]: unknown;
};

const clampNumber = (value: unknown, maximum: number): number | null => {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  return Math.round(Math.min(maximum, Math.max(0, value)) * 10) / 10;
};

const normalizeComponent = (value: AnalyzeFoodComponent): AnalyzeFoodComponent | null => {
  const name = typeof value.name === 'string' ? value.name.trim().slice(0, 120) : '';
  const rawWeight = clampNumber(value.weight_g, 5000);
  if (!name || rawWeight === null || rawWeight <= 0) return null;

  const calories = clampNumber(value.calories_per_100g, 2000);
  const protein = clampNumber(value.protein_per_100g, 100);
  const fat = clampNumber(value.fat_per_100g, 100);
  const carbs = clampNumber(value.carbs_per_100g, 100);
  if ([calories, protein, fat, carbs].some((item) => item === null)) return null;

  return {
    name,
    weight_g: Math.max(5, Math.round(rawWeight / 5) * 5),
    calories_per_100g: calories,
    protein_per_100g: protein,
    fat_per_100g: fat,
    carbs_per_100g: carbs,
  };
};

const normalizeFood = (food: AnalyzeFoodOutput): AnalyzeFoodOutput => {
  const components = (Array.isArray(food.components) ? food.components : [])
    .slice(0, 10)
    .map(normalizeComponent)
    .filter((component): component is AnalyzeFoodComponent => component !== null);
  const weight = components.reduce((sum, component) => sum + Number(component.weight_g), 0);
  const explicitName = typeof food.name === 'string' ? food.name.trim().slice(0, 160) : '';
  const fallbackName = components.map((component) => component.name).join(', ').slice(0, 160);
  const aggregate = (key: keyof AnalyzeFoodComponent): number => {
    if (weight <= 0) return 0;
    const total = components.reduce(
      (sum, component) => sum + Number(component[key]) * Number(component.weight_g) / 100,
      0,
    );
    return Math.round(total / weight * 1000) / 10;
  };

  const normalized: AnalyzeFoodOutput = {
    name: explicitName || fallbackName || null,
    weight_g: weight,
    calories_per_100g: aggregate('calories_per_100g'),
    protein_per_100g: aggregate('protein_per_100g'),
    fat_per_100g: aggregate('fat_per_100g'),
    carbs_per_100g: aggregate('carbs_per_100g'),
    components,
  };

  if (food.nutrients_per_100g && typeof food.nutrients_per_100g === 'object') {
    const rawNutrients = food.nutrients_per_100g as Record<string, unknown>;
    normalized.nutrients_per_100g = Object.fromEntries(NUTRIENT_KEYS.map((key) => {
      const value = rawNutrients[key];
      if (value === null) return [key, null];
      return [key, clampNumber(value, 1_000_000)];
    }));
  }

  return normalized;
};

const stripJsonFence = (value: string): string => {
  const match = value.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  return (match ? match[1] : value).trim();
};

const normalizeGeminiAnalyzeEnvelope = (raw: string): string => {
  try {
    const envelope = JSON.parse(raw) as {
      candidates?: Array<{
        content?: { parts?: Array<{ text?: string }> };
      }>;
    };
    const part = envelope.candidates?.[0]?.content?.parts?.find(
      (candidatePart) => typeof candidatePart.text === 'string',
    );
    if (!part?.text) return raw;

    const food = JSON.parse(stripJsonFence(part.text)) as AnalyzeFoodOutput;
    part.text = JSON.stringify(normalizeFood(food));
    return JSON.stringify(envelope);
  } catch {
    return raw;
  }
};

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
    maxOutputTokens: readPositiveIntegerEnv('GEMINI_FREE_MAX_OUTPUT_TOKENS', 1536),
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
  const contentType = req.headers.get('content-type')?.toLowerCase() ?? '';
  const contentLength = Number(req.headers.get('content-length') ?? '0');

  if (!contentType.startsWith('application/json')) {
    return new Response(JSON.stringify({ error: 'Content-Type must be application/json' }), {
      status: 415,
      headers: { ...headers, 'Content-Type': 'application/json' },
    });
  }

  if (Number.isFinite(contentLength) && contentLength > MAX_REQUEST_BYTES) {
    return new Response(JSON.stringify({ error: 'Request payload is too large' }), {
      status: 413,
      headers: { ...headers, 'Content-Type': 'application/json' },
    });
  }

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

  const auth = await authorizeCalorieCounterRequest(req);
  if (!auth.ok) {
    return new Response(JSON.stringify({ error: auth.error }), {
      status: auth.status,
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

  if (body.input.kind === 'text') {
    if (typeof body.input.text !== 'string' || !body.input.text.trim()) {
      return new Response(JSON.stringify({ error: 'Text input is empty' }), {
        status: 400,
        headers: { ...headers, 'Content-Type': 'application/json' },
      });
    }
    if (body.input.text.length > MAX_TEXT_INPUT_CHARS) {
      return new Response(JSON.stringify({ error: 'Text input is too large' }), {
        status: 413,
        headers: { ...headers, 'Content-Type': 'application/json' },
      });
    }
  } else if (body.input.kind === 'image' || body.input.kind === 'audio') {
    const expectedMimePrefix = body.input.kind === 'image' ? 'image/' : 'audio/';
    if (
      typeof body.input.mimeType !== 'string' ||
      !body.input.mimeType.toLowerCase().startsWith(expectedMimePrefix) ||
      typeof body.input.data !== 'string' ||
      body.input.data.length === 0
    ) {
      return new Response(JSON.stringify({ error: 'Invalid media input' }), {
        status: 400,
        headers: { ...headers, 'Content-Type': 'application/json' },
      });
    }
    if (body.input.data.length > MAX_MEDIA_DATA_CHARS) {
      return new Response(JSON.stringify({ error: 'Media input is too large' }), {
        status: 413,
        headers: { ...headers, 'Content-Type': 'application/json' },
      });
    }
  } else {
    return new Response(JSON.stringify({ error: 'Unsupported input kind' }), {
      status: 400,
      headers: { ...headers, 'Content-Type': 'application/json' },
    });
  }

  const modelOrder = getModelOrder(body.tier);
  const generationSettings = getGenerationSettings(body.tier);

  const parts: Array<Record<string, unknown>> = [
    {
      // analyze-v4 owns prompts on the backend. body.prompt is intentionally ignored
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
      responseSchema: getResponseSchema(body.tier),
      maxOutputTokens: generationSettings.maxOutputTokens,
      temperature: generationSettings.temperature,
      thinkingConfig: {
        thinkingBudget: generationSettings.thinkingBudget,
      },
    },
  };

  const result = await callGeminiWithFallback(apiKey, modelOrder, payload);

  const responseText = result.response.ok
    ? normalizeGeminiAnalyzeEnvelope(result.text)
    : result.text;

  return new Response(responseText, {
    status: result.response.status,
    headers: {
      ...headers,
      'Content-Type': 'application/json',

      // Можно смотреть в Network/логах, какая модель реально ответила
      'X-Gemini-Model-Used': result.model,
      'X-Gemini-Model-Order': modelOrder.join(','),
      'X-CalorieCounterAI-Analyze-Version': 'v4.0',
    },
  });
}
