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

type StaticAnalysisFrame = {
  order: number;
  side: 'left' | 'right';
  phaseKey: 'initial_contact' | 'midsupport' | 'toe_off' | 'terminal_swing' | 'max_knee_drive';
  eventKey: string;
  frameIndex: number;
  timestampMs: number;
  mimeType: string;
  imageBase64: string;
};

type StaticAnalysisRequest = {
  language: string;
  intensityZone?: 'Z1' | 'Z2' | 'Z3' | 'Z4' | 'Z5' | string;
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
You will receive 10 chronologically connected stop-frames from a running video, covering specific phases (initial_contact, midsupport, toe_off, terminal_swing, max_knee_drive) and labeled with the visible side (left/right). The user will provide frame metadata and allowed metric keys.

YOUR MISSION:
Extract static technique metrics purely from visual evidence. Do not guess dynamic metrics.

CRITICAL RULES FOR METRICS:
1. NO NORM-FITTING: Read the angles exactly as they appear in the imperfect human runner. Do not adjust your estimates to match "ideal" running forms.
2. INDEPENDENT SIDES: Treat Left and Right legs as completely independent mechanical systems. Estimate the left-side metrics ONLY from left-side frames, and right-side metrics ONLY from right-side frames. Never copy values between sides.
3. MANDATORY ESTIMATION: You MUST provide your best visual estimate for every relevant metric in the phase. Only omit a metric if the specific joint/limb is completely cropped out or 100% occluded. Do not omit just because of slight blur.

ANGLE CALCULATION CHEAT SHEET:
- 0 degrees = perfectly straight/aligned (for knees, elbows, lean, tilt).
- Flexion (Knee, Elbow, Swing Knee, Heel Recovery): Calculate as \`180 - included joint angle\`.
- Dorsiflexion (Midsupport): \`90 - included ankle angle\`.
- Plantarflexion (Toe-off): \`included ankle angle - 90\`.
- Lean/Tilt/Drop: Absolute acute deviation from true vertical or horizontal.
- Extension (Hip, Shoulder): Degrees behind the vertical trunk line.
- Distance (Foot to pelvis): Horizontal distance in cm (provide best visual estimate based on shoe/body proportions).

PREFIX NAMING:
Always prefix limb metrics with \`left_\` or \`right_\` based on the frame's metadata (e.g., \`left_knee_flexion\`, \`right_shoulder_extension\`). Use general names for trunk metrics (\`trunk_lean\`, \`pelvic_drop\`, \`head_tilt\`).

CONCLUSION GUIDELINES:
Base your conclusion on your biomechanical knowledge of the user's intensity zone (Z1-Z5). Higher zones excuse more range/fatigue; lower zones should show easy effort.
Write a structured string in the requested language with exactly these 3 blocks:
1. Interpretation: Objective strengths and weaknesses based on the extracted data.
2. Risks: Mention injury risks ONLY if visible evidence strongly supports it. Otherwise, explicitly state no clear risks are visible.
3. Recommendations: Immediate, practical training advice or drills tied to the observed problems.
`.trim();

const STATIC_RESPONSE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    phases: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          phase_name: {
            type: 'STRING',
            enum: ['initial_contact', 'midsupport', 'toe_off', 'terminal_swing', 'max_knee_drive'],
          },
          metrics: {
            type: 'ARRAY',
            items: {
              type: 'OBJECT',
              properties: {
                key: { type: 'STRING' },
                value: { type: 'NUMBER' },
                unit: {
                  type: 'STRING',
                  enum: ['deg', 'cm'],
                },
              },
              required: ['key', 'value', 'unit'],
              propertyOrdering: ['key', 'value', 'unit'],
            },
          },
        },
        required: ['phase_name', 'metrics'],
        propertyOrdering: ['phase_name', 'metrics'],
      },
    },
    conclusion: { type: 'STRING' },
    raw_response_json: { type: 'STRING' },
  },
  required: ['phases', 'conclusion'],
  propertyOrdering: ['phases', 'conclusion', 'raw_response_json'],
} as const;

const COACH_REPORT_SYSTEM_PROMPT = `
You are an experienced running coach and biomechanics analyst.
Your job is to turn structured running-analysis metrics into a clear, practical, trustworthy coaching report for a runner.

Goals:

- Prioritize the 3 most important findings.
- Distinguish clearly between high-confidence findings and low-confidence estimates.
- Keep the tone professional, supportive, and precise.
- Do not exaggerate certainty.
- Do not claim medical diagnosis (pointing out potential injury risks is allowed).
- Do not present low-confidence metrics as facts.
- If a metric is unreliable or missing, say so briefly and move on.
- Focus on useful coaching insights, not generic filler.

Structure the report strictly into 3 blocks:

1. Interpretation:
Explain what the data suggests about the runner's technique.

2. Risks:
If any metrics indicate an existing injury or a likelihood of getting injured, point this out.

3. Recommendations:
Provide training recommendations, physical exercises, and/or specific running drills to improve problem areas that the runner can apply immediately.

You must produce valid JSON only, with no markdown and no extra commentary.
`.trim();

function buildCoachPrompt(input: GenerateRunningAnalysisRequest) {
  const language = input.language ?? 'English';
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
      { text: `Runner context:\n- Language: ${input.language}\n- Intensity zone: ${input.intensityZone ?? 'unknown'}\n\n${input.prompt}` },
      ...input.selectedFrames.flatMap((frame) => ([
        {
          text: JSON.stringify({
            order: frame.order,
            side: frame.side,
            phaseKey: frame.phaseKey,
            eventKey: frame.eventKey,
            frameIndex: frame.frameIndex,
            timestampMs: frame.timestampMs,
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
      temperature: body.staticAnalysisRequest ? 0 : 0.4,
      responseMimeType: 'application/json',
      ...(body.staticAnalysisRequest ? { responseSchema: STATIC_RESPONSE_SCHEMA } : {}),
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