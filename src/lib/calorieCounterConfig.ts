export type AnalysisLimit = number | 'unlimited';

export interface CalorieCounterConfig {
  schemaVersion: 1;
  limits: {
    existingUsers: { free: number; premium: AnalysisLimit };
    newUsers: { free: number; premium: AnalysisLimit };
  };
  firstDayFreeForNewUsers: boolean;
}

type Environment = Readonly<Record<string, string | undefined>>;

function readCount(value: string | undefined, fallback: number): number {
  const normalized = value?.trim() ?? '';
  // A zero limit is valid. Reject partial numbers, fractions, signs, infinity,
  // and values that cannot be represented exactly in the mobile JavaScript UI.
  if (!/^\d+$/.test(normalized)) return fallback;
  const parsed = Number(normalized);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : fallback;
}

function readPremiumLimit(value: string | undefined): AnalysisLimit {
  if (value?.trim().toLowerCase() === 'unlimited') return 'unlimited';
  return readCount(value, 50);
}

/**
 * Read only these five server variables, at request time. Next.js loads .env
 * into process.env; a server-process restart applies later .env changes.
 * Missing/invalid fields fall back independently to the app's current limits.
 */
export function getCalorieCounterConfig(env: Environment = process.env): CalorieCounterConfig {
  return {
    schemaVersion: 1,
    limits: {
      existingUsers: {
        free: readCount(env.CCAI_FREE_ANALYSES_EXISTING, 5),
        premium: readPremiumLimit(env.CCAI_PREMIUM_ANALYSES_EXISTING),
      },
      newUsers: {
        free: readCount(env.CCAI_FREE_ANALYSES_NEW, 5),
        premium: readPremiumLimit(env.CCAI_PREMIUM_ANALYSES_NEW),
      },
    },
    // Never use Boolean(string): even "false" would become true.
    firstDayFreeForNewUsers: env.CCAI_FIRST_DAY_FREE?.trim().toLowerCase() === 'true',
  };
}
