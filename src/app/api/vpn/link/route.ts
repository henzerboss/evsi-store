// POST /api/vpn/link
// Establish or join a Premium account and register THIS device.
//
// Modes (exactly one drives it):
//   { appUserId } — primary device that owns a store purchase. Verified via
//                   RevenueCat (if RC_SECRET_API_KEY set), then an account is
//                   found/created and keyed by appUserId. Returns its key.
//   { promoCode } — redeem a valid promo → mint a fresh account + key.
//   { key }       — secondary device joining an existing account by its key.
//
// Always enforces maxDevices (default 10) server-side.

import { cors, checkRateLimit } from '../../cookly/_shared';
import {
  prisma,
  generateActivationKey,
  norm,
  revenueCatHasPremium,
  validatePromo,
  accountToJson,
} from '../_account';

export const runtime = 'nodejs';

function json(data: unknown, status: number, headers: Record<string, string>) {
  return new Response(JSON.stringify(data), { status, headers });
}

export async function OPTIONS(req: Request) {
  return new Response(null, { status: 204, headers: cors(req.headers.get('origin') ?? '') });
}

export async function POST(req: Request) {
  const origin = req.headers.get('origin') ?? '';
  const headers = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...cors(origin) };

  const clientToken = req.headers.get('X-Client-Token');
  if (process.env.VPN_CLIENT_TOKEN && clientToken !== process.env.VPN_CLIENT_TOKEN) {
    return json({ ok: false, error: 'unauthorized' }, 401, headers);
  }
  const ip =
    req.headers.get('cf-connecting-ip') ||
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    'unknown';
  if (!checkRateLimit(ip)) return json({ ok: false, error: 'rate_limited' }, 429, headers);

  let body: {
    deviceId?: string;
    name?: string;
    platform?: string;
    appUserId?: string;
    promoCode?: string;
    key?: string;
    code?: string; // unified: could be an activation key OR a promo code
  };
  try {
    body = await req.json();
  } catch {
    return json({ ok: false, error: 'bad_request' }, 400, headers);
  }

  const deviceId = (body.deviceId ?? '').trim();
  if (!deviceId) return json({ ok: false, error: 'device_required' }, 400, headers);
  const name = body.name?.trim() || null;
  const platform = body.platform?.trim() || null;

  // Resolve the target account by mode.
  let account:
    | { id: string; activationKey: string; entitlement: string; maxDevices: number }
    | null = null;

  // Unified single-field input: try it as an activation key first, then as a
  // promo code. This powers the one "Enter key" field in Settings.
  if (body.code) {
    const asKey = await prisma.vpnAccount.findUnique({ where: { activationKey: norm(body.code) } });
    if (asKey) {
      account = asKey;
    } else {
      const check = validatePromo(body.code);
      if (!check.valid) return json({ ok: false, entitlement: null, error: 'invalid_key' }, 200, headers);
      account = await prisma.vpnAccount.create({
        data: {
          activationKey: generateActivationKey(),
          source: 'promo',
          promoCode: body.code.trim(),
          entitlement: 'premium',
          expiresAt: check.until ? new Date(check.until) : null,
        },
      });
    }
  } else if (body.key) {
    account = await prisma.vpnAccount.findUnique({ where: { activationKey: norm(body.key) } });
    if (!account) return json({ ok: false, entitlement: null, error: 'invalid_key' }, 200, headers);
  } else if (body.promoCode) {
    const check = validatePromo(body.promoCode);
    if (!check.valid) return json({ ok: false, entitlement: null, error: 'invalid_code' }, 200, headers);
    // Mint a fresh account for this promo redemption.
    account = await prisma.vpnAccount.create({
      data: {
        activationKey: generateActivationKey(),
        source: 'promo',
        promoCode: body.promoCode.trim(),
        entitlement: 'premium',
        expiresAt: check.until ? new Date(check.until) : null,
      },
    });
  } else if (body.appUserId) {
    const ok = await revenueCatHasPremium(body.appUserId);
    if (!ok) return json({ ok: false, entitlement: null, error: 'not_premium' }, 200, headers);
    account =
      (await prisma.vpnAccount.findUnique({ where: { appUserId: body.appUserId } })) ??
      (await prisma.vpnAccount.create({
        data: {
          activationKey: generateActivationKey(),
          source: 'purchase',
          appUserId: body.appUserId,
          entitlement: 'premium',
        },
      }));
  } else {
    return json({ ok: false, error: 'mode_required' }, 400, headers);
  }

  // Register (or refresh) this device, enforcing the cap.
  const existing = await prisma.vpnDevice.findUnique({
    where: { accountId_deviceId: { accountId: account.id, deviceId } },
  });

  if (!existing) {
    const count = await prisma.vpnDevice.count({ where: { accountId: account.id } });
    if (count >= account.maxDevices) {
      const devices = await prisma.vpnDevice.findMany({ where: { accountId: account.id } });
      return json(
        { ...accountToJson(account, devices, deviceId), ok: false, error: 'device_limit' },
        200,
        headers,
      );
    }
    await prisma.vpnDevice.create({ data: { accountId: account.id, deviceId, name, platform } });
  } else {
    await prisma.vpnDevice.update({
      where: { id: existing.id },
      data: { lastSeenAt: new Date(), name: name ?? existing.name, platform: platform ?? existing.platform },
    });
  }

  const devices = await prisma.vpnDevice.findMany({
    where: { accountId: account.id },
    orderBy: { createdAt: 'asc' },
  });
  return json(accountToJson(account, devices, deviceId), 200, headers);
}
