// POST /api/vpn/verify  { deviceId, key|appUserId }  → { active: boolean }
// Called by the app on launch. If the device was removed (or the account is
// gone / expired), returns active:false so the app drops Premium locally.

import { cors, checkRateLimit } from '../../cookly/_shared';
import { prisma, norm } from '../_account';

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

  const t = req.headers.get('X-Client-Token');
  if (process.env.VPN_CLIENT_TOKEN && t !== process.env.VPN_CLIENT_TOKEN) {
    return json({ active: false, error: 'unauthorized' }, 401, headers);
  }
  const ip =
    req.headers.get('cf-connecting-ip') ||
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    'unknown';
  if (!checkRateLimit(ip)) return json({ active: false, error: 'rate_limited' }, 429, headers);

  let body: { deviceId?: string; key?: string; appUserId?: string };
  try {
    body = await req.json();
  } catch {
    return json({ active: false }, 200, headers);
  }
  const deviceId = (body.deviceId ?? '').trim();
  if (!deviceId) return json({ active: false }, 200, headers);

  const account = body.key
    ? await prisma.vpnAccount.findUnique({ where: { activationKey: norm(body.key) } })
    : body.appUserId
      ? await prisma.vpnAccount.findUnique({ where: { appUserId: body.appUserId } })
      : null;

  if (!account) return json({ active: false }, 200, headers);
  if (account.expiresAt && account.expiresAt.getTime() < Date.now())
    return json({ active: false }, 200, headers);

  const device = await prisma.vpnDevice.findUnique({
    where: { accountId_deviceId: { accountId: account.id, deviceId } },
  });
  if (!device) return json({ active: false }, 200, headers);

  // Touch lastSeenAt.
  await prisma.vpnDevice.update({ where: { id: device.id }, data: { lastSeenAt: new Date() } });
  return json({ active: true }, 200, headers);
}
