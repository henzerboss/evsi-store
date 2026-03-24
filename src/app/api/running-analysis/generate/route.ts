// src/app/api/running-analysis/generate/route.ts
export const runtime = 'nodejs'; // важно: не edge

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

type GenerateRunningAnalysisRequest = {
  analysisJson: unknown;
  language?: string;
  runnerContext?: {
    goal?: string;
    audience?: string;
    desiredStyle?: string;
  };
};

const SYSTEM_PROMPT = `
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

Important interpretation rules:
- Cadence, step timing symmetry, trunk lean, joint angles, overstriding, movement symmetry, and basic event timing are usually the most useful metrics.
- Ground contact time, flight time, stride length, and foot strike pattern may be less reliable depending on confidence and video quality.
- A mild issue should not be framed as a serious problem.
- If asymmetry is small, say it is small.
- If the data is generally good, say so.
- Give recommendations tied directly to the metrics.
- Avoid long theoretical explanations unless necessary for clarity.

You must produce valid JSON only, with no markdown and no extra commentary.

Return JSON with this exact schema:
{
  "summary": "string",
  "overall_assessment": {
    "technique_status": "efficient|generally_good|mixed|needs_attention",
    "confidence": "high|medium|low",
    "main_message": "string"
  },
  "top_findings": [
    {
      "title": "string",
      "severity": "low|medium|high",
      "confidence": "high|medium|low",
      "why_it_matters": "string",
      "evidence": ["string"],
      "recommendation": "string"
    }
  ],
  "strengths": ["string"],
  "limitations": ["string"],
  "action_plan": [
    {
      "focus": "string",
      "cue": "string",
      "drill": "string",
      "expected_benefit": "string"
    }
  ],
  "coach_note": "string"
}
`.trim();

function buildUserPrompt(input: GenerateRunningAnalysisRequest) {
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

Interpret the metrics conservatively.
Use high-confidence metrics as primary evidence.
Use low-confidence metrics only as tentative observations.
If the data quality is insufficient for a claim, mention that briefly in limitations.

Running analysis JSON:
${JSON.stringify(input.analysisJson, null, 2)}
`.trim();
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

  let body: GenerateRunningAnalysisRequest;

  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON body' }), {
      status: 400,
      headers: { ...headers, 'Content-Type': 'application/json' },
    });
  }

  if (!body?.analysisJson) {
    return new Response(JSON.stringify({ error: 'analysisJson is required' }), {
      status: 400,
      headers: { ...headers, 'Content-Type': 'application/json' },
    });
  }

  const geminiPayload = {
    systemInstruction: {
      parts: [{ text: SYSTEM_PROMPT }],
    },
    contents: [
      {
        role: 'user',
        parts: [{ text: buildUserPrompt(body) }],
      },
    ],
    generationConfig: {
      temperature: 0.4,
      responseMimeType: 'application/json',
    },
  };

  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent?key=${apiKey}`;

  const r = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(geminiPayload),
  });

  const text = await r.text();

  return new Response(text, {
    status: r.status,
    headers: { ...headers, 'Content-Type': 'application/json' },
  });
}
