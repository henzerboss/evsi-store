import { authorizeCalorieCounterRequest } from '@/lib/calorieCounterRequestAuth';

export const runtime = 'nodejs';
export const maxDuration = 60;

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

type MetricsLike = {
  startDate?: string;
  endDate?: string;
  dataQuality?: {
    expectedDays?: number;
    filledDays?: number;
    completeDays?: number;
    entriesCount?: number;
    hasEnoughData?: boolean;
    hasReliableMealTypes?: boolean;
    hasWaterData?: boolean;
    hasWeightData?: boolean;
    hasHealthBurnedCalories?: boolean;
    missing?: string[];
  };
  score?: {
    value?: number;
    label?: string;
  };
  nutrition?: {
    avgCalories?: number;
    avgProtein?: number;
    avgFat?: number;
    avgCarbs?: number;
    avgCaloriesDiff?: number | null;
    caloriesPercent?: number | null;
    proteinPercent?: number | null;
    fatPercent?: number | null;
    carbsPercent?: number | null;
    daysOverCalories?: number;
    daysUnderCalories?: number;
    daysWithinCaloriesRange?: number;
    daysLowProtein?: number;
  };
  foods?: {
    uniqueFoodsCount?: number;
    repeatedFoods?: Array<{ name?: string; count?: number; totalCalories?: number }>;
    topCalorieEntries?: Array<{ name?: string; calories?: number; date?: string; mealType?: string | null }>;
    topProteinEntries?: Array<{ name?: string; protein?: number; calories?: number }>;
    lateMealsCount?: number | null;
  };
  water?: {
    avgWaterMl?: number | null;
    waterGoalMl?: number | null;
    waterGoalDays?: number | null;
    waterTrackingDays?: number;
    waterPercent?: number | null;
  };
  weight?: {
    firstWeightKg?: number | null;
    lastWeightKg?: number | null;
    changeKg?: number | null;
    entriesCount?: number;
  };
};

const REQUEST_LIMIT = 60;
const WINDOW_MS = 60 * 60 * 1000;
const MAX_INPUT_CHARS = 120_000;
const MAX_REQUEST_BYTES = 512 * 1024;
const MAX_PROMPT_CHARS = 16_000;
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

const responseFormatPrompt = `
Return this exact JSON shape:
{
  "summary": { "title": "", "text": "" },
  "positive_findings": [""],
  "focus_areas": [
    { "title": "", "why": "", "data": "" }
  ],
  "recommendations": [
    { "title": "", "text": "", "difficulty": "easy", "impact": "medium" }
  ],
  "meal_pattern_comment": { "title": "", "text": "" },
  "motivation": { "title": "", "text": "" },
  "data_quality_note": ""
}

Limits:
- positive_findings: max 3 items
- focus_areas: max 3 items
- recommendations: max 4 items
- difficulty must be "easy" or "medium"
- impact must be "low", "medium", or "high"
- each title: max 70 characters
- each body text: max 220 characters
`.trim();

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
    return 'gemini-2.5-flash-lite';
  }

  return 'gemini-2.5-flash-lite';
};

