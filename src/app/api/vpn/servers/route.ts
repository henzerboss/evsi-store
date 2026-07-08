// =================================================================
// File: src/app/api/vpn/servers/route.ts
// eVPN — returns the country/server list for the mobile app.
//
// Design notes:
//  - Country + IP data lives in .env (VPN_SERVERS), never in the repo.
//  - Protected by X-Client-Token (VPN_CLIENT_TOKEN), mirroring the
//    dishkin/app-version route so the app auth is consistent.
//  - We build ready-to-use *sing-box outbound* objects on the server so the
//    app never has to know how to translate a proxy into a tunnel config.
//    Supported outbound types: socks (proxy6.net), shadowsocks, vless, wireguard.
//  - SECURITY: a client VPN necessarily receives real connection credentials.
//    Keep VPN_CLIENT_TOKEN secret, rotate proxy creds regularly, and prefer
//    per-user creds if your provider supports them.
// =================================================================

import { cors, checkRateLimit } from '../../cookly/_shared';

export const runtime = 'nodejs';

function json(data: unknown, status: number, headers: Record<string, string>) {
  return new Response(JSON.stringify(data), { status, headers });
}

// ---- .env parsing ------------------------------------------------

/**
 * VPN_SERVERS is a JSON array. Each entry (all fields except the sing-box
 * translation are optional and provider-specific):
 *
 * SOCKS5 (proxy6.net):
 *   { "id":"ru-1","country":"RU","name":"Russia","flag":"🇷🇺","city":"Moscow",
 *     "type":"socks","host":"1.2.3.4","port":1080,"username":"u","password":"p",
 *     "premium": false }
 *
 * Shadowsocks:
 *   { ...,"type":"shadowsocks","host":"h","port":8388,"method":"aes-256-gcm","password":"p" }
 *
 * VLESS (Xray/reality):
 *   { ...,"type":"vless","host":"h","port":443,"uuid":"...","flow":"xtls-rprx-vision",
 *     "tls": { "enabled": true, "server_name":"...", "reality": { "public_key":"...", "short_id":"..." } } }
 *
 * WireGuard:
 *   { ...,"type":"wireguard","host":"h","port":51820,"private_key":"...","peer_public_key":"...",
 *     "local_address":["10.0.0.2/32"],"pre_shared_key":"..." }
 */
interface RawServer {
  id?: string;
  country: string;          // ISO code, e.g. "RU"
  name?: string;            // display name, e.g. "Russia"
  flag?: string;            // emoji flag
  city?: string;
  premium?: boolean;        // if true, only entitled users may connect
  type: 'socks' | 'shadowsocks' | 'vless' | 'wireguard';
  host: string;
  port: number;
  // socks / shadowsocks / vless / wireguard specific fields:
  username?: string;
  password?: string;
  method?: string;
  uuid?: string;
  flow?: string;
  tls?: Record<string, unknown>;
  private_key?: string;
  peer_public_key?: string;
  pre_shared_key?: string;
  local_address?: string[];
}

function readServersFromEnv(): RawServer[] {
  const raw = process.env.VPN_SERVERS;
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
};
const NAME: Record<string, string> = {
  RU: 'Russia', ES: 'Spain', FR: 'France', US: 'United States', DE: 'Germany',
};

/** Turn a raw server into a sing-box outbound object (tag = server id). */
function toSingboxOutbound(s: RawServer, tag: string): Record<string, unknown> {
  const base = { tag, server: s.host, server_port: s.port };
  switch (s.type) {
    case 'socks':
      return {
        type: 'socks', version: '5', ...base,
        ...(s.username ? { username: s.username, password: s.password ?? '' } : {}),
      };
    case 'shadowsocks':
      return { type: 'shadowsocks', ...base, method: s.method ?? 'aes-256-gcm', password: s.password ?? '' };
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

  const servers = readServersFromEnv();
  if (!servers.length) {
    return json({ ok: true, updatedAt: new Date().toISOString(), servers: [] }, 200, headers);
  }

  const payload = servers.map((s, i) => {
    const cc = (s.country || '').toUpperCase();
    const id = s.id || `${cc.toLowerCase()}-${i + 1}`;
    return {
      id,
      country: cc,
      name: s.name || NAME[cc] || cc,
      flag: s.flag || FLAG[cc] || '🏳️',
      city: s.city ?? null,
      premium: !!s.premium,
      protocol: s.type,
      // sing-box-ready outbound; the app drops this straight into its config.
      outbound: toSingboxOutbound(s, id),
    };
  });

  return json({ ok: true, updatedAt: new Date().toISOString(), servers: payload }, 200, headers);
}
