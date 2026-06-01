import crypto from 'crypto';

import { NextRequest, NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { z } from 'zod';

import prisma from '@/lib/prisma';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const TIME_CONTROLS = [
  'classic_60',
  'rapid_30_20',
  'rapid_25_0',
  'rapid_15_10',
  'rapid_10_0',
  'blitz_5_3',
  'blitz_5_0',
  'blitz_3_2',
  'blitz_3_0',
  'bullet_2_1',
  'bullet_1_1',
  'bullet_1_0',
] as const;

const DIFFICULTIES = [
  'beginner',
  'casual',
  'club',
  'expert',
  'grandmaster',
] as const;

const PERIOD_TYPES = ['monthly', 'yearly'] as const;
type PeriodType = (typeof PERIOD_TYPES)[number];

type PeriodDescriptor = {
  periodType: PeriodType;
  periodKey: string;
};

const timeControlSchema = z.enum(TIME_CONTROLS);
const difficultySchema = z.enum(DIFFICULTIES);
const periodTypeSchema = z.enum(PERIOD_TYPES);

const categorySchema = z
  .string()
  .min(10)
  .max(48)
  .refine((value) => {
    const [timeControlId, difficulty] = value.split('__');
    return (
      TIME_CONTROLS.includes(timeControlId as (typeof TIME_CONTROLS)[number]) &&
      DIFFICULTIES.includes(difficulty as (typeof DIFFICULTIES)[number])
    );
  }, 'Invalid category');

const publicIdSchema = z
  .string()
  .min(12)
  .max(96)
  .regex(/^[a-zA-Z0-9_-]+$/);

const nicknameSchema = z
  .string()
  .trim()
  .min(2)
  .max(24)
  .regex(/^[\p{L}\p{N}_ .-]+$/u)
  .transform((value) => value.replace(/\s+/g, ' ').trim());

const countryCodeSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z]{2}$/);

const tokenSchema = z.string().min(20).max(512);

const joinSchema = z.object({
  action: z.literal('join'),
  playerId: publicIdSchema.optional(),
  nickname: nicknameSchema,
  countryCode: countryCodeSchema,
  countryName: z.string().trim().min(2).max(64),
  countryFlag: z.string().trim().min(1).max(8),
});

const leaveSchema = z.object({
  action: z.literal('leave'),
  playerId: publicIdSchema,
  token: tokenSchema,
});

const recordWinSchema = z.object({
  action: z.literal('recordWin'),
  playerId: publicIdSchema,
  token: tokenSchema,
  eventId: z
    .string()
    .min(18)
    .max(120)
    .regex(/^[a-zA-Z0-9_.:-]+$/),
  timeControlId: timeControlSchema,
  difficulty: difficultySchema,
  elapsedSec: z.number().int().min(1).max(24 * 60 * 60).optional(),
  occurredAt: z.number().int().positive().optional(),
});

const postSchema = z.discriminatedUnion('action', [
  joinSchema,
  leaveSchema,
  recordWinSchema,
]);

const RATE_LIMITS = {
  read: { max: 80, windowMs: 60_000 },
  join: { max: 8, windowMs: 10 * 60_000 },
  leave: { max: 12, windowMs: 10 * 60_000 },
  recordWinIp: { max: 80, windowMs: 10 * 60_000 },
  recordWinPlayer: { max: 48, windowMs: 60 * 60_000 },
  recordWinBurst: { max: 1, windowMs: 8_000 },
} as const;

type Bucket = { count: number; resetAt: number };

declare global {
  // eslint-disable-next-line no-var
  var chessChampionshipBuckets: Map<string, Bucket> | undefined;
}

const buckets = globalThis.chessChampionshipBuckets ?? new Map<string, Bucket>();
if (!globalThis.chessChampionshipBuckets) globalThis.chessChampionshipBuckets = buckets;

function cleanBuckets(now = Date.now()) {
  if (buckets.size < 5000) return;
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= now) buckets.delete(key);
  }
}

function hitRateLimit(key: string, limit: { max: number; windowMs: number }) {
  const now = Date.now();
  cleanBuckets(now);
  const bucket = buckets.get(key);
  if (!bucket || bucket.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + limit.windowMs });
    return { ok: true as const, retryAfterSec: 0 };
  }

  bucket.count += 1;
  if (bucket.count > limit.max) {
    return {
      ok: false as const,
      retryAfterSec: Math.max(1, Math.ceil((bucket.resetAt - now) / 1000)),
    };
  }

  return { ok: true as const, retryAfterSec: 0 };
}

