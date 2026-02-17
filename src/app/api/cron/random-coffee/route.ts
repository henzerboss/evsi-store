// file: src/app/api/cron/random-coffee/route.ts

import { NextResponse } from 'next/server';
import { PrismaClient } from '@prisma/client';
import { telegramRequest } from '@/lib/telegram';

const globalForPrisma = global as unknown as { prisma: PrismaClient };
const prisma = globalForPrisma.prisma || new PrismaClient();
if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma;

const delay = (ms: number) => new Promise(res => setTimeout(res, ms));

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
}

interface Edge {
    u: ParticipationWithProfile;
    v: ParticipationWithProfile;
    weight: number;
}

// Функция подсчета пересечений интересов
function calculateInterestOverlap(s1: string, s2: string): number {
    if (!s1 || !s2) return 0;
    // Разбиваем на слова, убираем короткие (предлоги) и приводим к нижнему регистру
    const getWords = (s: string) => new Set(s.toLowerCase().split(/[\s,.-]+/).filter(w => w.length > 2));
    
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
    const dayOfWeek = now.getDay(); 

    // --- ЧЕТВЕРГ: НАПОМИНАНИЕ ---
    if (dayOfWeek === 4) { 
        const profiles = await prisma.randomCoffeeProfile.findMany();
        
        for (const profile of profiles) {
            try {
                await telegramRequest('sendMessage', {
                    chat_id: profile.telegramUserId,
                    text: `👋 Привет! Завтра пятница, а значит — Random Coffee!\n\nНе забудьте подтвердить участие, чтобы мы подобрали вам интересного собеседника.\n\n👇 Нажмите кнопку в боте или перейдите в Mini App.`,
                    reply_markup: {
                        inline_keyboard: [[{ text: "☕️ Участвовать", web_app: { url: "https://evsi.store/tg-app" } }]]
                    }
                });
                await delay(100); 
            } catch (e) {
                console.error(`Failed to send reminder to ${profile.telegramUserId}`, e);
            }
        }
        return NextResponse.json({ status: 'Reminders sent' });
    }

    // --- ПЯТНИЦА: УМНОЕ РАСПРЕДЕЛЕНИЕ ---
    if (dayOfWeek === 5) {
        const startOfDay = new Date(); startOfDay.setHours(0,0,0,0);
        const endOfDay = new Date(); endOfDay.setHours(23,59,59,999);

        // 1. Получаем участников
        const participations = (await prisma.randomCoffeeParticipation.findMany({
            where: {
                matchDate: { gte: startOfDay, lte: endOfDay },
                status: 'PAID'
            },
            include: { profile: true }
        })) as ParticipationWithProfile[];

        if (participations.length < 2) {
            // Если меньше 2 человек, возвращаем деньги всем (0 или 1)
            for (const p of participations) {
                 if (p.telegramPaymentChargeId) {
                    await telegramRequest('refundStarPayment', {
                        user_id: parseInt(p.profile.telegramUserId),
                        telegram_payment_charge_id: p.telegramPaymentChargeId
                    });
                    await telegramRequest('sendMessage', {
                        chat_id: p.profile.telegramUserId,
                        text: `😔 К сожалению, на этой неделе недостаточно участников для пары.\n\nМы вернули вам 100 звезд. Попробуйте на следующей неделе!`,
                    });
                    await prisma.randomCoffeeParticipation.update({ where: { id: p.id }, data: { status: 'REFUNDED' }});
                 }
            }
            return NextResponse.json({ status: 'Not enough participants', refunds: participations.length });
        }

        // 2. Получаем историю встреч для текущих участников
        const profileIds = participations.map(p => p.profileId);
        const history = await prisma.randomCoffeeHistory.findMany({
            where: {
                OR: [
                    { userAId: { in: profileIds } },
                    { userBId: { in: profileIds } }
                ]
            }
        });

        // Создаем Set запрещенных пар: "id1:id2" (где id1 < id2 алфавитно)
        const forbiddenPairs = new Set<string>();
        for (const h of history) {
            const [u, v] = [h.userAId, h.userBId].sort();
            forbiddenPairs.add(`${u}:${v}`);
        }

        // 3. Строим граф возможных ребер с весами
        // Вес = 1 (базовый) + 10 * (кол-во общих слов в интересах)
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
                
                // Проверяем историю
                const [id1, id2] = [u.profileId, v.profileId].sort();
                if (forbiddenPairs.has(`${id1}:${id2}`)) {
                    continue; // Уже встречались
                }

                const overlap = calculateInterestOverlap(u.profile.interests, v.profile.interests);
                // Базовый вес 1, чтобы пара была возможна даже без общих интересов
                // Бонус за интересы высокий, чтобы приоритизировать их
                const weight = 1 + (overlap * 10);
                
                edges.push({ u, v, weight });
            }
        }

        // Сортируем ребра по весу (по убыванию)
        edges.sort((a, b) => b.weight - a.weight);

        // 4. Жадный выбор пар
        const matchedProfileIds = new Set<string>();
        const pairs: ParticipationWithProfile[][] = [];

        for (const edge of edges) {
            // Если оба участника еще свободны
            if (!matchedProfileIds.has(edge.u.profileId) && !matchedProfileIds.has(edge.v.profileId)) {
                // Создаем пару
                matchedProfileIds.add(edge.u.profileId);
                matchedProfileIds.add(edge.v.profileId);
                pairs.push([edge.u, edge.v]);
            }
        }

        // 5. Обработка оставшихся (Refund)
        const leftovers = participations.filter(p => !matchedProfileIds.has(p.profileId));

        // 6. Сохранение и рассылка
        for (const [p1, p2] of pairs) {
            await prisma.randomCoffeeHistory.create({
                data: { userAId: p1.profileId, userBId: p2.profileId }
            });
            await prisma.randomCoffeeParticipation.update({ where: { id: p1.id }, data: { status: 'MATCHED', matchWithId: p2.profileId }});
            await prisma.randomCoffeeParticipation.update({ where: { id: p2.id }, data: { status: 'MATCHED', matchWithId: p1.profileId }});

            const msg1 = `☕️ <b>Ваша пара на эту неделю!</b>\n\n👤 <b>${p2.profile.name}</b>\n💼 ${p2.profile.specialty}\n🎯 ${p2.profile.interests}\n🔗 ${p2.profile.linkedin || 'Нет LinkedIn'}\n\nНапишите собеседнику: <a href="tg://user?id=${p2.profile.telegramUserId}">Написать</a>`;
            const msg2 = `☕️ <b>Ваша пара на эту неделю!</b>\n\n👤 <b>${p1.profile.name}</b>\n💼 ${p1.profile.specialty}\n🎯 ${p1.profile.interests}\n🔗 ${p1.profile.linkedin || 'Нет LinkedIn'}\n\nНапишите собеседнику: <a href="tg://user?id=${p1.profile.telegramUserId}">Написать</a>`;

            await telegramRequest('sendMessage', { chat_id: p1.profile.telegramUserId, text: msg1, parse_mode: 'HTML' });
            await telegramRequest('sendMessage', { chat_id: p2.profile.telegramUserId, text: msg2, parse_mode: 'HTML' });
        }

        for (const left of leftovers) {
            if (left.telegramPaymentChargeId) {
                await telegramRequest('refundStarPayment', {
                    user_id: parseInt(left.profile.telegramUserId),
                    telegram_payment_charge_id: left.telegramPaymentChargeId
                });
                
                await telegramRequest('sendMessage', {
                    chat_id: left.profile.telegramUserId,
                    text: `😔 К сожалению, на этой неделе нечетное количество участников или для вас не нашлось пары, с которой вы еще не встречались.\n\nМы вернули вам 100 звезд. Попробуйте на следующей неделе!`,
                });

                await prisma.randomCoffeeParticipation.update({ 
                    where: { id: left.id }, 
                    data: { status: 'REFUNDED' }
                });
            }
        }

        return NextResponse.json({ 
            status: 'Matched', 
            pairs: pairs.length, 
            refunds: leftovers.length 
        });
    }

    return NextResponse.json({ status: 'No action for today' });
}