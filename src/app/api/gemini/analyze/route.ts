export const runtime = 'nodejs';

type AnalyzeInput =
  | { kind: 'image'; mimeType: string; data: string }
  | { kind: 'audio'; mimeType: string; data: string }
  | { kind: 'text'; text: string };

interface AnalyzeRequestBody {
  model: string;
  prompt?: string;
  input: AnalyzeInput;
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

  const body = (await req.json()) as AnalyzeRequestBody;
  const model = body.model || 'gemini-2.5-flash-lite';

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
