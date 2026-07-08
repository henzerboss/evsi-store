// =================================================================
// File: src/app/api/vpn/promo/route.ts
// eVPN — validates a promo code entered in the app's Settings.
//
//  - Codes live in .env (VPN_PROMO_CODES), CSV or JSON array.
//  - A code may be a plain string ("FRIENDS2026") granting premium forever,
//    or an object with an expiry: {"code":"SUMMER","until":"2026-09-01"}.
//  - Protected by X-Client-Token (VPN_CLIENT_TOKEN), same as /vpn/servers.
//  - Comparison is case-insensitive and whitespace-trimmed.
//  - On success returns { valid:true, entitlement:"premium", until? } so the
//    app can unlock country selection locally (no server-side user store).
// =================================================================

import { cors, checkRateLimit } from '../../cookly/_shared';

export const runtime = 'nodejs';

function json(data: unknown, status: number, headers: Record<string, string>) {
  return new Response(JSON.stringify(data), { status, headers });
}

const norm = (s: string) => s.trim().toLowerCase();

type PromoEntry = { code: string; until?: string };

function readCodesFromEnv(): PromoEntry[] {
  const raw = process.env.VPN_PROMO_CODES;
  if (!raw) return [];

  if (raw.trim().startsWith('[')) {
    try {
      const arr = JSON.parse(raw);
      if (Array.isArray(arr)) {
        return arr
          .map((x): PromoEntry | null => {
            if (typeof x === 'string') return { code: x };
            if (x && typeof x === 'object' && typeof x.code === 'string')
              return { code: x.code, until: x.until };
            return null;
          })
          .filter((x): x is PromoEntry => !!x && !!x.code.trim());
      }
    } catch {
      return [];
    }
  }

  // CSV of plain codes
  return raw
    .split(',')
    .map((c) => c.trim())
    .filter(Boolean)
    .map((code) => ({ code }));
}

async function handle(code: string, headers: Record<string, string>) {
  if (!code) {
    return json({ valid: false, message: 'Code is required' }, 400, headers);
  }

  const entry = readCodesFromEnv().find((e) => norm(e.code) === norm(code));
  if (!entry) {
    return json({ valid: false, message: 'Invalid code' }, 200, headers);
  }

  if (entry.until) {
    const exp = Date.parse(entry.until);
    if (Number.isFinite(exp) && Date.now() > exp) {
      return json({ valid: false, message: 'Code expired' }, 200, headers);
    }
  }

  return json(
    { valid: true, entitlement: 'premium', until: entry.until ?? null, message: 'OK' },
    200,
    headers,
  );
}

export async function OPTIONS(req: Request) {
  return new Response(null, { status: 204, headers: cors(req.headers.get('origin') ?? '') });
}

export async function GET(req: Request) {
  const origin = req.headers.get('origin') ?? '';
  const headers = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...cors(origin) };

  const clientToken = req.headers.get('X-Client-Token');
  if (process.env.VPN_CLIENT_TOKEN && clientToken !== process.env.VPN_CLIENT_TOKEN) {
    return json({ valid: false, error: 'unauthorized' }, 401, headers);
  }

  const ip =
    req.headers.get('cf-connecting-ip') ||
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    'unknown';
  if (!checkRateLimit(ip)) {
    return json({ valid: false, error: 'rate_limited' }, 429, headers);
  }

  const code = new URL(req.url).searchParams.get('code') || '';
  return handle(code, headers);
}

export async function POST(req: Request) {
  const origin = req.headers.get('origin') ?? '';
  const headers = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...cors(origin) };

  const clientToken = req.headers.get('X-Client-Token');
  if (process.env.VPN_CLIENT_TOKEN && clientToken !== process.env.VPN_CLIENT_TOKEN) {
    return json({ valid: false, error: 'unauthorized' }, 401, headers);
  }

  let code = '';
  try {
    const body = (await req.json()) as { code?: string };
    code = body.code ?? '';
  } catch {
    /* ignore */
  }
  return handle(code, headers);
}
