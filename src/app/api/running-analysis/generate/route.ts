export const runtime = 'nodejs';

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

type StaticAnalysisMetric = {
  key: string;
  value: number;
  unit: 'deg' | 'cm' | 'ms' | 'spm' | 'm' | 'pct' | 'norm';
};

type StaticAnalysisFrame = {
  order: number;
  side: 'left' | 'right';
  phaseKey: 'initial_contact' | 'midsupport' | 'toe_off' | 'terminal_swing' | 'max_knee_drive';
  eventKey: string;
  frameIndex: number;
  timestampMs: number;
  mimeType: string;
  imageBase64: string;
  localMetrics: StaticAnalysisMetric[];
};

type StaticAnalysisRequest = {
  language: string;
  prompt: string;
  selectedFrames: StaticAnalysisFrame[];
};

type GenerateRunningAnalysisRequest = {
  analysisJson?: unknown;
  language?: string;
  runnerContext?: {
    goal?: string;
    audience?: string;
    desiredStyle?: string;
  };
  staticAnalysisRequest?: StaticAnalysisRequest;
};

const STATIC_SYSTEM_PROMPT = `
You are an expert running biomechanics analyst.

You will receive 10 chronologically connected stop-frames from a running video, covering both legs and the phases:
- initial_contact
- midsupport
- toe_off
- terminal_swing
- max_knee_drive

Rules:
- Use the images as the primary evidence.
- Use localMetrics only as supporting hints.
- Estimate static technique metrics conservatively.
- Do not fabricate certainty.
- Do not return dynamic metrics such as cadence, GCT, flight time, vertical oscillation, step length, or symmetry.
- Return JSON only.

Return this exact schema:
{
  "average_sections": [
    {
      "key": "initial_contact|midsupport|toe_off|terminal_swing|max_knee_drive",
      "metrics": [
        {
          "key": "string",
          "value": 0,
          "unit": "deg|cm|norm"
        }
      ]
    }
  ],
  "conclusion": "string",
  "raw_response_json": "optional string"
}
`.trim();

const COACH_REPORT_SYSTEM_PROMPT = `
You are an experienced running coach and biomechanics analyst.

Your job is to turn structured running-analysis metrics into a clear, practical, trustworthy coaching report for a runner.

Goals:
- Explain what the data suggests about the runner's technique.
- Prioritize the 3 most important findings.
- Distinguish clearly between high-confidence findings and low-confidence estimates.
- Give practical recommendations that the runner can apply immediately.
- Keep the tone professional, supportive, and precise.
- Do not exaggerate certainty.
- Do not claim medical diagnosis.
- Do not present low-confidence metrics as facts.
- If a metric is unreliable or missing, say so briefly and move on.
- Focus on useful coaching insights, not generic filler.

You must produce valid JSON only, with no markdown and no extra commentary.
`.trim();

function buildCoachPrompt(input: GenerateRunningAnalysisRequest) {
  const language = input.language ?? 'Russian';
  const goal = input.runnerContext?.goal ?? 'improve running technique and reduce injury risk';
  const audience = input.runnerContext?.audience ?? 'recreational runner';
  const desiredStyle = input.runnerContext?.desiredStyle ?? 'concise, practical, coach-like';

  return `
Analyze this running biomechanics data and generate a coaching report.

Runner context:
- Goal: ${goal}
- Audience: ${audience}
- Desired style: ${desiredStyle}
- Language: ${language}

Running analysis JSON:
${JSON.stringify(input.analysisJson, null, 2)}
`.trim();
}

function buildStaticPrompt(input: StaticAnalysisRequest) {
  return {
    role: 'user',
    parts: [
      { text: input.prompt },
      ...input.selectedFrames.flatMap((frame) => ([
        {
          text: JSON.stringify({
            order: frame.order,
            side: frame.side,
            phaseKey: frame.phaseKey,
            eventKey: frame.eventKey,
            frameIndex: frame.frameIndex,
            timestampMs: frame.timestampMs,
            localMetrics: frame.localMetrics,
          }),
        },
        {
          inlineData: {
            mimeType: frame.mimeType,
            data: frame.imageBase64,
          },
        },
      ])),
    ],
  };
}

export async function POST(req: Request) {
  const headers = cors(req.headers.get('origin') ?? '');
  const apiKey = process.env.GEMINI_API_KEY_RUN;

  if (!apiKey) {
    return new Response(JSON.stringify({ error: 'GEMINI_API_KEY_RUN missing' }), {
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

  let body: GenerateRunningAnalysisRequest;

  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON body' }), {
      status: 400,
      headers: { ...headers, 'Content-Type': 'application/json' },
    });
  }

  const systemPrompt = body.staticAnalysisRequest ? STATIC_SYSTEM_PROMPT : COACH_REPORT_SYSTEM_PROMPT;
  const contents = body.staticAnalysisRequest
    ? [buildStaticPrompt(body.staticAnalysisRequest)]
    : [{ role: 'user', parts: [{ text: buildCoachPrompt(body) }] }];

  if (!body.staticAnalysisRequest && !body.analysisJson) {
    return new Response(JSON.stringify({ error: 'analysisJson is required' }), {
      status: 400,
      headers: { ...headers, 'Content-Type': 'application/json' },
    });
  }

  if (body.staticAnalysisRequest && body.staticAnalysisRequest.selectedFrames.length < 2) {
    return new Response(JSON.stringify({ error: 'At least 2 static-analysis frames are required' }), {
      status: 400,
      headers: { ...headers, 'Content-Type': 'application/json' },
    });
  }

  const geminiPayload = {
    systemInstruction: {
      parts: [{ text: systemPrompt }],
    },
    contents,
    generationConfig: {
      temperature: body.staticAnalysisRequest ? 0.2 : 0.4,
      responseMimeType: 'application/json',
    },
  };

  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`;

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(geminiPayload),
  });

  const text = await response.text();

  return new Response(text, {
    status: response.status,
    headers: { ...headers, 'Content-Type': 'application/json' },
  });
}
