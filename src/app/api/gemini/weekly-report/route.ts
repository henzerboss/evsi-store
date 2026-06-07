export const runtime = 'nodejs';

type WeeklyReportTextInput = {
  kind: 'text';
  text: string;
};

type WeeklyReportRequestBody = {
  model?: string;
  tier?: string;
  prompt?: string;
  input?: WeeklyReportTextInput;
};

type WeeklyReportAiResult = {
  summary: {
    title: string;
    text: string;
  };
  positive_findings: string[];
  focus_areas: Array<{
    title: string;
    why: string;
    data: string;
  }>;
  recommendations: Array<{
    title: string;
    text: string;
    difficulty: 'easy' | 'medium';
    impact: 'low' | 'medium' | 'high';
  }>;
  meal_pattern_comment: {
    title: string;
    text: string;
  };
  motivation: {
    title: string;
    text: string;
  };
  data_quality_note: string;
};

const REQUEST_LIMIT = 60;
const WINDOW_MS = 60 * 60 * 1000;
const MAX_INPUT_CHARS = 80_000;
const MAX_PROMPT_CHARS = 12_000;
const MAX_ATTEMPTS_PER_MODEL = 2;
const DELAY_BETWEEN_ATTEMPTS_MS = 900;
const RETRYABLE_STATUSES = new Set([429, 500, 502, 503, 504]);

const rateLimitMap = new Map<string, { count: number; resetTime: number }>();

setInterval(() => {
  const now = Date.now();

  for (const [ip, data] of rateLimitMap.entries()) {
    if (now > data.resetTime) {
      rateLimitMap.delete(ip);
    }
  }
}, 10 * 60 * 1000);


function cors(origin: string) {
  return {
    'Access-Control-Allow-Origin': origin || '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-Client-Token',
    Vary: 'Origin',
  };
}

function jsonResponse(
  value: unknown,
  status: number,
  headers: Record<string, string>,
  extraHeaders?: Record<string, string>
) {
  return new Response(JSON.stringify(value), {
    status,
    headers: {
      ...headers,
      ...(extraHeaders ?? {}),
      'Content-Type': 'application/json',
    },
  });
}

export async function OPTIONS(req: Request) {
  return new Response(null, {
    status: 204,
    headers: cors(req.headers.get('origin') ?? ''),
  });
}

const fallbackWeeklyPrompt = `
You are a careful nutrition assistant inside a calorie tracking app.

You will receive aggregated weekly data from the app. Create a varied, human-sounding weekly report. The report should feel personalized and not like a fixed template, but it must stay concise for a mobile app.

Use only the provided data. Do not invent meals, numbers, symptoms, diagnoses, medical conditions, or user details.

Safety rules:
- Do not give medical advice or diagnose anything.
- Do not mention eating disorders unless the user explicitly provided that context, which they did not.
- Do not recommend extreme calorie restriction, fasting, detoxes, or unsafe dieting.
- Do not shame the user.
- If the data is missing or incomplete, mention the limitation gently.
- Weight changes over one week can be water, salt, training, digestion, or weighing time; describe them carefully.
- Keep the tone supportive, practical, and calm.
- Prefer concrete next actions over generic nutrition advice.
- If calories are far below the goal, avoid praising restriction; suggest balanced meals and consistency.

Return ONLY valid JSON. Do not wrap JSON in markdown. Do not add comments.
`.trim();

const WEEKLY_REPORT_RESPONSE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    summary: {
      type: 'OBJECT',
      properties: {
        title: { type: 'STRING' },
        text: { type: 'STRING' },
      },
      required: ['title', 'text'],
      propertyOrdering: ['title', 'text'],
    },
    positive_findings: {
      type: 'ARRAY',
      items: { type: 'STRING' },
    },
    focus_areas: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          title: { type: 'STRING' },
          why: { type: 'STRING' },
          data: { type: 'STRING' },
        },
        required: ['title', 'why', 'data'],
        propertyOrdering: ['title', 'why', 'data'],
      },
    },
    recommendations: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          title: { type: 'STRING' },
          text: { type: 'STRING' },
          difficulty: {
            type: 'STRING',
            enum: ['easy', 'medium'],
          },
          impact: {
            type: 'STRING',
            enum: ['low', 'medium', 'high'],
          },
        },
        required: ['title', 'text', 'difficulty', 'impact'],
        propertyOrdering: ['title', 'text', 'difficulty', 'impact'],
      },
    },
    meal_pattern_comment: {
      type: 'OBJECT',
      properties: {
        title: { type: 'STRING' },
        text: { type: 'STRING' },
      },
      required: ['title', 'text'],
      propertyOrdering: ['title', 'text'],
    },
    motivation: {
      type: 'OBJECT',
      properties: {
        title: { type: 'STRING' },
        text: { type: 'STRING' },
      },
      required: ['title', 'text'],
      propertyOrdering: ['title', 'text'],
    },
    data_quality_note: { type: 'STRING' },
  },
  required: [
    'summary',
    'positive_findings',
    'focus_areas',
    'recommendations',
    'meal_pattern_comment',
    'motivation',
    'data_quality_note',
  ],
  propertyOrdering: [
    'summary',
    'positive_findings',
    'focus_areas',
    'recommendations',
    'meal_pattern_comment',
    'motivation',
    'data_quality_note',
  ],
} as const;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const getClientIp = (req: Request): string => {
  const forwardedFor = req.headers.get('x-forwarded-for');
  return forwardedFor?.split(',')[0]?.trim() || 'unknown-ip';
};

