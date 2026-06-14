// src/app/api/gemini/quit-coach/route.ts
//
// AI coach route for the QuitSmoke mobile app.
// Mirrors the existing /api/gemini/generate proxy: forwards a
// Gemini-style payload to Google's Generative Language API and returns
// the response verbatim. Prompt construction (incl. forcing the reply
// language) happens on the mobile client.
//
// Drop this file into the evsi-store project at the path above.

export const runtime = 'nodejs'; // not edge: larger body limit, simpler

// ---- simple in-memory rate limit (per server instance) -------------
const rateLimitMap = new Map<string, { count: number; resetTime: number }>();
const LIMIT = 60; // requests
const WINDOW_MS = 60 * 60 * 1000; // per hour, per IP

setInterval(
  () => {
    const now = Date.now();
    for (const [ip, data] of rateLimitMap.entries()) {
      if (now > data.resetTime) rateLimitMap.delete(ip);
    }
  },
  10 * 60 * 1000,
);

function checkRateLimit(ip: string): boolean {
  const now = Date.now();
  const entry = rateLimitMap.get(ip);
  if (!entry || now > entry.resetTime) {
    rateLimitMap.set(ip, { count: 1, resetTime: now + WINDOW_MS });
    return true;
  }
  if (entry.count >= LIMIT) return false;
  entry.count += 1;
  return true;
}

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

export async function POST(req: Request) {
  const headers = cors(req.headers.get('origin') ?? '');
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...headers, 'Content-Type': 'application/json' },
    });

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return json({ error: 'GEMINI_API_KEY missing' }, 500);

  // Optional shared token to stop calls "from the street".
  const serverToken = process.env.SERVER_CLIENT_TOKEN;
  const clientToken = req.headers.get('x-client-token');
  if (serverToken && clientToken !== serverToken) {
    return json({ error: 'Forbidden' }, 403);
  }

  // Rate limit by client IP.
  const ip =
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    req.headers.get('x-real-ip') ||
    'unknown';
  if (!checkRateLimit(ip)) {
    return json({ error: 'Rate limit exceeded. Try again later.' }, 429);
  }

  let payload: unknown;
  try {
    payload = await req.json();
  } catch {
    return json({ error: 'Invalid JSON' }, 400);
  }

  // Coach replies are short; use the cheap, fast model.
  const model = 'gemini-2.5-flash-lite';
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

  try {
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const text = await r.text(); // proxy Gemini's response shape verbatim
    return new Response(text, {
      status: r.status,
      headers: { ...headers, 'Content-Type': 'application/json' },
    });
  } catch (e) {
    return json({ error: 'Upstream error' }, 502);
  }
}
