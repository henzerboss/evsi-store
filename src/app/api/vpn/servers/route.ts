// =================================================================
// File: src/app/api/vpn/servers/route.ts
// eVPN — returns the country/server list for the mobile app.
//
// Backward compatibility:
//  - Old app versions request /api/vpn/servers and receive VPN_SERVERS.
//    Keep VPN_SERVERS in the old SOCKS5-only format.
//  - New app versions request /api/vpn/servers?schema=v2 or send
//    X-Evsvpn-Config-Version: v2 and receive VPN_SERVERS_V2.
//    VPN_SERVERS_V2 can use a simpler access-based format:
//      access: "free" | "premium"
//      type: "socks" | "shadowsocks" | "vless" | "wireguard"
//
// Country + IP data lives in .env, never in the repo.
// Protected by X-Client-Token (VPN_CLIENT_TOKEN), mirroring the
// dishkin/app-version route so the app auth is consistent.
// =================================================================

import { cors, checkRateLimit } from '../../cookly/_shared';

export const runtime = 'nodejs';

type ServerAccess = 'free' | 'premium';

function json(data: unknown, status: number, headers: Record<string, string>) {
  return new Response(JSON.stringify(data), { status, headers });
}

// ---- .env parsing ------------------------------------------------

/**
 * VPN_SERVERS is the legacy JSON array for old app versions.
 * Keep it in the old SOCKS5-compatible format:
 *   { "id":"es-1", "country":"ES", "type":"socks", "host":"...",
 *     "port":8000, "username":"...", "password":"...", "premium":false }
 *
 * VPN_SERVERS_V2 is the new JSON array for app versions with schema=v2.
 * It is intentionally simple and controlled from env:
 *   { "id":"free-es-1", "access":"free", "country":"ES", "type":"shadowsocks",
 *     "host":"...", "port":19992, "method":"chacha20-ietf-poly1305", "password":"..." }
 */
interface RawServer {
  id?: string;
  access?: ServerAccess | string;
  tier?: string;
  plan?: string;
  visibility?: string;
  free?: boolean;
  country: string;
  name?: string;
  flag?: string;
  city?: string;
  premium?: boolean;
  type: 'socks' | 'shadowsocks' | 'vless' | 'wireguard' | 'socks5' | 'ss';
  host: string;
  port: number;
  // socks / shadowsocks / vless / wireguard specific fields:
  username?: string;
  password?: string;
  method?: string;
  encryption?: string;
  encryptionAlgorithm?: string;
  network?: string;
  uuid?: string;
  flow?: string;
  tls?: Record<string, unknown>;
  private_key?: string;
  peer_public_key?: string;
  pre_shared_key?: string;
  local_address?: string[];
}

function readServersFromEnv(envName: 'VPN_SERVERS' | 'VPN_SERVERS_V2'): RawServer[] {
  const raw = process.env[envName];
  if (!raw) return [];
  try {
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? (arr as RawServer[]) : [];
  } catch {
    return [];
  }
}

const FLAG: Record<string, string> = {
  RU: '🇷🇺', ES: '🇪🇸', FR: '🇫🇷', US: '🇺🇸', DE: '🇩🇪',
  GB: '🇬🇧', CA: '🇨🇦', NL: '🇳🇱', AU: '🇦🇺', SG: '🇸🇬',
  JP: '🇯🇵', AE: '🇦🇪',
};
const NAME: Record<string, string> = {
  RU: 'Russia', ES: 'Spain', FR: 'France', US: 'United States', DE: 'Germany',
  GB: 'United Kingdom', CA: 'Canada', NL: 'Netherlands', AU: 'Australia',
  SG: 'Singapore', JP: 'Japan', AE: 'United Arab Emirates',
};

function normalizeShadowsocksMethod(method: unknown): string {
  const normalized = String(method || 'chacha20-ietf-poly1305')
    .trim()
    .toLowerCase()
    .replace(/^aead_/, '')
    .replace(/_/g, '-');

  if (normalized === 'chacha20-ietf-poly1305') return normalized;
  if (normalized === 'aes-256-gcm') return normalized;
  if (normalized === 'aes-128-gcm') return normalized;
  if (normalized.startsWith('2022-blake3-')) return normalized;

  return 'chacha20-ietf-poly1305';
}

