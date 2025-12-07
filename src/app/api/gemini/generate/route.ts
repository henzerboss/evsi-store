// src/app/api/gemini/generate/route.ts
export const runtime = 'nodejs'; // важно: не edge (у edge маленький лимит тела)

function cors(origin: string) {
  return {
    'Access-Control-Allow-Origin': origin || '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-Client-Token',
    'Vary': 'Origin',
  };
}

export async function OPTIONS(req: Request) {
  return new Response(null, { status: 204, headers: cors(req.headers.get('origin') ?? '') });
}

export async function POST(req: Request) {
  const headers = cors(req.headers.get('origin') ?? '');
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return new Response(JSON.stringify({ error: 'GEMINI_API_KEY missing' }), {
      status: 500, headers: { ...headers, 'Content-Type': 'application/json' },
    });
  }

  // опц. общий токен-клипса, чтобы не принимать вызовы «с улицы»
  const serverToken = process.env.SERVER_CLIENT_TOKEN;
  const clientToken = req.headers.get('x-client-token');
  if (serverToken && clientToken !== serverToken) {
    return new Response(JSON.stringify({ error: 'Forbidden' }), {
      status: 403, headers: { ...headers, 'Content-Type': 'application/json' },
    });
  }

  const payload = await req.json(); // тот же payload, что ты слал в Google
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent?key=${apiKey}`;

  const r = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  const text = await r.text(); // просто проксируем ответ
  return new Response(text, {
    status: r.status,
    headers: { ...headers, 'Content-Type': 'application/json' },
  });
}
