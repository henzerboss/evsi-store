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

You will receive 10 chronologically connected stop-frames from a running video, covering both legs and the phases:
- initial_contact
- midsupport
- toe_off
- terminal_swing
- max_knee_drive

Rules:
- Use the images as the only evidence for static metric estimation.
- Estimate static technique metrics conservatively.
- Do not fabricate certainty.
- Do not return dynamic metrics such as cadence, GCT, flight time, vertical oscillation, step length, or symmetry.
- Consider the supplied intensity zone Z1-Z5 when writing the conclusion: higher zones can reasonably show more range, load, and fatigue; lower zones should be interpreted as easy-effort mechanics.
- Include static upper-body and ankle metrics when visible: left_elbow_flexion_angle, right_elbow_flexion_angle, left_shoulder_extension, right_shoulder_extension, head_tilt, max_dorsiflexion, left_plantarflexion_toe_off, right_plantarflexion_toe_off.
- Return user-facing angles, not raw 2D included angles.
- Flexion metrics (knee_flexion, max_heel_recovery, swing_knee_angle, left_elbow_flexion_angle, right_elbow_flexion_angle): 0 degrees means straight; calculate as 180 - included joint angle.
- Max dorsiflexion: calculate as 90 - ankle included angle at midsupport. Example: ankle angle 72 degrees means 18 degrees dorsiflexion.
- Plantarflexion at toe-off: calculate as ankle included angle - 90. Example: ankle angle 115 degrees means 25 degrees plantarflexion.
- Lean and tilt metrics (tibia_angle, trunk_lean, pelvic_drop, head_tilt): absolute acute deviation from vertical or horizontal as named; 0 degrees means aligned.
- Extension metrics (hip_extension, left_shoulder_extension, right_shoulder_extension): estimate how far the thigh or upper arm moves behind the body relative to the trunk line.
- Foot-to-pelvis distance: horizontal distance from landing foot contact point to pelvis projection, in centimeters. If perspective prevents a reliable centimeter estimate, omit the metric.
- Coaching target norms by intensity zone:
  - Dynamic reference only, do not return these: cadence Z1 160/Z2 165/Z3 170/Z4 175/Z5 185 spm; ground contact time 260/240/220/200/180 ms; flight time 90/100/110/120/130 ms; vertical oscillation 8.5/8.0/7.5/7.0/6.5 cm; step length 0.9/1.1/1.25/1.4/1.6 m; symmetry target 0%.
  - Initial contact: foot_strike_angle 15/10/5/0/0 deg; tibia_angle 6/5/4/2/0 deg; foot_to_pelvis_distance 18/15/12/10/5 cm.
  - Midsupport: knee_flexion 42 deg; trunk_lean 3/5/7/9/12 deg; pelvic_drop max 4 deg; max_dorsiflexion 18 deg.
  - Toe-off: hip_extension 10/12/15/18/22 deg; plantarflexion 25 deg.
  - Terminal swing: max_heel_recovery 90/100/110/125/140 deg.
  - Max knee drive: hip_flexion 45/55/65/75/90 deg; swing_knee_angle 80 deg; shoulder_extension 30/40/50/60/75 deg.
  - All phases: elbow_flexion 90 deg; head_tilt 0 deg.
- Deviation severity for the conclusion: less than 10% from target is excellent, 10-30% is minor, 30-50% is moderate, more than 50% is severe.
- The conclusion field must be one structured string in the requested language with exactly these 3 titled blocks:
  1. Interpretation: explain what the data and images suggest about running technique, including objective strengths and weaknesses.
  2. Risks: mention possible injury risk only when the visible evidence supports it. If there is no reliable injury-risk signal, explicitly say that no clear injury-specific risk is visible from these frames.
  3. Recommendations: give immediate training advice, strength/mobility exercises, or running drills tied directly to the observed problem areas.
- Do not invent diagnoses, injuries, or risks. Keep the tone practical, supportive, and conservative.
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
