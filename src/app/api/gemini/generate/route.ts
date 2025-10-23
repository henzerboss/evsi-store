// src/app/api/gemini/generate/route.ts
export const runtime = 'nodejs'; // не edge

type ModelCfg = {
  name: string;
  weight: number;        // для взвешенного раунда
  rpm: number;           // локальный таргет на инстанс (requests per minute)
};

const MODELS: ModelCfg[] = [
  { name: 'gemini-2.5-flash-lite', weight: 3, rpm: 1000 },
  { name: 'gemini-2.0-flash-lite', weight: 1, rpm: 200 },
  { name: 'gemini-2.0-flash',      weight: 1, rpm: 200 },
  { name: 'gemini-2.5-flash',      weight: 1, rpm: 250 },
];

// Раскатываем «кольцо» с учётом весов
const RING = MODELS.flatMap(m => Array.from({ length: m.weight }, () => m.name));

// Локальные счётчики запросов по моделям: minuteKey -> count
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
  return new Response(null, { status: 204, headers: cors(req.headers.get('origin') ?? '') });
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
  const cfg = MODELS.find(m => m.name === model)!;
  const key = minuteKey(model);
  const used = rpmCounters.get(key) ?? 0;
  return used < cfg.rpm;
}

function markUse(model: string) {
  const key = minuteKey(model);
  rpmCounters.set(key, (rpmCounters.get(key) ?? 0) + 1);

  // Лениво чистим старые ключи раз в какое-то время (очень дешёво)
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

export async function POST(req: Request) {
  const headers = cors(req.headers.get('origin') ?? '');
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return new Response(JSON.stringify({ error: 'GEMINI_API_KEY missing' }), {
      status: 500, headers: { ...headers, 'Content-Type': 'application/json' },
    });
  }

  // необязательная «клипса» от левых вызовов
  const serverToken = process.env.SERVER_CLIENT_TOKEN;
  const clientToken = req.headers.get('x-client-token');
  if (serverToken && clientToken !== serverToken) {
    return new Response(JSON.stringify({ error: 'Forbidden' }), {
      status: 403, headers: { ...headers, 'Content-Type': 'application/json' },
    });
  }

  let payload: any;
  try {
    payload = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: 'Bad JSON' }), {
      status: 400, headers: { ...headers, 'Content-Type': 'application/json' },
    });
  }

  // 1) Возможность форсить модель из заголовка или payload.model
  const forcedModel = (req.headers.get('x-model') || payload?.model || '').trim() || null;
  // 2) Дет-хэш для стабильного распределения без общей памяти
  const entropy =
    clientToken ||
    payload?.userId ||
    payload?.sessionId ||
    payload?.id ||
    `${Date.now()}:${Math.random()}`;

  // Чтобы не «дрожало» распределение, можно квантовать время (например, по 10 сек)
  const timeQuantum = Math.floor(Date.now() / 10_000);
  const baseIdx = hash32(`${entropy}:${timeQuantum}`) % RING.length;

  // Составим список попыток по кольцу (начиная с baseIdx)
  const tryOrder: string[] = [];
  for (let i = 0; i < RING.length; i++) {
    tryOrder.push(RING[(baseIdx + i) % RING.length]);
  }

  // Если модель форсится — используем её первой
  if (forcedModel) {
    // Подменим первую модель на принудительную, а остальное — обычный порядок без дубликатов
    const rest = tryOrder.filter(m => m !== forcedModel);
    tryOrder.splice(0, tryOrder.length, forcedModel, ...rest);
  }

  // Попытки: пропускаем модели, у которых локально исчерпан rpm, и делаем фолбэк при 429/5xx
  let lastErrorText = '';
  for (const model of tryOrder) {
    const cfg = MODELS.find(m => m.name === model)!;

    // локальный rpm-гейт
    if (!canUseModelLocally(model)) {
      continue;
    }

    const url = modelToUrl(model, apiKey);
    // Уберём служебные поля из payload, если они есть
    const bodyToSend = { ...payload };
    delete bodyToSend.model;

    // Маркируем использование перед вызовом (опционально можно переносить после 2xx)
    markUse(model);

    let r: Response;
    try {
      r = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(bodyToSend),
      });
    } catch (e: any) {
      lastErrorText = String(e?.message || e) || 'fetch failed';
      // сетевые ошибки — пробуем следующую модель
      continue;
    }

    // Если успех — просто проксируем как есть
    if (r.ok) {
      const text = await r.text();
      return new Response(text, {
        status: r.status,
        headers: { ...headers, 'Content-Type': 'application/json', 'X-Served-By-Model': model },
      });
    }

    // При 429/5xx — фолбэк к следующей модели
    if (r.status === 429 || (r.status >= 500 && r.status <= 599)) {
      lastErrorText = await r.text().catch(() => '');
      continue;
    }

    // Прочие ошибки — возвращаем сразу (скорее всего 4xx на payload)
    const text = await r.text();
    return new Response(text, {
      status: r.status,
      headers: { ...headers, 'Content-Type': 'application/json', 'X-Served-By-Model': model },
    });
  }

  // Все попытки исчерпаны
  return new Response(JSON.stringify({
    error: 'All models exhausted or unavailable',
    detail: lastErrorText || 'No upstream succeeded',
  }), {
    status: 503, headers: { ...headers, 'Content-Type': 'application/json' },
  });
}
