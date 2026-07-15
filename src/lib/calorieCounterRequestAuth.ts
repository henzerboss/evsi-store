import { timingSafeEqual } from 'node:crypto';

type AuthMethod = 'client-token';

export type CalorieCounterAuthResult =
  | { ok: true; method: AuthMethod }
  | { ok: false; status: 403 | 503; error: string };

const splitTokens = (value?: string): string[] =>
  (value ?? '')
    .split(',')
    .map((token) => token.trim())
    .filter(Boolean);

/**
 * Tokens are intentionally read for every request so a PM2 restart is enough
 * after changing .env. CALORIE_COUNTER_CLIENT_TOKENS supports a staged token
 * rotation: keep the old token in the comma-separated list while new app
 * versions roll out, then remove it later.
 *
 * SERVER_CLIENT_TOKEN remains a compatibility fallback for already released
 * versions and for installations that have not introduced a dedicated token.
 */
const getConfiguredTokens = (): string[] => {
  const tokens = [
    ...splitTokens(process.env.CALORIE_COUNTER_CLIENT_TOKENS),
    ...splitTokens(process.env.CALORIE_COUNTER_CLIENT_TOKEN),
    ...splitTokens(process.env.SERVER_CLIENT_TOKEN),
  ];

  return [...new Set(tokens)];
};

const secureTokenEquals = (provided: string, expected: string): boolean => {
  const providedBuffer = Buffer.from(provided, 'utf8');
  const expectedBuffer = Buffer.from(expected, 'utf8');

  if (providedBuffer.length !== expectedBuffer.length) return false;
  return timingSafeEqual(providedBuffer, expectedBuffer);
};

/**
 * Compatibility-first authentication for CalorieCounterAI endpoints.
 *
 * This deliberately fails closed when no server token is configured. It does
 * not treat a missing .env value as an unprotected development mode.
 */
export const authorizeCalorieCounterRequest = async (
  req: Request,
): Promise<CalorieCounterAuthResult> => {
  const configuredTokens = getConfiguredTokens();

  if (configuredTokens.length === 0) {
    console.error(
      'CalorieCounterAI API auth is not configured. Set SERVER_CLIENT_TOKEN or CALORIE_COUNTER_CLIENT_TOKEN.',
    );
    return {
      ok: false,
      status: 503,
      error: 'API authentication is not configured',
    };
  }

  const clientToken = req.headers.get('x-client-token')?.trim() ?? '';
  const isValid =
    clientToken.length > 0 &&
    configuredTokens.some((expectedToken) => secureTokenEquals(clientToken, expectedToken));

  if (isValid) return { ok: true, method: 'client-token' };

  return { ok: false, status: 403, error: 'Forbidden' };
};