const fallbackModels = (tier: string | undefined, primaryModel: string): string[] => {
  const models =
    tier === 'premium'
      ? [
          primaryModel,
          'gemini-2.5-flash-lite',
          'gemini-2.5-flash',
          'gemini-2.0-flash',
          'gemini-1.5-flash',
        ]
      : [
          primaryModel,
          'gemini-2.5-flash-lite',
          'gemini-2.5-flash',
          'gemini-2.0-flash',
          'gemini-1.5-flash',
        ];

  return models.filter((model, index) => model && models.indexOf(model) === index);
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
  const firstCandidate = candidates[0] as { content?: { parts?: Array<{ text?: string }> } } | undefined;
  const parts = firstCandidate?.content?.parts;

  if (!Array.isArray(parts)) return '';

  return parts.map((part) => part.text ?? '').join('\n').trim();
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

const parseMetrics = (text: string): MetricsLike | null => {
  try {
    const parsed = JSON.parse(text) as unknown;
    if (!parsed || typeof parsed !== 'object') return null;
    return parsed as MetricsLike;
  } catch {
    return null;
  }
};

const detectRussian = (body: WeeklyReportRequestBody): boolean => {
  const prompt = body.prompt?.toLowerCase() ?? '';
  return (
    prompt.includes('write in this language: ru') ||
    prompt.includes('write in this language: russian') ||
    prompt.includes('language: ru') ||
    prompt.includes('рус')
  );
};

const asNumber = (value: unknown): number | null => {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
};

const buildServerFallbackReport = (metrics: MetricsLike | null, isRussian: boolean): WeeklyReportAiResult => {
  const score = asNumber(metrics?.score?.value);
  const filledDays = asNumber(metrics?.dataQuality?.filledDays) ?? 0;
  const expectedDays = asNumber(metrics?.dataQuality?.expectedDays) ?? 7;
  const entriesCount = asNumber(metrics?.dataQuality?.entriesCount) ?? 0;
  const avgCalories = asNumber(metrics?.nutrition?.avgCalories);
  const avgCaloriesDiff = asNumber(metrics?.nutrition?.avgCaloriesDiff);
  const proteinPercent = asNumber(metrics?.nutrition?.proteinPercent);
  const daysOverCalories = asNumber(metrics?.nutrition?.daysOverCalories) ?? 0;
  const daysLowProtein = asNumber(metrics?.nutrition?.daysLowProtein) ?? 0;
  const uniqueFoodsCount = asNumber(metrics?.foods?.uniqueFoodsCount);
  const repeatedFood = metrics?.foods?.repeatedFoods?.[0]?.name;
  const topCalorieFood = metrics?.foods?.topCalorieEntries?.[0]?.name;
  const waterPercent = asNumber(metrics?.water?.waterPercent);
  const weightChange = asNumber(metrics?.weight?.changeKg);

  if (isRussian) {
    const positive: string[] = [];
    if (filledDays > 0) positive.push(`Вы внесли питание за ${filledDays} из ${expectedDays} дней.`);
    if (entriesCount > 0) positive.push(`В дневнике есть ${entriesCount} записей еды за неделю.`);
    if (uniqueFoodsCount !== null && uniqueFoodsCount > 0) positive.push(`Рацион включает ${uniqueFoodsCount} разных блюд.`);

    const focusAreas: WeeklyReportAiResult['focus_areas'] = [];
    if (avgCaloriesDiff !== null) {
      focusAreas.push({
        title: avgCaloriesDiff > 0 ? 'Калории выше цели' : 'Калории ниже цели',
        why: avgCaloriesDiff > 0
          ? 'Небольшое ежедневное превышение может замедлять прогресс.'
          : 'Слишком низкий калораж может ухудшать стабильность и самочувствие.',
        data: `${avgCaloriesDiff > 0 ? '+' : ''}${Math.round(avgCaloriesDiff)} ккал в среднем`,
      });
    }
    if (proteinPercent !== null && proteinPercent < 90) {
      focusAreas.push({
        title: 'Белок можно усилить',
        why: 'Белок помогает с насыщением и делает рацион устойчивее.',
        data: `${Math.round(proteinPercent)}% от цели`,
      });
    }
    if (waterPercent !== null && waterPercent < 90) {
      focusAreas.push({
        title: 'Вода ниже цели',
        why: 'Регулярное отслеживание воды делает недельный отчёт точнее.',
        data: `${Math.round(waterPercent)}% от цели`,
      });
    }

    const recommendations: WeeklyReportAiResult['recommendations'] = [
      {
        title: 'Сфокусируйтесь на одном улучшении',
        text: proteinPercent !== null && proteinPercent < 90
          ? 'Добавьте белковый продукт в один приём пищи каждый день.'
          : 'Выберите один простой шаг на неделю и повторяйте его ежедневно.',
        difficulty: 'easy',
        impact: 'medium',
      },
      {
        title: 'Заполните больше дней подряд',
        text: `Следующая цель — ${Math.min(expectedDays, filledDays + 1)} из ${expectedDays} дней с записями.`,
        difficulty: 'easy',
        impact: 'high',
      },
    ];

    if (avgCaloriesDiff !== null && avgCaloriesDiff > 0) {
      recommendations.push({
        title: 'Оставьте запас на вечер',
        text: 'Попробуйте заранее оставить 150–250 ккал на ужин или перекус.',
        difficulty: 'easy',
        impact: 'medium',
      });
    }

    return {
      summary: {
        title: score !== null ? `Индекс недели: ${Math.round(score)}/100` : 'Недельный разбор готов',
        text: avgCalories !== null
          ? `За неделю в среднем получилось ${Math.round(avgCalories)} ккал в день. Главные ориентиры — регулярность заполнения, калории и белок.`
          : 'Данных пока немного, но уже можно увидеть первые привычки и улучшить регулярность заполнения.',
      },
      positive_findings: positive.slice(0, 3),
      focus_areas: focusAreas.slice(0, 3),
      recommendations: recommendations.slice(0, 4),
      meal_pattern_comment: {
        title: 'Рацион и привычки',
        text: topCalorieFood
          ? `Самая калорийная позиция недели: ${topCalorieFood}. ${repeatedFood ? `Чаще повторялось: ${repeatedFood}.` : 'Следите за повторяющимися блюдами.'}`
          : 'Добавьте больше записей с типом приёма пищи, чтобы анализ рациона стал точнее.',
      },
      motivation: {
        title: 'Небольшой шаг на следующую неделю',
        text: 'Не нужно менять всё сразу. Один устойчивый шаг часто полезнее, чем идеальный план на один день.',
      },
      data_quality_note: weightChange !== null
        ? `Вес за неделю изменился на ${weightChange > 0 ? '+' : ''}${weightChange} кг. На коротком периоде это может быть вода, соль и время взвешивания.`
        : daysOverCalories || daysLowProtein
          ? 'Выводы основаны на заполненных днях недели. Чем регулярнее записи, тем точнее рекомендации.'
          : 'Отчёт создан по доступным данным недели.',
    };
  }

  const positive: string[] = [];
  if (filledDays > 0) positive.push(`You logged meals for ${filledDays} of ${expectedDays} days.`);
  if (entriesCount > 0) positive.push(`Your diary has ${entriesCount} food entries this week.`);
  if (uniqueFoodsCount !== null && uniqueFoodsCount > 0) positive.push(`Your week includes ${uniqueFoodsCount} different foods.`);

  const focusAreas: WeeklyReportAiResult['focus_areas'] = [];
  if (avgCaloriesDiff !== null) {
    focusAreas.push({
      title: avgCaloriesDiff > 0 ? 'Calories above target' : 'Calories below target',
      why: avgCaloriesDiff > 0
        ? 'A small daily surplus can slow progress over time.'
        : 'Very low intake can make consistency and energy harder.',
      data: `${avgCaloriesDiff > 0 ? '+' : ''}${Math.round(avgCaloriesDiff)} kcal on average`,
    });
  }
  if (proteinPercent !== null && proteinPercent < 90) {
    focusAreas.push({
      title: 'Protein can be stronger',
      why: 'Protein supports satiety and makes the plan easier to follow.',
      data: `${Math.round(proteinPercent)}% of target`,
    });
  }
  if (waterPercent !== null && waterPercent < 90) {
    focusAreas.push({
      title: 'Water is below target',
      why: 'Tracking water more regularly makes the weekly report more accurate.',
      data: `${Math.round(waterPercent)}% of target`,
    });
  }

  const recommendations: WeeklyReportAiResult['recommendations'] = [
    {
      title: 'Focus on one improvement',
      text: proteinPercent !== null && proteinPercent < 90
        ? 'Add one protein-rich food to one meal each day.'
        : 'Choose one simple habit for the week and repeat it daily.',
      difficulty: 'easy',
      impact: 'medium',
    },
    {
      title: 'Log one more day',
      text: `Next goal: ${Math.min(expectedDays, filledDays + 1)} of ${expectedDays} days with meals logged.`,
      difficulty: 'easy',
      impact: 'high',
    },
  ];

  if (avgCaloriesDiff !== null && avgCaloriesDiff > 0) {
    recommendations.push({
      title: 'Keep calories for evening',
      text: 'Try leaving 150–250 kcal for dinner or a snack in advance.',
      difficulty: 'easy',
      impact: 'medium',
    });
  }

  return {
    summary: {
      title: score !== null ? `Weekly score: ${Math.round(score)}/100` : 'Weekly review is ready',
      text: avgCalories !== null
        ? `Your average was ${Math.round(avgCalories)} kcal per day. The main signals are logging consistency, calories, and protein.`
        : 'There is not much data yet, but the first habits are already visible.',
    },
    positive_findings: positive.slice(0, 3),
    focus_areas: focusAreas.slice(0, 3),
    recommendations: recommendations.slice(0, 4),
    meal_pattern_comment: {
      title: 'Food patterns',
      text: topCalorieFood
        ? `Highest-calorie entry: ${topCalorieFood}. ${repeatedFood ? `Most repeated: ${repeatedFood}.` : 'Keep an eye on repeated foods.'}`
        : 'Add more entries with meal type to make meal pattern analysis more accurate.',
    },
    motivation: {
      title: 'One step for next week',
      text: 'You do not need to change everything at once. One repeatable step is better than a perfect one-day plan.',
    },
    data_quality_note: weightChange !== null
      ? `Weight changed by ${weightChange > 0 ? '+' : ''}${weightChange} kg this week. Short-term changes can reflect water, salt, and weighing time.`
      : daysOverCalories || daysLowProtein
        ? 'Insights are based on the logged days. More consistent logging makes recommendations more accurate.'
        : 'This report is based on available weekly data.',
  };
};

const buildUserPrompt = (body: WeeklyReportRequestBody): string => {
  const systemPrompt = body.prompt?.trim().slice(0, MAX_PROMPT_CHARS) || fallbackWeeklyPrompt;
  const weeklyData = body.input?.text?.trim().slice(0, MAX_INPUT_CHARS) ?? '';

  return `${systemPrompt}\n\n${responseFormatPrompt}\n\nAggregated weekly data JSON:\n${weeklyData}`;
};

const buildGeminiPayload = (body: WeeklyReportRequestBody) => ({
  contents: [
    {
      parts: [{ text: buildUserPrompt(body) }],
    },
  ],
  generationConfig: {
    temperature: 0.65,
    topP: 0.9,
    maxOutputTokens: 1400,
    responseMimeType: 'application/json',
    thinkingConfig: {
      thinkingBudget: 0,
    },
  },
});

const callGeminiWithFallback = async (
  apiKey: string,
  tier: string | undefined,
  primaryModel: string,
  payload: unknown
): Promise<{
  response: Response;
  text: string;
  model: string;
}> => {
  const models = fallbackModels(tier, primaryModel);

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
  const contentType = req.headers.get('content-type')?.toLowerCase() ?? '';
  const contentLength = Number(req.headers.get('content-length') ?? '0');

  if (!contentType.startsWith('application/json')) {
    return jsonResponse({ error: 'Content-Type must be application/json' }, 415, headers);
  }

  if (Number.isFinite(contentLength) && contentLength > MAX_REQUEST_BYTES) {
    return jsonResponse({ error: 'Request payload is too large' }, 413, headers);
  }

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

  const auth = await authorizeCalorieCounterRequest(req);
  if (!auth.ok) {
    return jsonResponse({ error: auth.error }, auth.status, headers);
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
  const metrics = parseMetrics(body.input.text);
  const isRussian = detectRussian(body);
  const result = await callGeminiWithFallback(apiKey, body.tier, primaryModel, payload);

  if (!result.response.ok) {
    const fallback = buildServerFallbackReport(metrics, isRussian);

    return jsonResponse(fallback, 200, headers, {
      'X-Gemini-Model-Used': result.model,
      'X-Weekly-Report-Fallback': 'gemini-unavailable',
      'X-Upstream-Status': String(result.response.status),
    });
  }

  let geminiJson: unknown;

  try {
    geminiJson = JSON.parse(result.text);
  } catch {
    const fallback = buildServerFallbackReport(metrics, isRussian);

    return jsonResponse(fallback, 200, headers, {
      'X-Gemini-Model-Used': result.model,
      'X-Weekly-Report-Fallback': 'invalid-gemini-json',
    });
  }

  const responseText = extractGeminiText(geminiJson);
  const weeklyReport = parseWeeklyReportJson(responseText) ?? normalizeAiResult(geminiJson);

  if (!weeklyReport) {
    const fallback = buildServerFallbackReport(metrics, isRussian);

    return jsonResponse(fallback, 200, headers, {
      'X-Gemini-Model-Used': result.model,
      'X-Weekly-Report-Fallback': 'parse-failed',
    });
  }

  return jsonResponse(weeklyReport, 200, headers, {
    'X-Gemini-Model-Used': result.model,
  });
}
