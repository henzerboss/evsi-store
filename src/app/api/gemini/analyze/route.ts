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
const WINDOW_MS = 60 * 60 * 1000; // 1 час в миллисекундах

// Фоновая очистка старых записей каждые 10 минут, чтобы не утекала память
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
  return new Response(null, { status: 204, headers: cors(req.headers.get('origin') ?? '') });
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

export async function POST(req: Request) {
  const headers = cors(req.headers.get('origin') ?? '');
  
  // --- ПРОВЕРКА RATE LIMIT ---
  // Получаем IP-адрес. На Vercel и большинстве прокси IP лежит в заголовке x-forwarded-for
  const ip = req.headers.get('x-forwarded-for') || 'unknown-ip';

  if (ip !== 'unknown-ip') {
    const now = Date.now();
    const record = rateLimitMap.get(ip);

    if (!record || now > record.resetTime) {
      // Это первый запрос с этого IP, или прошел час с момента блокировки
      rateLimitMap.set(ip, { count: 1, resetTime: now + WINDOW_MS });
    } else if (record.count < LIMIT) {
      // Лимит еще не исчерпан
      record.count++;
    } else {
      // ЛИМИТ ПРЕВЫШЕН
      return new Response(JSON.stringify({ error: 'Too Many Requests', limit: LIMIT }), {
        status: 429,
        headers: {
          ...headers,
          'Content-Type': 'application/json',
          'Retry-After': String(Math.ceil((record.resetTime - now) / 1000)), // Подсказываем клиенту, через сколько секунд повторить
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

  const body = (await req.json()) as AnalyzeRequestBody;
  const model = resolveModel(body.tier, body.model);

  const parts: Array<Record<string, unknown>> = [{ text: buildPrompt(body.input, body.prompt) }];

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

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  const text = await response.text();
  return new Response(text, {
    status: response.status,
    headers: { ...headers, 'Content-Type': 'application/json' },
  });
}