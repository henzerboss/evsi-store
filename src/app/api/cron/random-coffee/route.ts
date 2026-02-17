// file: src/app/api/cron/random-coffee/route.ts

import { NextResponse } from 'next/server';
import { PrismaClient } from '@prisma/client';
import { telegramRequest } from '@/lib/telegram';

const globalForPrisma = global as unknown as { prisma: PrismaClient };
const prisma = globalForPrisma.prisma || new PrismaClient();
if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma;

const delay = (ms: number) => new Promise(res => setTimeout(res, ms));

// ИСПРАВЛЕНИЕ: Локальные типы для устранения ошибок any
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

    // --- ПЯТНИЦА: РАСПРЕДЕЛЕНИЕ ---
    if (dayOfWeek === 5) {
        const startOfDay = new Date(); startOfDay.setHours(0,0,0,0);
        const endOfDay = new Date(); endOfDay.setHours(23,59,59,999);

        const participations = (await prisma.randomCoffeeParticipation.findMany({
            where: {
                matchDate: { gte: startOfDay, lte: endOfDay },
                status: 'PAID'
            },
            include: { profile: true }
        })) as ParticipationWithProfile[]; // Явное приведение типов

        if (participations.length === 0) {
            return NextResponse.json({ status: 'No participants' });
        }

        // Перемешиваем
        for (let i = participations.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [participations[i], participations[j]] = [participations[j], participations[i]];
        }

        // ИСПРАВЛЕНИЕ: Типизация массивов
        const pairs: ParticipationWithProfile[][] = [];
        const leftovers: ParticipationWithProfile[] = [];

        while (participations.length >= 2) {
            const p1 = participations.pop();
            const p2 = participations.pop();
            
            if (p1 && p2) {
                pairs.push([p1, p2]);
            }
        }

        if (participations.length > 0) {
            const left = participations[0];
            if (left) leftovers.push(left);
        }

        // 3. Рассылка и сохранение
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

        // 4. Возврат средств оставшимся
        for (const left of leftovers) {
            if (left.telegramPaymentChargeId) {
                await telegramRequest('refundStarPayment', {
                    user_id: parseInt(left.profile.telegramUserId),
                    telegram_payment_charge_id: left.telegramPaymentChargeId
                });
                
                await telegramRequest('sendMessage', {
                    chat_id: left.profile.telegramUserId,
                    text: `😔 К сожалению, на этой неделе нечетное количество участников, и мы не смогли подобрать вам пару.\n\nМы вернули вам 100 звезд. Попробуйте на следующей неделе!`,
                });

                await prisma.randomCoffeeParticipation.update({ 
                    where: { id: left.id }, 
                    data: { status: 'REFUNDED' }
                });
            }
        }

        return NextResponse.json({ status: 'Matched', pairs: pairs.length, refunds: leftovers.length });
    }

    return NextResponse.json({ status: 'No action for today' });
}