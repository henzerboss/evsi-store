// GET    /api/vpn/devices?key=...  (or ?appUserId=...)  → list devices + key
// DELETE /api/vpn/devices  { key|appUserId, targetDeviceId }  → remove a device
//
// Auth: X-Client-Token, plus knowledge of the account key / appUserId acts as
// the per-account secret (only the owner has it).

import { cors, checkRateLimit } from '../../cookly/_shared';
import { prisma, norm, accountToJson } from '../_account';

export const runtime = 'nodejs';

function json(data: unknown, status: number, headers: Record<string, string>) {
  return new Response(JSON.stringify(data), { status, headers });
}

function auth(req: Request): boolean {
  const t = req.headers.get('X-Client-Token');
  return !process.env.VPN_CLIENT_TOKEN || t === process.env.VPN_CLIENT_TOKEN;
}

async function findAccount(by: { key?: string | null; appUserId?: string | null }) {
  if (by.key) return prisma.vpnAccount.findUnique({ where: { activationKey: norm(by.key) } });
  if (by.appUserId) return prisma.vpnAccount.findUnique({ where: { appUserId: by.appUserId } });
  return null;
}

export async function OPTIONS(req: Request) {
  return new Response(null, { status: 204, headers: cors(req.headers.get('origin') ?? '') });
}

export async function GET(req: Request) {
  const origin = req.headers.get('origin') ?? '';
  const headers = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...cors(origin) };
  if (!auth(req)) return json({ ok: false, error: 'unauthorized' }, 401, headers);

  const url = new URL(req.url);
  const key = url.searchParams.get('key');
  const appUserId = url.searchParams.get('appUserId');
  const account = await findAccount({ key, appUserId });
  if (!account) return json({ ok: false, entitlement: null, activationKey: null, maxDevices: 10, devices: [] }, 200, headers);

  const devices = await prisma.vpnDevice.findMany({
    where: { accountId: account.id },
    orderBy: { createdAt: 'asc' },
  });
  return json(accountToJson(account, devices, ''), 200, headers);
}

export async function DELETE(req: Request) {
  const origin = req.headers.get('origin') ?? '';
  const headers = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...cors(origin) };
  if (!auth(req)) return json({ ok: false, error: 'unauthorized' }, 401, headers);

  const ip =
    req.headers.get('cf-connecting-ip') ||
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    'unknown';
  if (!checkRateLimit(ip)) return json({ ok: false, error: 'rate_limited' }, 429, headers);

  let body: { key?: string; appUserId?: string; targetDeviceId?: string };
  try {
    body = await req.json();
  } catch {
    return json({ ok: false, error: 'bad_request' }, 400, headers);
  }
  const target = (body.targetDeviceId ?? '').trim();
  if (!target) return json({ ok: false, error: 'target_required' }, 400, headers);

  const account = await findAccount({ key: body.key, appUserId: body.appUserId });
  if (!account) return json({ ok: false, error: 'invalid_key' }, 200, headers);

  await prisma.vpnDevice.deleteMany({ where: { accountId: account.id, deviceId: target } });

  const devices = await prisma.vpnDevice.findMany({
    where: { accountId: account.id },
    orderBy: { createdAt: 'asc' },
  });
  return json(accountToJson(account, devices, ''), 200, headers);
}