function clientIp(req: NextRequest): string {
  const forwarded = req.headers.get('x-forwarded-for');
  if (forwarded) return forwarded.split(',')[0]?.trim() || 'unknown';
  return req.headers.get('x-real-ip') || 'unknown';
}

function json(data: unknown, status = 200, extraHeaders?: Record<string, string>) {
  return NextResponse.json(data, {
    status,
    headers: {
      'X-Robots-Tag': 'noindex',
      ...extraHeaders,
    },
  });
}

function getSecret(): string | null {
  return (
    process.env.CHESS_CHAMPIONSHIP_SECRET ||
    process.env.NEXTAUTH_SECRET ||
    process.env.AUTH_SECRET ||
    null
  );
}

function base64url(input: string | Buffer) {
  return Buffer.from(input)
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

function sign(payload: string, secret: string) {
  return base64url(crypto.createHmac('sha256', secret).update(payload).digest());
}

function createToken(playerId: string) {
  const secret = getSecret();
  if (!secret) return null;
  const payload = base64url(
    JSON.stringify({ v: 1, pid: playerId, iat: Math.floor(Date.now() / 1000) }),
  );
  return `${payload}.${sign(payload, secret)}`;
}

function verifyToken(playerId: string, token: string) {
  const secret = getSecret();
  if (!secret) return false;
  const [payload, signature] = token.split('.');
  if (!payload || !signature) return false;
  const expected = sign(payload, secret);
  const signatureBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);
  if (signatureBuffer.length !== expectedBuffer.length) return false;
  if (!crypto.timingSafeEqual(signatureBuffer, expectedBuffer)) return false;

  try {
    const parsed = JSON.parse(
      Buffer.from(payload.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'),
    );
    return parsed?.v === 1 && parsed?.pid === playerId;
  } catch {
    return false;
  }
}

function makePublicId() {
  return `cp_${crypto.randomBytes(18).toString('base64url')}`;
}

function categoryKey(timeControlId: string, difficulty: string) {
  return `${timeControlId}__${difficulty}`;
}

function sanitizeCountryName(value: string) {
  return value.replace(/[<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, 64);
}

function pad2(value: number) {
  return String(value).padStart(2, '0');
}

function periodFromDate(date: Date, periodType: PeriodType): PeriodDescriptor {
  const year = date.getUTCFullYear();
  if (periodType === 'yearly') {
    return { periodType, periodKey: String(year) };
  }

  return {
    periodType,
    periodKey: `${year}-${pad2(date.getUTCMonth() + 1)}`,
  };
}

function periodBounds(periodType: PeriodType, periodKey: string) {
  if (periodType === 'yearly') {
    const year = Number(periodKey);
    return {
      startsAt: new Date(Date.UTC(year, 0, 1, 0, 0, 0)).toISOString(),
      endsAt: new Date(Date.UTC(year + 1, 0, 1, 0, 0, 0)).toISOString(),
    };
  }

  const [yearRaw, monthRaw] = periodKey.split('-');
  const year = Number(yearRaw);
  const monthIndex = Number(monthRaw) - 1;
  return {
    startsAt: new Date(Date.UTC(year, monthIndex, 1, 0, 0, 0)).toISOString(),
    endsAt: new Date(Date.UTC(year, monthIndex + 1, 1, 0, 0, 0)).toISOString(),
  };
}

function validatePeriodKey(periodType: PeriodType, periodKey: string) {
  if (periodType === 'yearly') {
    return /^20\d{2}$/.test(periodKey);
  }

  if (!/^20\d{2}-(0[1-9]|1[0-2])$/.test(periodKey)) return false;
  return true;
}

function parsePeriodFromRequest(req: NextRequest): PeriodDescriptor | null {
  const periodTypeRaw = req.nextUrl.searchParams.get('periodType') || 'monthly';
  const parsedType = periodTypeSchema.safeParse(periodTypeRaw);
  if (!parsedType.success) return null;

  const periodType = parsedType.data;
  const periodKey =
    req.nextUrl.searchParams.get('periodKey') || periodFromDate(new Date(), periodType).periodKey;

  if (!validatePeriodKey(periodType, periodKey)) return null;
  return { periodType, periodKey };
}

async function getRanks(
  period: PeriodDescriptor,
  category: string,
  playerDbId?: string,
  countryCode?: string,
) {
  const { periodType, periodKey } = period;
  const whereBase = { periodType, periodKey, categoryKey: category };

  const [players, countries, playerStat, countryStat] = await Promise.all([
    prisma.chessPlayerPeriodCategoryStat.findMany({
      where: { ...whereBase, player: { isActive: true } },
      orderBy: [{ wins: 'desc' }, { updatedAt: 'asc' }],
      take: 50,
      include: { player: true },
    }),
    prisma.chessCountryPeriodCategoryStat.findMany({
      where: whereBase,
      orderBy: [{ wins: 'desc' }, { updatedAt: 'asc' }],
      take: 50,
    }),
    playerDbId
      ? prisma.chessPlayerPeriodCategoryStat.findUnique({
          where: {
            playerId_periodType_periodKey_categoryKey: {
              playerId: playerDbId,
              periodType,
              periodKey,
              categoryKey: category,
            },
          },
        })
      : Promise.resolve(null),
    countryCode
      ? prisma.chessCountryPeriodCategoryStat.findUnique({
          where: {
            countryCode_periodType_periodKey_categoryKey: {
              countryCode,
              periodType,
              periodKey,
              categoryKey: category,
            },
          },
        })
      : Promise.resolve(null),
  ]);

  let playerRank: number | null = null;
  if (playerStat) {
    playerRank =
      (await prisma.chessPlayerPeriodCategoryStat.count({
        where: {
          ...whereBase,
          OR: [
            { wins: { gt: playerStat.wins } },
            { wins: playerStat.wins, updatedAt: { lt: playerStat.updatedAt } },
          ],
          player: { isActive: true },
        },
      })) + 1;
  }

  let countryRank: number | null = null;
  if (countryStat) {
    countryRank =
      (await prisma.chessCountryPeriodCategoryStat.count({
        where: {
          ...whereBase,
          OR: [
            { wins: { gt: countryStat.wins } },
            { wins: countryStat.wins, updatedAt: { lt: countryStat.updatedAt } },
          ],
        },
      })) + 1;
  }

  return {
    players: players.map((row, index) => ({
      rank: index + 1,
      playerId: row.player.publicId,
      nickname: row.player.nickname,
      countryCode: row.player.countryCode,
      countryName: row.player.countryName,
      countryFlag: row.player.countryFlag,
      wins: row.wins,
      updatedAt: row.updatedAt.toISOString(),
    })),
    countries: countries.map((row, index) => ({
      rank: index + 1,
      countryCode: row.countryCode,
      countryName: row.countryName,
      countryFlag: row.countryFlag,
      wins: row.wins,
      updatedAt: row.updatedAt.toISOString(),
    })),
    playerRank,
    countryRank,
    playerWins: playerStat?.wins ?? 0,
    countryWins: countryStat?.wins ?? 0,
  };
}

async function getPlayerByPublicId(publicId: string | null) {
  if (!publicId) return null;
  if (!publicIdSchema.safeParse(publicId).success) return null;
  return prisma.chessPlayer.findUnique({ where: { publicId } });
}

function rankingPayload(args: {
  category: string;
  period: PeriodDescriptor;
  ranks: Awaited<ReturnType<typeof getRanks>>;
  player: Awaited<ReturnType<typeof getPlayerByPublicId>>;
}) {
  const { category, period, ranks, player } = args;
  return {
    ok: true,
    category,
    periodType: period.periodType,
    periodKey: period.periodKey,
    ...periodBounds(period.periodType, period.periodKey),
    generatedAt: new Date().toISOString(),
    players: ranks.players,
    countries: ranks.countries,
    me: player
      ? {
          playerId: player.publicId,
          nickname: player.nickname,
          countryCode: player.countryCode,
          countryName: player.countryName,
          countryFlag: player.countryFlag,
          isActive: player.isActive,
          totalWins: player.totalWins,
          categoryWins: ranks.playerWins,
          countryWins: ranks.countryWins,
          playerRank: ranks.playerRank,
          countryRank: ranks.countryRank,
        }
      : null,
  };
}

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Max-Age': '86400',
    },
  });
}

