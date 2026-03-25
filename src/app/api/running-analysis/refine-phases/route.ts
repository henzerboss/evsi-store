// src/app/api/running-analysis/refine-phases/route.ts
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

type GeminiStridePacket = {
  analysis_version: string;
  session_id: string;
  camera_view: 'side' | 'front' | 'rear';
  fps: number;
  frame_count: number;
  video_size: {
    width: number;
    height: number;
  };
  metrics_context: {
    cadence_spm: number;
    overstriding_detected: boolean;
    overstriding_score: number;
    trunk_lean_mean_deg: number;
  };
  stride_cycles: Array<{
    side: 'left' | 'right';
    stride_index: number;
    start_frame: number;
    end_frame: number;
    duration_ms: number;
    support_duration_ms?: number;
    swing_duration_ms?: number;
    confidence: number;
    phases: Array<{
      phase_name:
        | 'initial_contact'
        | 'midsupport'
        | 'toe_off'
        | 'initial_swing'
        | 'terminal_swing';
      frame_index: number;
      timestamp_ms: number;
      confidence: number;
      candidate_window?: {
        start_frame: number;
        end_frame: number;
      };
    }>;
  }>;
};

type GeminiPhaseRefinementSchema = {
  response_type: 'stride_phase_refinement_v1';
  expected_top_level_fields: string[];
  stride_cycle_fields: string[];
  phase_fields: string[];
  allowed_phase_names: string[];
  allowed_foot_strike_types: string[];
  allowed_confidence_labels: string[];
};

type RefineRunningPhasesRequest = {
  analysisJson: unknown;
  geminiStridePacket: GeminiStridePacket;
  geminiPhasePrompt?: string;
  geminiPhaseResponseSchema?: GeminiPhaseRefinementSchema;
  language?: string;
};

const DEFAULT_SYSTEM_PROMPT = `
You are an expert running biomechanics analyst.

Your task is to refine gait phase timing for each stride cycle using structured stride-cycle data.
You must work conservatively and stay close to the provided candidate windows.

Rules:
- Refine exactly these 5 phases only:
  initial_contact, midsupport, toe_off, initial_swing, terminal_swing
- Do not invent new phases.
- Prefer small corrections within candidate windows.
- If uncertain, keep the original candidate close and lower confidence.
- Use biomechanical consistency across the stride cycle.
- Do not output prose outside JSON.
- Return valid JSON only.

Return JSON with this exact top-level shape:
{
  "response_type": "stride_phase_refinement_v1",
  "summary": "string",
  "stride_cycles": [
    {
      "side": "left|right",
      "stride_index": 0,
      "confidence": "high|medium|low",
      "observation": "string",
      "foot_strike_type": "rearfoot|midfoot|forefoot|unknown",
      "phases": [
        {
          "phase_name": "initial_contact|midsupport|toe_off|initial_swing|terminal_swing",
          "frame_index": 123,
          "confidence_label": "high|medium|low",
          "reason": "string"
        }
      ]
    }
  ]
}
`.trim();

function buildUserPrompt(input: RefineRunningPhasesRequest) {
  const language = input.language ?? 'Russian';
  const schema = input.geminiPhaseResponseSchema;

  return `
Refine running stride phases for the following stride packet.

Language for short observations: ${language}

Expected response schema guide:
${JSON.stringify(schema ?? null, null, 2)}

Analysis JSON context:
${JSON.stringify(input.analysisJson, null, 2)}

Stride packet to refine:
${JSON.stringify(input.geminiStridePacket, null, 2)}
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

  let body: RefineRunningPhasesRequest;

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

  if (!body?.geminiStridePacket) {
    return new Response(JSON.stringify({ error: 'geminiStridePacket is required' }), {
      status: 400,
      headers: { ...headers, 'Content-Type': 'application/json' },
    });
  }

  const systemPrompt = body.geminiPhasePrompt?.trim() || DEFAULT_SYSTEM_PROMPT;

  const geminiPayload = {
    systemInstruction: {
      parts: [{ text: systemPrompt }],
    },
    contents: [
      {
        role: 'user',
        parts: [{ text: buildUserPrompt(body) }],
      },
    ],
    generationConfig: {
      temperature: 0.2,
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
