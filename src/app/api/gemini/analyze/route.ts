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

const fallbackModels = (primaryModel: string): string[] => {
  const models = [
    primaryModel,

    // Fallback при 503/перегрузке основной модели.
    // Формат ответа тот же, приложение обновлять не нужно.
    'gemini-2.5-flash',
  ];

  return [...new Set(models)];
};

const getBackoffMs = (response: Response, attempt: number): number => {
  const retryAfter = response.headers.get('retry-after');

  if (retryAfter) {
    const retryAfterSeconds = Number(retryAfter);

    if (Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0) {
      return retryAfterSeconds * 1000;
    }
  }

  // 1 сек, потом 2 сек
  return 1000 * Math.pow(2, attempt);
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

  for (const model of models) {
    // 1 первичный запрос + 2 retry на каждую модель
    for (let attempt = 0; attempt < 3; attempt++) {
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
          details: error instanceof Error ? error.message : String(error),
        });

        if (attempt < 2) {
          await sleep(1000 * Math.pow(2, attempt));
          continue;
        }

        break;
      }

      if (response.ok) {
        return { response, text, model };
      }

      lastResponse = response;
      lastText = text;

      // Не ретраим 400/401/403 и другие ошибки, которые не связаны с временной недоступностью
      if (!RETRYABLE_STATUSES.has(response.status)) {
        return { response, text, model };
      }

      if (attempt < 2) {
        await sleep(getBackoffMs(response, attempt));
      }
    }
  }

  return {
    response: lastResponse ?? new Response(null, { status: 503 }),
    text: lastText || JSON.stringify({ error: 'Gemini unavailable after fallback attempts' }),
    model: primaryModel,
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

      // Можно смотреть в логах/Network, какая модель реально ответила
      'X-Gemini-Model-Used': result.model,
    },
  });
}