const checkRateLimit = (ip: string) => {
  if (ip === 'unknown-ip') {
    return { allowed: true, retryAfterSeconds: 0 };
  }

  const now = Date.now();
  const record = rateLimitMap.get(ip);

  if (!record || now > record.resetTime) {
    rateLimitMap.set(ip, { count: 1, resetTime: now + WINDOW_MS });
    return { allowed: true, retryAfterSeconds: 0 };
  }

  if (record.count < REQUEST_LIMIT) {
    record.count += 1;
    return { allowed: true, retryAfterSeconds: 0 };
  }

  return {
    allowed: false,
    retryAfterSeconds: Math.max(1, Math.ceil((record.resetTime - now) / 1000)),
  };
};

const resolveModel = (tier?: string, requestedModel?: string): string => {
  if (requestedModel?.startsWith('gemini-')) {
    return requestedModel;
  }

  if (tier === 'premium') {
    return 'gemini-2.5-flash';
  }

  return 'gemini-2.5-flash-lite';
};

const fallbackModels = (primaryModel: string): string[] => {
  return [
    primaryModel,
    'gemini-2.5-flash',
    'gemini-2.5-flash-lite',
  ].filter((model, index, models) => model && models.indexOf(model) === index);
};

const stripCodeFences = (value: string): string => {
  const match = value.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  return (match ? match[1] : value).trim();
};

const extractGeminiText = (raw: unknown): string => {
  if (!raw || typeof raw !== 'object') return '';

  if ('text' in raw && typeof raw.text === 'string') {
    return raw.text;
  }

  const candidates = 'candidates' in raw && Array.isArray(raw.candidates) ? raw.candidates : [];
  const parts = candidates[0]?.content?.parts;

  if (!Array.isArray(parts)) return '';

  return parts
    .map((part: unknown) => {
      if (part && typeof part === 'object' && 'text' in part && typeof part.text === 'string') {
        return part.text;
      }
      return '';
    })
    .join('\n')
    .trim();
};

const normalizeString = (value: unknown, maxLength: number): string => {
  if (typeof value !== 'string') return '';
  const trimmed = value.trim();
  return trimmed.length > maxLength ? trimmed.slice(0, maxLength).trim() : trimmed;
};

const normalizeAiResult = (value: unknown): WeeklyReportAiResult | null => {
  if (!value || typeof value !== 'object') return null;

  const raw = value as Partial<WeeklyReportAiResult>;

  const result: WeeklyReportAiResult = {
    summary: {
      title: normalizeString(raw.summary?.title, 90),
      text: normalizeString(raw.summary?.text, 420),
    },
    positive_findings: Array.isArray(raw.positive_findings)
      ? raw.positive_findings.map((item) => normalizeString(item, 180)).filter(Boolean).slice(0, 3)
      : [],
    focus_areas: Array.isArray(raw.focus_areas)
      ? raw.focus_areas
          .map((item) => ({
            title: normalizeString(item?.title, 90),
            why: normalizeString(item?.why, 260),
            data: normalizeString(item?.data, 120),
          }))
          .filter((item) => item.title || item.why || item.data)
          .slice(0, 3)
      : [],
    recommendations: Array.isArray(raw.recommendations)
      ? raw.recommendations
          .map((item) => ({
            title: normalizeString(item?.title, 90),
            text: normalizeString(item?.text, 300),
            difficulty: (item?.difficulty === 'medium' ? 'medium' : 'easy') as 'easy' | 'medium',
            impact: (item?.impact === 'low' || item?.impact === 'high' ? item.impact : 'medium') as 'low' | 'medium' | 'high',
          }))
          .filter((item) => item.title || item.text)
          .slice(0, 4)
      : [],
    meal_pattern_comment: {
      title: normalizeString(raw.meal_pattern_comment?.title, 90),
      text: normalizeString(raw.meal_pattern_comment?.text, 300),
    },
    motivation: {
      title: normalizeString(raw.motivation?.title, 90),
      text: normalizeString(raw.motivation?.text, 320),
    },
    data_quality_note: normalizeString(raw.data_quality_note, 260),
  };

  const hasUsefulContent =
    result.summary.text ||
    result.positive_findings.length > 0 ||
    result.focus_areas.length > 0 ||
    result.recommendations.length > 0 ||
    result.meal_pattern_comment.text ||
    result.motivation.text;

  return hasUsefulContent ? result : null;
};

