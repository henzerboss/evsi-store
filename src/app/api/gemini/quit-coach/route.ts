// src/app/api/gemini/quit-coach/route.ts
//
// AI coach route for the QuitNic AI mobile app.
// Forwards a Gemini-style payload to Google's Generative Language API and
// returns the response verbatim. Prompt construction (incl. forcing the
// reply language) happens on the mobile client.
//
// Resilience: if the primary model fails or returns an empty answer, we
// retry the SAME model once more, then fall back to gemini-2.5-flash and
// try it up to two times. Only after all attempts fail do we return an
// error, so transient Gemini hiccups don't surface as a broken coach.
//
// Drop this file into the evsi-store project at the path above.

export const runtime = 'nodejs'; // not edge: larger body limit, simpler

// ---- rate limiting (per server instance) ---------------------------
// Two windows: a generous hourly cap and a short burst cap, both per IP.
const hourMap = new Map<string, { count: number; resetTime: number }>();
const burstMap = new Map<string, { count: number; resetTime: number }>();
const HOUR_LIMIT = 60;
const HOUR_MS = 60 * 60 * 1000;
const BURST_LIMIT = 8; // max requests
const BURST_MS = 20 * 1000; // per 20 seconds

setInterval(
  () => {
    const now = Date.now();
    for (const [ip, d] of hourMap.entries()) if (now > d.resetTime) hourMap.delete(ip);
    for (const [ip, d] of burstMap.entries()) if (now > d.resetTime) burstMap.delete(ip);
  },
  10 * 60 * 1000,
);

function bump(
  map: Map<string, { count: number; resetTime: number }>,
  ip: string,
  limit: number,
  windowMs: number,
): boolean {
  const now = Date.now();
  const e = map.get(ip);
  if (!e || now > e.resetTime) {
    map.set(ip, { count: 1, resetTime: now + windowMs });
    return true;
  }
  if (e.count >= limit) return false;
  e.count += 1;
  return true;
}

/** Allow only if BOTH the burst and hourly limits pass. */
function checkRateLimit(ip: string): boolean {
  const okBurst = bump(burstMap, ip, BURST_LIMIT, BURST_MS);
  const okHour = bump(hourMap, ip, HOUR_LIMIT, HOUR_MS);
  return okBurst && okHour;
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

/** Does a Gemini JSON response actually contain usable text? */
function hasText(data: unknown): boolean {
  if (typeof data !== 'object' || data === null) return false;
  const root = data as Record<string, unknown>;

  // Standard Gemini shape: candidates[0].content.parts[].text
  const candidates = root.candidates;
  if (Array.isArray(candidates) && candidates.length > 0) {
    const first = candidates[0];
    if (typeof first === 'object' && first !== null) {
      const content = (first as Record<string, unknown>).content;
      if (typeof content === 'object' && content !== null) {
        const parts = (content as Record<string, unknown>).parts;
        if (Array.isArray(parts)) {
          const ok = parts.some((p) => {
            if (typeof p !== 'object' || p === null) return false;
            const text = (p as Record<string, unknown>).text;
            return typeof text === 'string' && text.trim().length > 0;
          });
          if (ok) return true;
        }
      }
    }
  }

  // Some shapes return text at the top level.
  const topText = root.text;
  if (typeof topText === 'string' && topText.trim().length > 0) return true;

  return false;
}

interface Attempt {
  ok: boolean;
  status: number;
  body: string;
}

async function callGemini(model: string, apiKey: string, payload: unknown): Promise<Attempt> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
  try {
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const body = await r.text();
    let parsed: unknown = null;
    try {
      parsed = JSON.parse(body);
    } catch {
      /* non-JSON body counts as failure */
    }
    const ok = r.ok && parsed != null && hasText(parsed);
    return { ok, status: r.status, body };
  } catch {
    return { ok: false, status: 502, body: '{"error":"Upstream fetch failed"}' };
  }
}

export async function POST(req: Request) {
  const headers = cors(req.headers.get('origin') ?? '');
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...headers, 'Content-Type': 'application/json' },
    });

  const apiKey = process.env.GEMINI_API_KEY_QUITSMOKE;
  if (!apiKey) return json({ error: 'GEMINI_API_KEY_QUITSMOKE missing' }, 500);

  // Optional shared token to stop calls "from the street".
  const serverToken = process.env.SERVER_CLIENT_TOKEN;
  const clientToken = req.headers.get('x-client-token');
  if (serverToken && clientToken !== serverToken) {
    return json({ error: 'Forbidden' }, 403);
  }

  // Rate limit by client IP (burst + hourly).
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

  // Attempt ladder: primary model twice, then fallback model twice.
  const PRIMARY = 'gemini-2.5-flash-lite';
  const FALLBACK = 'gemini-2.5-flash';
  const plan: string[] = [PRIMARY, PRIMARY, FALLBACK, FALLBACK];

  let last: Attempt | null = null;
  for (const model of plan) {
    const attempt = await callGemini(model, apiKey, payload);
    last = attempt;
    if (attempt.ok) {
      return new Response(attempt.body, {
        status: 200,
        headers: { ...headers, 'Content-Type': 'application/json' },
      });
    }
    // brief backoff between attempts to ride out transient errors
    await new Promise((res) => setTimeout(res, 200));
  }

  // All attempts failed — surface the last upstream body/status for debugging.
  return new Response(last?.body ?? '{"error":"Upstream error"}', {
    status: last?.status && last.status >= 400 ? last.status : 502,
    headers: { ...headers, 'Content-Type': 'application/json' },
  });
}
