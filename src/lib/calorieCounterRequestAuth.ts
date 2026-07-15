import { createPublicKey, verify } from 'node:crypto';

type AuthMethod = 'legacy-client-token' | 'firebase-app-check' | 'unprotected';

export type CalorieCounterAuthResult =
  | { ok: true; method: AuthMethod; appId?: string }
  | { ok: false; status: 401 | 403 | 503; error: string };

type AppCheckJwtHeader = {
  alg?: string;
  typ?: string;
  kid?: string;
};

type AppCheckJwtPayload = {
  iss?: string;
  aud?: string | string[];
  exp?: number;
  iat?: number;
  sub?: string;
};

type JwkWithKid = JsonWebKey & {
  kty: string;
  kid?: string;
  alg?: string;
  use?: string;
};

type CachedJwks = {
  keys: JwkWithKid[];
  expiresAt: number;
};

const APP_CHECK_JWKS_URL = 'https://firebaseappcheck.googleapis.com/v1/jwks';
const DEFAULT_FIREBASE_PROJECT_NUMBER = '635540041978';
const DEFAULT_ALLOWED_APP_IDS = [
  '1:635540041978:android:88bc74704de7d3c7eb5943',
  '1:635540041978:ios:f24632d21a814c78eb5943',
];
const DEFAULT_JWKS_CACHE_MS = 6 * 60 * 60 * 1000;
let jwksCache: CachedJwks | null = null;
let jwksPromise: Promise<JwkWithKid[]> | null = null;

const decodeJsonSegment = <T>(segment: string): T =>
  JSON.parse(Buffer.from(segment, 'base64url').toString('utf8')) as T;

const readCacheMaxAgeMs = (cacheControl: string | null): number => {
  const maxAge = cacheControl?.match(/(?:^|,)\s*max-age=(\d+)/i)?.[1];
  if (!maxAge) return DEFAULT_JWKS_CACHE_MS;
  const seconds = Number(maxAge);
  return Number.isFinite(seconds) && seconds > 0
    ? Math.min(DEFAULT_JWKS_CACHE_MS, seconds * 1000)
    : DEFAULT_JWKS_CACHE_MS;
};

const loadJwks = async (): Promise<JwkWithKid[]> => {
  const now = Date.now();
  if (jwksCache && jwksCache.expiresAt > now) return jwksCache.keys;
  if (jwksPromise) return jwksPromise;

  jwksPromise = (async () => {
    const response = await fetch(APP_CHECK_JWKS_URL, {
      headers: { Accept: 'application/json' },
      cache: 'no-store',
    });

    if (!response.ok) {
      throw new Error(`App Check JWKS request failed with ${response.status}`);
    }

    const body = (await response.json()) as { keys?: JwkWithKid[] };
    if (!Array.isArray(body.keys) || body.keys.length === 0) {
      throw new Error('App Check JWKS response contains no keys');
    }

    jwksCache = {
      keys: body.keys,
      expiresAt: Date.now() + readCacheMaxAgeMs(response.headers.get('cache-control')),
    };
    return body.keys;
  })().finally(() => {
    jwksPromise = null;
  });

  return jwksPromise;
};

const isAllowedAppId = (appId: string): boolean => {
  const configured = process.env.FIREBASE_APP_CHECK_ALLOWED_APP_IDS
    ?.split(',')
    .map((value) => value.trim())
    .filter(Boolean);

  const allowed = configured?.length ? configured : DEFAULT_ALLOWED_APP_IDS;
  return allowed.includes(appId);
};

const verifyAppCheckToken = async (token: string): Promise<string> => {
  const projectNumber =
    process.env.FIREBASE_PROJECT_NUMBER?.trim() || DEFAULT_FIREBASE_PROJECT_NUMBER;

  const segments = token.split('.');
  if (segments.length !== 3) throw new Error('Malformed App Check JWT');

  const [encodedHeader, encodedPayload, encodedSignature] = segments;
  const header = decodeJsonSegment<AppCheckJwtHeader>(encodedHeader);
  const payload = decodeJsonSegment<AppCheckJwtPayload>(encodedPayload);

  if (header.alg !== 'RS256' || header.typ !== 'JWT' || !header.kid) {
    throw new Error('Unsupported App Check JWT header');
  }

  const keys = await loadJwks();
  const jwk = keys.find((candidate) => candidate.kid === header.kid);
  if (!jwk) {
    // A key rotation can happen before the local cache expires. Refresh once.
    jwksCache = null;
    const refreshed = await loadJwks();
    const refreshedKey = refreshed.find((candidate) => candidate.kid === header.kid);
    if (!refreshedKey) throw new Error('Unknown App Check signing key');
    const valid = verify(
      'RSA-SHA256',
      Buffer.from(`${encodedHeader}.${encodedPayload}`),
      createPublicKey({ key: refreshedKey as JsonWebKey, format: 'jwk' }),
      Buffer.from(encodedSignature, 'base64url'),
    );
    if (!valid) throw new Error('Invalid App Check signature');
  } else {
    const valid = verify(
      'RSA-SHA256',
      Buffer.from(`${encodedHeader}.${encodedPayload}`),
      createPublicKey({ key: jwk as JsonWebKey, format: 'jwk' }),
      Buffer.from(encodedSignature, 'base64url'),
    );
    if (!valid) throw new Error('Invalid App Check signature');
  }

  const nowSeconds = Math.floor(Date.now() / 1000);
  const expectedIssuer = `https://firebaseappcheck.googleapis.com/${projectNumber}`;
  const expectedAudience = `projects/${projectNumber}`;
  const audiences = Array.isArray(payload.aud)
    ? payload.aud
    : typeof payload.aud === 'string'
      ? [payload.aud]
      : [];

  if (payload.iss !== expectedIssuer) throw new Error('Invalid App Check issuer');
  if (!audiences.includes(expectedAudience)) throw new Error('Invalid App Check audience');
  if (!payload.exp || payload.exp <= nowSeconds) throw new Error('Expired App Check token');
  if (payload.iat && payload.iat > nowSeconds + 60) throw new Error('Invalid App Check issued-at time');
  if (!payload.sub || !isAllowedAppId(payload.sub)) {
    throw new Error('App Check app is not allowed');
  }

  return payload.sub;
};

/**
 * Migration-safe API authentication:
 * - already released clients continue to use the embedded X-Client-Token;
 * - new builds use Firebase App Check and contain no shared server secret;
 * - if SERVER_CLIENT_TOKEN is absent, preserve the route's historical
 *   unprotected development behavior.
 */
export const authorizeCalorieCounterRequest = async (
  req: Request,
): Promise<CalorieCounterAuthResult> => {
  const serverToken = process.env.SERVER_CLIENT_TOKEN?.trim();
  const legacyClientToken = req.headers.get('x-client-token')?.trim();

  if (serverToken && legacyClientToken === serverToken) {
    return { ok: true, method: 'legacy-client-token' };
  }

  const appCheckToken = req.headers.get('x-firebase-appcheck')?.trim();
  if (appCheckToken) {
    try {
      const appId = await verifyAppCheckToken(appCheckToken);
      return { ok: true, method: 'firebase-app-check', appId };
    } catch (error) {
      console.warn('Firebase App Check verification failed', error);
      return {
        ok: false,
        status: 401,
        error: 'Invalid Firebase App Check token',
      };
    }
  }

  if (!serverToken) {
    return { ok: true, method: 'unprotected' };
  }

  return { ok: false, status: 403, error: 'Forbidden' };
};
