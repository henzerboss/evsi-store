export const runtime = 'nodejs';

type AnalyzeInput =
  | { kind: 'image'; mimeType: string; data: string }
  | { kind: 'audio'; mimeType: string; data: string }
  | { kind: 'text'; text: string };

interface AnalyzeRequestBody {
  model?: string;
  tier?: string;
  prompt?: string;
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

const buildPrompt = (input: AnalyzeInput, customPrompt?: string): string => {
  if (input.kind === 'text') {
    return `${customPrompt ?? 'Identify the food and return nutrition JSON.'}\n\nUser description: ${input.text}`;
  }

  if (input.kind === 'audio') {
    return customPrompt ?? 'Transcribe the audio, identify the food, estimate weight in grams and return JSON nutrition per 100g.';
  }

  return customPrompt ?? 'Analyze the food on the image and return JSON nutrition per 100g.';
};

// Оставляем функцию для совместимости, но фактический порядок моделей задан ниже.
const resolveModel = (tier?: string, model?: string): string => {
  if (
    tier === 'premium' ||
    model === 'gemini-3.1-flash-lite-preview' ||
    model === 'gemini-3.1-flash-lite'
  ) {
    return 'gemini-2.5-flash-lite';
  }

  return 'gemini-2.5-flash-lite';
};

// --- НАЧАЛО БЛОКА GEMINI FALLBACK ---

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const RETRYABLE_STATUSES = new Set([429, 500, 502, 503, 504]);

const MAX_ATTEMPTS_PER_MODEL = 2;
const DELAY_BETWEEN_ATTEMPTS_MS = 1000;

const fallbackModels = (primaryModel: string): string[] => {
  const models = [
    primaryModel,
    'gemini-2.5-flash-lite',
    'gemini-2.5-flash',
    'gemini-3.1-flash-lite',
  ];

  return [...new Set(models)];
};

const callGeminiWithFallback = async (
  apiKey: string,
  primaryModel: string,
  payload: unknown
): Promise<{
  response: Response;
  text: string;
  model: string;
}> => {
  const models = fallbackModels(primaryModel);

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

  const model = resolveModel(body.tier, body.model);

  const parts: Array<Record<string, unknown>> = [
    {
      text: buildPrompt(body.input, body.prompt),
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
      maxOutputTokens: 256,
      temperature: 0.4,
    },
  };

  const result = await callGeminiWithFallback(apiKey, model, payload);

  return new Response(result.text, {
    status: result.response.status,
    headers: {
      ...headers,
      'Content-Type': 'application/json',

      // Можно смотреть в Network/логах, какая модель реально ответила
      'X-Gemini-Model-Used': result.model,
    },
  });
}