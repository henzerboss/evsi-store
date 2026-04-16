export const runtime = 'nodejs';

const FREE_MODEL = 'gemini-2.5-flash-lite';
const PREMIUM_MODEL = 'gemini-3.1-flash-lite-preview';
const ALLOWED_MODELS = new Set<string>([FREE_MODEL, PREMIUM_MODEL]);

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

interface AnalyzePayload {
  model?: string;
  contents?: unknown;
  generationConfig?: unknown;
}

export async function POST(req: Request) {
  const headers = cors(req.headers.get('origin') ?? '');
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

  const payload = (await req.json()) as AnalyzePayload;
  const model = typeof payload.model === 'string' && ALLOWED_MODELS.has(payload.model)
    ? payload.model
    : FREE_MODEL;

  const forwardPayload = {
    contents: payload.contents,
    generationConfig: payload.generationConfig,
  };

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(forwardPayload),
  });

  const text = await response.text();

  return new Response(text, {
    status: response.status,
    headers: { ...headers, 'Content-Type': 'application/json' },
  });
}