export async function GET(req: NextRequest) {
  const ip = clientIp(req);
  const rate = hitRateLimit(`read:${ip}`, RATE_LIMITS.read);
  if (!rate.ok) {
    return json(
      { ok: false, error: 'rate_limited' },
      429,
      { 'Retry-After': String(rate.retryAfterSec) },
    );
  }

  const category = req.nextUrl.searchParams.get('category') || 'classic_60__beginner';
  const parsedCategory = categorySchema.safeParse(category);
  if (!parsedCategory.success) {
    return json({ ok: false, error: 'invalid_category' }, 400);
  }

  const period = parsePeriodFromRequest(req);
  if (!period) {
    return json({ ok: false, error: 'invalid_period' }, 400);
  }

  const playerId = req.nextUrl.searchParams.get('playerId');
  const player = await getPlayerByPublicId(playerId);
  const ranks = await getRanks(period, parsedCategory.data, player?.id, player?.countryCode);

  return json(
    rankingPayload({ category: parsedCategory.data, period, ranks, player }),
    200,
    {
      'Cache-Control': playerId ? 'private, max-age=15' : 'public, s-maxage=30, stale-while-revalidate=120',
      'Access-Control-Allow-Origin': '*',
    },
  );
}

export async function POST(req: NextRequest) {
  const secret = getSecret();
  if (!secret) {
    return json(
      {
        ok: false,
        error: 'server_secret_missing',
        message: 'Set CHESS_CHAMPIONSHIP_SECRET or NEXTAUTH_SECRET on the server.',
      },
      503,
    );
  }

  const contentLength = Number(req.headers.get('content-length') || '0');
  if (contentLength > 4096) {
    return json({ ok: false, error: 'payload_too_large' }, 413);
  }

  const ip = clientIp(req);
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return json({ ok: false, error: 'invalid_json' }, 400);
  }

  const parsed = postSchema.safeParse(raw);
  if (!parsed.success) {
    return json({ ok: false, error: 'invalid_payload' }, 400);
  }

  const body = parsed.data;

  if (body.action === 'join') {
    const rate = hitRateLimit(`join:${ip}`, RATE_LIMITS.join);
    if (!rate.ok) {
      return json({ ok: false, error: 'rate_limited' }, 429, {
        'Retry-After': String(rate.retryAfterSec),
      });
    }

    const publicId = body.playerId || makePublicId();
    const countryName = sanitizeCountryName(body.countryName);

    const player = await prisma.chessPlayer.upsert({
      where: { publicId },
      create: {
        publicId,
        nickname: body.nickname,
        countryCode: body.countryCode,
        countryName,
        countryFlag: body.countryFlag,
        isActive: true,
        joinedAt: new Date(),
      },
      update: {
        nickname: body.nickname,
        countryCode: body.countryCode,
        countryName,
        countryFlag: body.countryFlag,
        isActive: true,
        leftAt: null,
        joinedAt: new Date(),
      },
    });

    const token = createToken(player.publicId);
    return json({
      ok: true,
      player: {
        playerId: player.publicId,
        nickname: player.nickname,
        countryCode: player.countryCode,
        countryName: player.countryName,
        countryFlag: player.countryFlag,
        isActive: player.isActive,
        totalWins: player.totalWins,
      },
      token,
    });
  }

  if (body.action === 'leave') {
    const rate = hitRateLimit(`leave:${ip}`, RATE_LIMITS.leave);
    if (!rate.ok) {
      return json({ ok: false, error: 'rate_limited' }, 429, {
        'Retry-After': String(rate.retryAfterSec),
      });
    }

    if (!verifyToken(body.playerId, body.token)) {
      return json({ ok: false, error: 'unauthorized' }, 401);
    }

    await prisma.chessPlayer.updateMany({
      where: { publicId: body.playerId },
      data: { isActive: false, leftAt: new Date() },
    });

    return json({ ok: true });
  }

  if (body.action === 'recordWin') {
    const ipRate = hitRateLimit(`win-ip:${ip}`, RATE_LIMITS.recordWinIp);
    if (!ipRate.ok) {
      return json({ ok: false, error: 'rate_limited' }, 429, {
        'Retry-After': String(ipRate.retryAfterSec),
      });
    }

    const playerRate = hitRateLimit(`win-player:${body.playerId}`, RATE_LIMITS.recordWinPlayer);
    if (!playerRate.ok) {
      return json({ ok: false, error: 'rate_limited' }, 429, {
        'Retry-After': String(playerRate.retryAfterSec),
      });
    }

    const burstRate = hitRateLimit(`win-burst:${body.playerId}`, RATE_LIMITS.recordWinBurst);
    if (!burstRate.ok) {
      return json({ ok: false, error: 'too_fast' }, 429, {
        'Retry-After': String(burstRate.retryAfterSec),
      });
    }

    if (!verifyToken(body.playerId, body.token)) {
      return json({ ok: false, error: 'unauthorized' }, 401);
    }

    const player = await prisma.chessPlayer.findUnique({ where: { publicId: body.playerId } });
    if (!player || !player.isActive) {
      return json({ ok: false, error: 'player_not_active' }, 403);
    }

    const category = categoryKey(body.timeControlId, body.difficulty);
    const serverNow = new Date();
    const submittedAt = body.occurredAt ? new Date(body.occurredAt) : serverNow;
    const safeOccurredAt =
      Number.isFinite(submittedAt.getTime()) &&
      Math.abs(submittedAt.getTime() - serverNow.getTime()) <= 10 * 60_000
        ? submittedAt
        : serverNow;
    const periods = [periodFromDate(serverNow, 'monthly'), periodFromDate(serverNow, 'yearly')];

    try {
      await prisma.$transaction(async (tx) => {
        await tx.chessWinEvent.create({
          data: {
            eventId: body.eventId,
            playerId: player.id,
            countryCode: player.countryCode,
            categoryKey: category,
            timeControlId: body.timeControlId,
            difficulty: body.difficulty,
            elapsedSec: body.elapsedSec ?? null,
            occurredAt: safeOccurredAt,
          },
        });

        await tx.chessPlayer.update({
          where: { id: player.id },
          data: { totalWins: { increment: 1 }, lastWinAt: serverNow },
        });

        await tx.chessPlayerCategoryStat.upsert({
          where: { playerId_categoryKey: { playerId: player.id, categoryKey: category } },
          create: {
            playerId: player.id,
            categoryKey: category,
            timeControlId: body.timeControlId,
            difficulty: body.difficulty,
            wins: 1,
            bestTimeSec: body.elapsedSec ?? null,
          },
          update: {
            wins: { increment: 1 },
            bestTimeSec:
              typeof body.elapsedSec === 'number'
                ? { set: body.elapsedSec }
                : undefined,
          },
        });

        await tx.chessCountryCategoryStat.upsert({
          where: { countryCode_categoryKey: { countryCode: player.countryCode, categoryKey: category } },
          create: {
            countryCode: player.countryCode,
            countryName: player.countryName,
            countryFlag: player.countryFlag,
            categoryKey: category,
            timeControlId: body.timeControlId,
            difficulty: body.difficulty,
            wins: 1,
          },
          update: {
            countryName: player.countryName,
            countryFlag: player.countryFlag,
            wins: { increment: 1 },
          },
        });

        for (const period of periods) {
          await tx.chessPlayerPeriodCategoryStat.upsert({
            where: {
              playerId_periodType_periodKey_categoryKey: {
                playerId: player.id,
                periodType: period.periodType,
                periodKey: period.periodKey,
                categoryKey: category,
              },
            },
            create: {
              playerId: player.id,
              periodType: period.periodType,
              periodKey: period.periodKey,
              categoryKey: category,
              timeControlId: body.timeControlId,
              difficulty: body.difficulty,
              wins: 1,
              bestTimeSec: body.elapsedSec ?? null,
            },
            update: {
              wins: { increment: 1 },
              bestTimeSec:
                typeof body.elapsedSec === 'number'
                  ? { set: body.elapsedSec }
                  : undefined,
            },
          });

          await tx.chessCountryPeriodCategoryStat.upsert({
            where: {
              countryCode_periodType_periodKey_categoryKey: {
                countryCode: player.countryCode,
                periodType: period.periodType,
                periodKey: period.periodKey,
                categoryKey: category,
              },
            },
            create: {
              countryCode: player.countryCode,
              countryName: player.countryName,
              countryFlag: player.countryFlag,
              periodType: period.periodType,
              periodKey: period.periodKey,
              categoryKey: category,
              timeControlId: body.timeControlId,
              difficulty: body.difficulty,
              wins: 1,
            },
            update: {
              countryName: player.countryName,
              countryFlag: player.countryFlag,
              wins: { increment: 1 },
            },
          });
        }
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        // Idempotent duplicate event: return the current leaderboard state instead of failing the app.
      } else {
        console.error('recordWin failed', error);
        return json({ ok: false, error: 'server_error' }, 500);
      }
    }

    const responsePeriod = periods[0];
    const freshPlayer = await prisma.chessPlayer.findUnique({ where: { publicId: body.playerId } });
    const ranks = await getRanks(responsePeriod, category, freshPlayer?.id, freshPlayer?.countryCode);

    return json(rankingPayload({ category, period: responsePeriod, ranks, player: freshPlayer }));
  }

  return json({ ok: false, error: 'unsupported_action' }, 400);
}