const parseWeeklyReportJson = (text: string): WeeklyReportAiResult | null => {
  const cleaned = stripCodeFences(text);

  try {
    return normalizeAiResult(JSON.parse(cleaned));
  } catch {
    const start = cleaned.indexOf('{');
    const end = cleaned.lastIndexOf('}');

    if (start < 0 || end <= start) return null;

    try {
      return normalizeAiResult(JSON.parse(cleaned.slice(start, end + 1)));
    } catch {
      return null;
    }
  }
};

const buildUserPrompt = (body: WeeklyReportRequestBody): string => {
  const systemPrompt = body.prompt?.trim().slice(0, MAX_PROMPT_CHARS) || fallbackWeeklyPrompt;
  const weeklyData = body.input?.text?.trim().slice(0, MAX_INPUT_CHARS) ?? '';

  return `${systemPrompt}\n\nAggregated weekly data JSON:\n${weeklyData}`;
};

const buildGeminiPayload = (body: WeeklyReportRequestBody) => ({
  contents: [
    {
      role: 'user',
      parts: [{ text: buildUserPrompt(body) }],
    },
  ],
  generationConfig: {
    temperature: 0.75,
    topP: 0.95,
    maxOutputTokens: 1800,
    responseMimeType: 'application/json',
    responseSchema: WEEKLY_REPORT_RESPONSE_SCHEMA,
  },
});

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

  for (let modelIndex = 0; modelIndex < models.length; modelIndex += 1) {
    const model = models[modelIndex];
    lastModel = model;

    for (let attempt = 0; attempt < MAX_ATTEMPTS_PER_MODEL; attempt += 1) {
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
      const shouldTryNext = RETRYABLE_STATUSES.has(response.status) || isModelUnavailable;

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
    text: lastText || JSON.stringify({ error: 'Gemini unavailable after fallback attempts', models }),
    model: lastModel,
  };
};

export async function POST(req: Request) {
  const headers = cors(req.headers.get('origin') ?? '');

  const rateLimit = checkRateLimit(getClientIp(req));
  if (!rateLimit.allowed) {
    return jsonResponse(
      { error: 'Too Many Requests', limit: REQUEST_LIMIT },
      429,
      headers,
      { 'Retry-After': String(rateLimit.retryAfterSeconds) }
    );
  }

  const apiKey = process.env.GEMINI_API_KEY;

  if (!apiKey) {
    return jsonResponse({ error: 'GEMINI_API_KEY missing' }, 500, headers);
  }

  const serverToken = process.env.SERVER_CLIENT_TOKEN;
  const clientToken = req.headers.get('x-client-token');

  if (serverToken && clientToken !== serverToken) {
    return jsonResponse({ error: 'Forbidden' }, 403, headers);
  }

  let body: WeeklyReportRequestBody;

  try {
    body = (await req.json()) as WeeklyReportRequestBody;
  } catch {
    return jsonResponse({ error: 'Invalid JSON body' }, 400, headers);
  }

  if (body.tier !== 'premium') {
    return jsonResponse({ error: 'Premium subscription required' }, 403, headers);
  }

  if (!body.input || body.input.kind !== 'text' || typeof body.input.text !== 'string') {
    return jsonResponse({ error: 'Invalid input. Weekly report expects text JSON metrics.' }, 400, headers);
  }

  if (!body.input.text.trim()) {
    return jsonResponse({ error: 'Empty weekly report metrics' }, 400, headers);
  }

  if (body.input.text.length > MAX_INPUT_CHARS) {
    return jsonResponse({ error: 'Weekly report metrics payload is too large' }, 413, headers);
  }

  const primaryModel = resolveModel(body.tier, body.model);
  const payload = buildGeminiPayload(body);
  const result = await callGeminiWithFallback(apiKey, primaryModel, payload);

  if (!result.response.ok) {
    return new Response(result.text, {
      status: result.response.status,
      headers: {
        ...headers,
        'Content-Type': 'application/json',
        'X-Gemini-Model-Used': result.model,
      },
    });
  }

  let geminiJson: unknown;

  try {
    geminiJson = JSON.parse(result.text);
  } catch {
    return jsonResponse(
      { error: 'Invalid Gemini JSON response' },
      502,
      headers,
      { 'X-Gemini-Model-Used': result.model }
    );
  }

  const responseText = extractGeminiText(geminiJson);
  const weeklyReport = parseWeeklyReportJson(responseText) ?? normalizeAiResult(geminiJson);

  if (!weeklyReport) {
    return jsonResponse(
      { error: 'Unable to parse weekly report response' },
      502,
      headers,
      { 'X-Gemini-Model-Used': result.model }
    );
  }

  return jsonResponse(weeklyReport, 200, headers, {
    'X-Gemini-Model-Used': result.model,
  });
}
