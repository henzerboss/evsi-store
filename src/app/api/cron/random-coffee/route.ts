// file: src/app/api/cron/random-coffee/route.ts

import { NextResponse } from 'next/server';
import { PrismaClient } from '@prisma/client';
import { telegramRequest } from '@/lib/telegram';

const globalForPrisma = global as unknown as { prisma: PrismaClient };
const prisma = globalForPrisma.prisma || new PrismaClient();
if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma;

const delay = (ms: number) => new Promise((res) => setTimeout(res, ms));

/**
 * Важно:
 * - tg://user?id=... часто не кликается у пользователей.
 * - Надежный вариант: https://t.me/<username>
 * - Username берем из TgOrder.telegramUsername (без миграций).
 */

const RC_PRICE_STARS = Number(process.env.RANDOM_COFFEE_PRICE_STARS || 100);
const MINI_APP_URL = process.env.RANDOM_COFFEE_MINI_APP_URL || 'https://evsi.store/tg-app';
const CRON_TZ = process.env.CRON_TZ || 'Europe/Moscow';

function sanitizeForHtml(str: string | undefined | null): string {
  if (!str) return '';
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function safeUsername(u?: string | null): string | null {
  if (!u) return null;
  const cleaned = String(u).trim().replace(/^@/, '');
  return cleaned ? cleaned : null;
}

function getWeekdayInTz(date = new Date(), timeZone = CRON_TZ): number {
  const wd = new Intl.DateTimeFormat('en-US', { timeZone, weekday: 'short' }).format(date);
  const map: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return map[wd] ?? date.getDay();
}

function startEndOfTomorrowInTz(timeZone = CRON_TZ) {
  // Получаем "завтра" и границы дня, ориентируясь на timezone
  // Делаем через форматирование даты в TZ, чтобы не зависеть от TZ сервера.
  const now = new Date();
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);

  const y = Number(parts.find((p) => p.type === 'year')?.value);
  const m = Number(parts.find((p) => p.type === 'month')?.value);
  const d = Number(parts.find((p) => p.type === 'day')?.value);

  // Создаем "полночь сегодня" как UTC-дату, затем добавим сутки
  const todayUtc = new Date(Date.UTC(y, m - 1, d, 0, 0, 0, 0));
  const tomorrowUtc = new Date(todayUtc);
  tomorrowUtc.setUTCDate(tomorrowUtc.getUTCDate() + 1);

  const start = new Date(tomorrowUtc);
  const end = new Date(tomorrowUtc);
  end.setUTCHours(23, 59, 59, 999);

  // В БД у тебя matchDate хранится как DateTime (обычно в UTC). Мы подаем UTC границы.
  return { start, end };
}

// Локальные типы
interface Profile {
  id: string;
  telegramUserId: string;
  name: string;
  specialty: string;
  interests: string;
  linkedin: string | null;
}

interface ParticipationWithProfile {
  id: string;
  profileId: string;
  telegramPaymentChargeId: string | null;
  profile: Profile;
  matchWithId?: string | null;
}

interface Edge {
  u: ParticipationWithProfile;
  v: ParticipationWithProfile;
  weight: number;
}