function inferAccess(s: RawServer): ServerAccess {
  const rawAccess = String(s.access ?? s.tier ?? s.plan ?? s.visibility ?? '')
    .trim()
    .toLowerCase();

  if (['free', 'public', 'basic'].includes(rawAccess)) return 'free';
  if (['premium', 'paid', 'pro', 'plus'].includes(rawAccess)) return 'premium';
  if (s.free === true) return 'free';

  // Legacy compatibility: premium:false means free, premium:true means premium.
  return s.premium ? 'premium' : 'free';
}

/** Turn a raw server into a sing-box outbound object (tag = server id). */
function toSingboxOutbound(s: RawServer, tag: string): Record<string, unknown> {
  const base = { tag, server: s.host, server_port: Number(s.port) };
  switch (s.type) {
    case 'socks':
    case 'socks5':
      return {
        type: 'socks', version: '5', ...base,
        ...(s.username ? { username: s.username, password: s.password ?? '' } : {}),
      };
    case 'shadowsocks':
    case 'ss':
      return {
        type: 'shadowsocks',
        ...base,
        method: normalizeShadowsocksMethod(s.method ?? s.encryption ?? s.encryptionAlgorithm),
        password: s.password ?? '',
        ...(s.network ? { network: s.network } : {}),
      };
    case 'vless':
      return {
        type: 'vless', ...base, uuid: s.uuid ?? '',
        ...(s.flow ? { flow: s.flow } : {}),
        ...(s.tls ? { tls: s.tls } : {}),
      };
    case 'wireguard':
      return {
        type: 'wireguard', ...base,
        local_address: s.local_address ?? [],
        private_key: s.private_key ?? '',
        peer_public_key: s.peer_public_key ?? '',
        ...(s.pre_shared_key ? { pre_shared_key: s.pre_shared_key } : {}),
      };
    default:
      return { type: 'direct', tag };
  }
}

export async function OPTIONS(req: Request) {
  return new Response(null, { status: 204, headers: cors(req.headers.get('origin') ?? '') });
}

export async function GET(req: Request) {
  const origin = req.headers.get('origin') ?? '';
  const headers = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...cors(origin) };

  // Auth (same pattern as dishkin/app-version).
  const clientToken = req.headers.get('X-Client-Token');
  if (process.env.VPN_CLIENT_TOKEN && clientToken !== process.env.VPN_CLIENT_TOKEN) {
    return json({ error: 'unauthorized' }, 401, headers);
  }

  const ip =
    req.headers.get('cf-connecting-ip') ||
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    'unknown';
  if (!checkRateLimit(ip)) {
    return json({ error: 'rate_limited' }, 429, headers);
  }

  const url = new URL(req.url);
  const requestedSchema =
    url.searchParams.get('schema') ||
    req.headers.get('X-Evsvpn-Config-Version') ||
    req.headers.get('x-evsvpn-config-version') ||
    '';
  const useV2 = requestedSchema.toLowerCase() === 'v2';
  const schema = useV2 ? 'v2' : 'legacy';
  const envName = useV2 ? 'VPN_SERVERS_V2' : 'VPN_SERVERS';

  const servers = readServersFromEnv(envName);
  if (!servers.length) {
    return json({ ok: true, schema, updatedAt: new Date().toISOString(), servers: [] }, 200, headers);
  }

  const payload = servers.map((s, i) => {
    const cc = (s.country || '').toUpperCase();
    const id = s.id || `${cc.toLowerCase()}-${i + 1}`;
    const access = inferAccess(s);

    return {
      id,
      country: cc,
      name: s.name || NAME[cc] || cc,
      flag: s.flag || FLAG[cc] || '🏳️',
      city: s.city ?? null,
      // New app versions use access to separate free pool from premium country list.
      ...(useV2 ? { access } : {}),
      premium: access === 'premium',
      protocol: s.type === 'socks5' ? 'socks' : s.type === 'ss' ? 'shadowsocks' : s.type,
      // sing-box-ready outbound; the app drops this straight into its config.
      outbound: toSingboxOutbound(s, id),
    };
  });

  return json({ ok: true, schema, updatedAt: new Date().toISOString(), servers: payload }, 200, headers);
}
