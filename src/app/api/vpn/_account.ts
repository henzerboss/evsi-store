// Shared helpers for the eVPN account/device routes.
// If your project already exports a Prisma client (e.g. from '@/lib/prisma'),
// replace the local singleton below with an import of yours.

import { PrismaClient } from '@prisma/client';

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };
export const prisma =
  globalForPrisma.prisma ?? new PrismaClient();
if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma;

// Activation key: reasonably long but easy to type. 12 chars from an
// unambiguous alphabet (no 0/O/1/I/L), grouped as EVS-XXXX-XXXX-XXXX.
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

export function generateActivationKey(): string {
  const pick = (n: number) =>
    Array.from({ length: n }, () => ALPHABET[Math.floor(Math.random() * ALPHABET.length)]).join('');
  return `EVS-${pick(4)}-${pick(4)}-${pick(4)}`;
}

export const norm = (s: string) => s.trim().toUpperCase();

/**
 * Verify a store purchase via the RevenueCat REST API (the correct, server-side
 * way to confirm Premium). Requires RC_SECRET_API_KEY in .env. If it's not set,
 * we fall back to trusting the client (dev mode), matching the promo route.
 * Returns true if the appUserId has the "premium" entitlement active.
 */
export async function revenueCatHasPremium(appUserId: string): Promise<boolean> {
  const secret = process.env.RC_SECRET_API_KEY;
  if (!secret) return true; // dev/trust mode
  try {
    const res = await fetch(
      `https://api.revenuecat.com/v1/subscribers/${encodeURIComponent(appUserId)}`,
      { headers: { Authorization: `Bearer ${secret}` } },
    );
    if (!res.ok) return false;
    const data = (await res.json()) as {
      subscriber?: { entitlements?: Record<string, { expires_date: string | null }> };
    };
    const ent = data.subscriber?.entitlements?.['premium'];
    if (!ent) return false;
    if (ent.expires_date == null) return true; // lifetime
    return Date.parse(ent.expires_date) > Date.now();
  } catch {
    return false;
  }
}

/** Validate a promo code against VPN_PROMO_CODES (CSV or JSON w/ expiry). */
export function validatePromo(code: string): { valid: boolean; until?: string | null } {
  const raw = process.env.VPN_PROMO_CODES;
  if (!raw) return { valid: false };
  const n = code.trim().toLowerCase();

  if (raw.trim().startsWith('[')) {
    try {
      const arr = JSON.parse(raw) as (string | { code: string; until?: string })[];
      for (const x of arr) {
        const entry = typeof x === 'string' ? { code: x } : x;
        if (entry.code.trim().toLowerCase() === n) {
          if (entry.until && Date.parse(entry.until) < Date.now()) return { valid: false };
          return { valid: true, until: entry.until ?? null };
        }
      }
      return { valid: false };
    } catch {
      return { valid: false };
    }
  }
  const found = raw.split(',').map((c) => c.trim().toLowerCase()).includes(n);
  return { valid: found };
}

export function accountToJson(
  account: { activationKey: string; entitlement: string; maxDevices: number },
  devices: { deviceId: string; name: string | null; platform: string | null; lastSeenAt: Date }[],
  currentDeviceId: string,
) {
  return {
    ok: true,
    entitlement: account.entitlement as 'premium',
    activationKey: account.activationKey,
    maxDevices: account.maxDevices,
    devices: devices.map((d) => ({
      deviceId: d.deviceId,
      name: d.name,
      platform: d.platform,
      lastSeenAt: d.lastSeenAt.toISOString(),
      current: d.deviceId === currentDeviceId,
    })),
  };
}
