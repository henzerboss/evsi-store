// src/app/api/gemini/generate/route.ts
export const runtime = 'nodejs'; // не edge

type ModelCfg = {
  name: string;
  rpm: number; // локальный таргет на инстанс (requests per minute)
};

const MODEL: ModelCfg = {
  name: 'gemini-2.5-flash-lite',
  rpm: 1000,
};

// Локальные счётчики запросов по модели: minuteKey -> count
const rpmCounters = new Map<string, number>();

function cors(origin: string) {
  return {
    'Access-Control-Allow-Origin': origin || '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-Client-Token, X-Model',
    'Vary': 'Origin',
  };
}

export async function OPTIONS(req: Request) {
  return new Response(null, {
    status: 204,
    headers: cors(req.headers.get('origin') ?? ''),
  });
}

// Простой быстрый FNV-1a хеш (строка -> 32-bit)
function hash32(s: string): number {
  let h = 0x811c9dc5 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

function minuteKey(model: string, t = Date.now()) {
  const min = Math.floor(t / 60000);
  return `${model}:${min}`;
}

function canUseModelLocally(model: string): boolean {
  if (model !== MODEL.name) return false;
  const key = minuteKey(model);
  const used = rpmCounters.get(key) ?? 0;
  return used < MODEL.rpm;
}

function markUse(model: string) {
  const key = minuteKey(model);
  rpmCounters.set(key, (rpmCounters.get(key) ?? 0) + 1);

  // Лениво чистим старые ключи
  if (rpmCounters.size > 5000) {
    const thisMin = Math.floor(Date.now() / 60000);
    for (const k of rpmCounters.keys()) {
      const [, minStr] = k.split(':');
      if (Number(minStr) < thisMin - 1) rpmCounters.delete(k);
    }
  }
}

function modelToUrl(model: string, apiKey: string) {
  return `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
}

// Базовый «свободный» тип для тела запроса к Gemini
type GeminiPayload = Record<string, unknown>;

export async function POST(req: Request) {
  const headers = cors(req.headers.get('origin') ?? '');
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return new Response(JSON.stringify({ error: 'GEMINI_API_KEY missing' }), {
      status: 500,
      headers: { ...headers, 'Content-Type': 'application/json' },
    });
  }

  // необязательная «клипса» от левых вызовов
  const serverToken = process.env.SERVER_CLIENT_TOKEN;
  const clientToken = req.headers.get('x-client-token');
  if (serverToken && clientToken !== serverToken) {
    return new Response(JSON.stringify({ error: 'Forbidden' }), {
      status: 403,
      headers: { ...headers, 'Content-Type': 'application/json' },
    });
  }

  let payload: GeminiPayload;
  try {
    const parsed = (await req.json()) as unknown;
    if (parsed && typeof parsed === 'object') {
      payload = parsed as GeminiPayload;
    } else {
      return new Response(
        JSON.stringify({ error: 'Bad JSON: object expected' }),
        {
          status: 400,
          headers: { ...headers, 'Content-Type': 'application/json' },
        },
      );
    }
  } catch {
    return new Response(JSON.stringify({ error: 'Bad JSON' }), {
      status: 400,
      headers: { ...headers, 'Content-Type': 'application/json' },
    });
  }

  // Возможность форсить модель из заголовка или payload.model
  const headerModel = (req.headers.get('x-model') || '').trim();
  const payloadModelVal = payload?.model;
  const payloadModel =
    typeof payloadModelVal === 'string' ? payloadModelVal.trim() : '';
  const forcedModel = (headerModel || payloadModel) || null;

  // Разрешаем только одну модель
  if (forcedModel && forcedModel !== MODEL.name) {
    return new Response(
      JSON.stringify({
        error: 'Unsupported model',
        supported: [MODEL.name],
      }),
      {
        status: 400,
        headers: { ...headers, 'Content-Type': 'application/json' },
      },
    );
  }

  const model = MODEL.name;

  // Дет-хэш / энтропия (можно использовать для логирования, шардирования и т.п.)
  const entropy =
    clientToken ||
    (typeof payload?.userId === 'string' ? payload.userId : '') ||
    (typeof payload?.sessionId === 'string' ? payload.sessionId : '') ||
    (typeof payload?.id === 'string' ? payload.id : '') ||
    `${Date.now()}:${Math.random()}`;

  const _timeQuantum = Math.floor(Date.now() / 10_000);
  const _baseIdx = hash32(`${entropy}:${_timeQuantum}`); // оставлено как пример, но не используется

  // Локальный rpm-гейт
  if (!canUseModelLocally(model)) {
    return new Response(
      JSON.stringify({
        error: 'Rate limit exceeded for model',
        model,
      }),
      {
        status: 503,
        headers: { ...headers, 'Content-Type': 'application/json' },
      },
    );
  }

  const url = modelToUrl(model, apiKey);

  // Уберём служебное поле model из тела, если оно есть
  const bodyToSend: GeminiPayload = { ...payload };
  if ('model' in bodyToSend) {
    delete (bodyToSend as { model?: unknown }).model;
  }

  // Маркируем использование
  markUse(model);

  let upstream: Response;
  try {
    upstream = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(bodyToSend),
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return new Response(
      JSON.stringify({
        error: 'Upstream fetch failed',
        detail: msg,
      }),
      {
        status: 502,
        headers: { ...headers, 'Content-Type': 'application/json' },
      },
    );
  }

  const text = await upstream.text();

  // Просто проксируем ответ, добавив X-Served-By-Model
  return new Response(text, {
    status: upstream.status,
    headers: {
      ...headers,
      'Content-Type': 'application/json',
      'X-Served-By-Model': model,
    },
  });
}