// Функция подсчета пересечений интересов
function calculateInterestOverlap(s1: string, s2: string): number {
  if (!s1 || !s2) return 0;
  const getWords = (s: string) => new Set(s.toLowerCase().split(/[\s,.-]+/).filter((w) => w.length > 2));

  const words1 = getWords(s1);
  const words2 = getWords(s2);

  let overlap = 0;
  for (const w of words1) {
    if (words2.has(w)) overlap++;
  }
  return overlap;
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  if (searchParams.get('secret') !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const now = new Date();
  const dayOfWeek = getWeekdayInTz(now); // 0..6 (Sun..Sat) в CRON_TZ

  // --- ЧЕТВЕРГ: НАПОМИНАНИЕ (умное) ---
  if (dayOfWeek === 4) {
    const { start, end } = startEndOfTomorrowInTz(CRON_TZ);

    // ✅ FIX 1: правильная модель randomCoffeeProfile
    const profiles = await prisma.randomCoffeeProfile.findMany({
      select: { telegramUserId: true },
    });

    // Собираем участия на "завтра" (пятницу)
    const participations = await prisma.randomCoffeeParticipation.findMany({
      where: {
        matchDate: { gte: start, lte: end },
        status: { in: ['PAID', 'MATCHED'] },
      },
      select: { profile: { select: { telegramUserId: true } } },
    });

    const confirmed = new Set<string>(participations.map((p) => p.profile.telegramUserId));

    let sentNeedConfirm = 0;
    let sentAlreadyIn = 0;

    // ✅ FIX 2: profiles существует
    for (const profile of profiles) {
      const isConfirmed = confirmed.has(profile.telegramUserId);

      const textNeedConfirm =
        `👋 Привет! Завтра пятница, а значит — Random Coffee!\n\n` +
        `Не забудьте подтвердить участие, чтобы мы подобрали вам интересного собеседника.\n\n` +
        `👇 Нажмите кнопку или откройте Mini App.`;

      const textAlreadyIn =
        `✅ Вы уже подтвердили участие в Random Coffee на этой неделе.\n\n` +
        `Завтра мы подберем вам пару и пришлём контакт собеседника.\n\n` +
        `Если хотите изменить анкету — откройте Mini App и обновите профиль.`;

      try {
        await telegramRequest('sendMessage', {
          chat_id: profile.telegramUserId,
          text: isConfirmed ? textAlreadyIn : textNeedConfirm,
          reply_markup: {
            inline_keyboard: [
              [
                {
                  text: isConfirmed ? '☕️ Открыть Mini App' : '☕️ Участвовать',
                  web_app: { url: MINI_APP_URL },
                },
              ],
            ],
          },
        });

        if (isConfirmed) sentAlreadyIn++;
        else sentNeedConfirm++;

        await delay(120);
      } catch (e) {
        console.error(`Failed to send reminder to ${profile.telegramUserId}`, e);
      }
    }

    return NextResponse.json({
      status: 'Reminders sent',
      total: profiles.length,
      alreadyConfirmed: sentAlreadyIn,
      needConfirm: sentNeedConfirm,
    });
  }

  // --- ПЯТНИЦА: УМНОЕ РАСПРЕДЕЛЕНИЕ ---
  if (dayOfWeek === 5) {
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date();
    endOfDay.setHours(23, 59, 59, 999);

    // 1. Получаем участников
    const participations = (await prisma.randomCoffeeParticipation.findMany({
      where: {
        matchDate: { gte: startOfDay, lte: endOfDay },
        status: 'PAID',
      },
      include: { profile: true },
    })) as unknown as ParticipationWithProfile[];

    // --- ДОП: username из TgOrder для кликабельных ссылок https://t.me/<username> ---
    const userIds = participations.map((p) => p.profile.telegramUserId);

    const orders = userIds.length
      ? await prisma.tgOrder.findMany({
          where: {
            telegramUserId: { in: userIds },
            type: 'RANDOM_COFFEE',
            telegramUsername: { not: null },
          },
          orderBy: { createdAt: 'desc' },
        })
      : [];

    const usernameByUserId = new Map<string, string>();
    for (const o of orders) {
      const uname = safeUsername(o.telegramUsername);
      if (!uname) continue;
      if (!usernameByUserId.has(o.telegramUserId)) {
        usernameByUserId.set(o.telegramUserId, uname);
      }
    }

    const buildContactLine = (telegramUserId: string) => {
      const uname = usernameByUserId.get(telegramUserId);
      if (uname) {
        const link = `https://t.me/${uname}`;
        return `<a href="${link}">Написать в Telegram</a>`;
      }
      return `Telegram ID: <code>${sanitizeForHtml(telegramUserId)}</code>`;
    };

    if (participations.length < 2) {
      // Если меньше 2 человек, возвращаем деньги всем (0 или 1)
      for (const p of participations) {
        if (p.telegramPaymentChargeId) {
          try {
            await telegramRequest('refundStarPayment', {
              user_id: parseInt(p.profile.telegramUserId, 10),
              telegram_payment_charge_id: p.telegramPaymentChargeId,
            });

            await telegramRequest('sendMessage', {
              chat_id: p.profile.telegramUserId,
              text:
                `😔 К сожалению, на этой неделе недостаточно участников для пары.\n\n` +
                `Мы вернули вам ${RC_PRICE_STARS} звезд. Попробуйте на следующей неделе!`,
            });

            await prisma.randomCoffeeParticipation.update({
              where: { id: p.id },
              data: { status: 'REFUNDED' },
            });

            await delay(120);
          } catch (e) {
            console.error('Refund flow failed for', p.profile.telegramUserId, e);
          }
        }
      }
      return NextResponse.json({ status: 'Not enough participants', refunds: participations.length });
    }

    // 2. Получаем историю встреч для текущих участников
    const profileIds = participations.map((p) => p.profileId);
    const history = await prisma.randomCoffeeHistory.findMany({
      where: {
        OR: [{ userAId: { in: profileIds } }, { userBId: { in: profileIds } }],
      },
    });

    // Set запрещенных пар: "id1:id2" (где id1 < id2)
    const forbiddenPairs = new Set<string>();
    for (const h of history) {
      const [u, v] = [h.userAId, h.userBId].sort();
      forbiddenPairs.add(`${u}:${v}`);
    }

    // 3. Строим граф ребер с весами
    const edges: Edge[] = [];

    // Перемешиваем участников для случайности при равных весах
    for (let i = participations.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [participations[i], participations[j]] = [participations[j], participations[i]];
    }

    for (let i = 0; i < participations.length; i++) {
      for (let j = i + 1; j < participations.length; j++) {
        const u = participations[i];
        const v = participations[j];

        const [id1, id2] = [u.profileId, v.profileId].sort();
        if (forbiddenPairs.has(`${id1}:${id2}`)) continue;

        const overlap = calculateInterestOverlap(u.profile.interests, v.profile.interests);
        const weight = 1 + overlap * 10;

        edges.push({ u, v, weight });
      }
    }

    edges.sort((a, b) => b.weight - a.weight);

    // 4. Жадный выбор пар
    const matchedProfileIds = new Set<string>();
    const pairs: ParticipationWithProfile[][] = [];

    for (const edge of edges) {
      if (!matchedProfileIds.has(edge.u.profileId) && !matchedProfileIds.has(edge.v.profileId)) {
        matchedProfileIds.add(edge.u.profileId);
        matchedProfileIds.add(edge.v.profileId);
        pairs.push([edge.u, edge.v]);
      }
    }

    // 5. Оставшиеся (Refund)
    const leftovers = participations.filter((p) => !matchedProfileIds.has(p.profileId));

    // 6. Сохранение и рассылка
    for (const [p1, p2] of pairs) {
      await prisma.randomCoffeeHistory.create({
        data: { userAId: p1.profileId, userBId: p2.profileId },
      });

      await prisma.randomCoffeeParticipation.update({
        where: { id: p1.id },
        data: { status: 'MATCHED', matchWithId: p2.profileId },
      });

      await prisma.randomCoffeeParticipation.update({
        where: { id: p2.id },
        data: { status: 'MATCHED', matchWithId: p1.profileId },
      });

      const msg1 =
        `☕️ <b>Ваша пара на эту неделю!</b>\n\n` +
        `👤 <b>${sanitizeForHtml(p2.profile.name)}</b>\n` +
        `💼 ${sanitizeForHtml(p2.profile.specialty)}\n` +
        `🎯 ${sanitizeForHtml(p2.profile.interests)}\n` +
        `🔗 ${p2.profile.linkedin ? sanitizeForHtml(p2.profile.linkedin) : 'Нет LinkedIn'}\n\n` +
        `Напишите собеседнику: ${buildContactLine(p2.profile.telegramUserId)}`;

      const msg2 =
        `☕️ <b>Ваша пара на эту неделю!</b>\n\n` +
        `👤 <b>${sanitizeForHtml(p1.profile.name)}</b>\n` +
        `💼 ${sanitizeForHtml(p1.profile.specialty)}\n` +
        `🎯 ${sanitizeForHtml(p1.profile.interests)}\n` +
        `🔗 ${p1.profile.linkedin ? sanitizeForHtml(p1.profile.linkedin) : 'Нет LinkedIn'}\n\n` +
        `Напишите собеседнику: ${buildContactLine(p1.profile.telegramUserId)}`;

      try {
        await telegramRequest('sendMessage', {
          chat_id: p1.profile.telegramUserId,
          text: msg1,
          parse_mode: 'HTML',
          disable_web_page_preview: true,
        });
        await delay(120);
      } catch (e) {
        console.error('Failed to send match msg to', p1.profile.telegramUserId, e);
      }

      try {
        await telegramRequest('sendMessage', {
          chat_id: p2.profile.telegramUserId,
          text: msg2,
          parse_mode: 'HTML',
          disable_web_page_preview: true,
        });
        await delay(120);
      } catch (e) {
        console.error('Failed to send match msg to', p2.profile.telegramUserId, e);
      }
    }

    for (const left of leftovers) {
      if (left.telegramPaymentChargeId) {
        try {
          await telegramRequest('refundStarPayment', {
            user_id: parseInt(left.profile.telegramUserId, 10),
            telegram_payment_charge_id: left.telegramPaymentChargeId,
          });

          await telegramRequest('sendMessage', {
            chat_id: left.profile.telegramUserId,
            text:
              `😔 К сожалению, на этой неделе нечетное количество участников или для вас не нашлось пары, ` +
              `с которой вы еще не встречались.\n\nМы вернули вам ${RC_PRICE_STARS} звезд. Попробуйте на следующей неделе!`,
          });

          await prisma.randomCoffeeParticipation.update({
            where: { id: left.id },
            data: { status: 'REFUNDED' },
          });

          await delay(120);
        } catch (e) {
          console.error('Refund flow failed for', left.profile.telegramUserId, e);
        }
      }
    }

    return NextResponse.json({
      status: 'Matched',
      pairs: pairs.length,
      refunds: leftovers.length,
      participants: participations.length,
      usernameFound: usernameByUserId.size,
    });
  }

  return NextResponse.json({ status: 'No action for today' });
}