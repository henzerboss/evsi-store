import { NextResponse } from 'next/server';

export const runtime = 'nodejs';

const WINDOW_MS = 15 * 60 * 1000;
const MAX_ATTEMPTS_PER_WINDOW = 10;
const MAX_CODE_LENGTH = 128;
const attempts = new Map<string, { count: number; resetAt: number }>();

const responseHeaders = {
  'Cache-Control': 'no-store',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type'
};

function normalize(value: string): string {
  return value.normalize('NFKC').trim().toLocaleLowerCase('en-US');
}

function configuredCodes(): Set<string> {
  return new Set(
    (process.env.PREMIUM_PROMO_CODES ?? '')
      .split(',')
      .map(normalize)
      .filter(Boolean)
  );
}

function clientIp(req: Request): string {
  return (
    req.headers.get('cf-connecting-ip') ||
    req.headers.get('x-real-ip') ||
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    'unknown'
  );
}

function allowAttempt(ip: string): { allowed: boolean; retryAfterSeconds: number } {
  const now = Date.now();
  const current = attempts.get(ip);
  if (!current || now >= current.resetAt) {
    attempts.set(ip, { count: 1, resetAt: now + WINDOW_MS });
    return { allowed: true, retryAfterSeconds: 0 };
  }
  if (current.count >= MAX_ATTEMPTS_PER_WINDOW) {
    return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil((current.resetAt - now) / 1000)) };
  }
  current.count += 1;
  return { allowed: true, retryAfterSeconds: 0 };
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: responseHeaders });
}

export async function POST(req: Request) {
  const rate = allowAttempt(clientIp(req));
  if (!rate.allowed) {
    return NextResponse.json(
      { valid: false, error: 'rate_limited' },
      { status: 429, headers: { ...responseHeaders, 'Retry-After': String(rate.retryAfterSeconds) } }
    );
  }

  let code = '';
  try {
    const body = await req.json() as { code?: unknown };
    if (typeof body.code === 'string') code = body.code.slice(0, MAX_CODE_LENGTH);
  } catch {
    return NextResponse.json({ valid: false, error: 'invalid_request' }, { status: 400, headers: responseHeaders });
  }

  const normalizedCode = normalize(code);
  if (!normalizedCode) {
    return NextResponse.json({ valid: false, error: 'code_required' }, { status: 400, headers: responseHeaders });
  }

  const valid = configuredCodes().has(normalizedCode);
  return NextResponse.json(
    valid
      ? { valid: true, entitlement: 'premium', lifetime: true }
      : { valid: false, error: 'invalid_code' },
    { status: 200, headers: responseHeaders }
  );
}
