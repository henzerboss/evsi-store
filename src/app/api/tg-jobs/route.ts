// file: src/app/api/tg-jobs/route.ts

import { NextResponse } from 'next/server';
import { PrismaClient } from '@prisma/client';
import { telegramRequest } from '@/lib/telegram';

const globalForPrisma = global as unknown as { prisma: PrismaClient };
const prisma = globalForPrisma.prisma || new PrismaClient();
if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma;

interface TgChannel {
  id: string;
  priceStars: number;
  name: string;
  category: string;
  username: string;
}

// Хелпер для определения следующей пятницы
function getNextFriday() {
    const d = new Date();
    // 0 - вс, 1 - пн ... 5 - пт
    const day = d.getDay();
    const diff = 5 - day; 
    
    // Если сегодня пятница, считаем следующую
    const daysToAdd = diff <= 0 ? diff + 7 : diff;
    
    d.setDate(d.getDate() + daysToAdd);
    d.setHours(10, 0, 0, 0); // 10:00 МСК
    return d;
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const action = searchParams.get('action');
  const userId = searchParams.get('userId');

  // --- Загрузка профиля для Random Coffee ---
  if (action === 'get_profile' && userId) {
      try {
          const profile = await prisma.randomCoffeeProfile.findUnique({
              where: { telegramUserId: String(userId) }
          });

          let isParticipating = false;
          if (profile) {
              const nextFriday = getNextFriday();
              const participation = await prisma.randomCoffeeParticipation.findFirst({
                  where: {
                      profileId: profile.id,
                      matchDate: nextFriday,
                      status: 'PAID'
                  }
              });
              if (participation) isParticipating = true;
          }

          return NextResponse.json({ profile, isParticipating });
      } catch {
          return NextResponse.json({ profile: null, isParticipating: false });
      }
  }

  try {
    const channels = await prisma.tgChannel.findMany({
      where: { isActive: true },
      orderBy: { category: 'asc' },
    });
    return NextResponse.json(channels);
  } catch {
    return NextResponse.json({ error: 'Database error' }, { status: 500 });
  }
}

export async function POST(req: Request) {
  const body = await req.json();

  // --- ОТМЕНА УЧАСТИЯ И ВОЗВРАТ ---
  if (body.action === 'cancel_random_coffee') {
      const { userId } = body;
      const nextFriday = getNextFriday();

      const participation = await prisma.randomCoffeeParticipation.findFirst({
          where: {
              profile: { telegramUserId: String(userId) },
              matchDate: nextFriday,
              status: 'PAID'
          },
          include: { profile: true }
      });

      if (!participation || !participation.telegramPaymentChargeId) {
           return NextResponse.json({ error: 'Запись не найдена или уже отменена' }, { status: 400 });
      }

      // Делаем возврат звезд
      const refundRes = await telegramRequest('refundStarPayment', {
          user_id: parseInt(participation.profile.telegramUserId, 10), // Явно указываем систему счисления
          telegram_payment_charge_id: participation.telegramPaymentChargeId
      });

      if (!refundRes.ok) {
           console.error('Refund failed:', refundRes);
           // Возвращаем реальную причину от Telegram
           return NextResponse.json({ error: refundRes.description || 'Ошибка возврата средств (Telegram API)' }, { status: 500 });
      }

      // Обновляем статус в БД
      await prisma.randomCoffeeParticipation.update({
          where: { id: participation.id },
          data: { status: 'REFUNDED_BY_USER' }
      });

      return NextResponse.json({ ok: true });
  }

  // 1. Создание инвойса
  if (body.action === 'create_invoice') {
    const { channelIds, payload, type, userId, username } = body;

    let totalAmount = 0;
    
    if (type === 'RANDOM_COFFEE') {
        totalAmount = 100;
    } else {
        if (!channelIds?.length) {
            return NextResponse.json({ error: 'Invalid data' }, { status: 400 });
        }
        const channels = (await prisma.tgChannel.findMany({
            where: { id: { in: channelIds } },
        })) as TgChannel[];
        
        totalAmount = channels.reduce((sum: number, ch: TgChannel) => sum + ch.priceStars, 0);
    }

    const order = await prisma.tgOrder.create({
      data: {
        telegramUserId: String(userId),
        telegramUsername: username,
        type: type, 
        payload: JSON.stringify(payload),
        totalAmount: totalAmount,
        status: 'PENDING',
        channels: {
          create: type === 'RANDOM_COFFEE' 
            ? [] 
            : channelIds.map((id: string) => ({ channelId: id }))
        }
      }
    });

    const title = type === 'RANDOM_COFFEE' ? 'Участие в Random Coffee' : (type === 'VACANCY' ? 'Публикация вакансии' : 'Публикация резюме');
    const description = type === 'RANDOM_COFFEE' 
        ? `Нетворкинг в ближайшую пятницу.` 
        : `Размещение в ${channelIds.length} канал(ах).`;

    const invoiceData = {
      title: title,
      description: description,
      payload: order.id,
      currency: "XTR",
      prices: [{ label: "Услуга", amount: totalAmount }],
    };

    const tgResponse = await telegramRequest('createInvoiceLink', invoiceData);
    
    if (!tgResponse.ok) {
        return NextResponse.json({ error: 'Failed to create invoice' }, { status: 500 });
    }

    return NextResponse.json({ invoiceLink: tgResponse.result });
  }

  // 2. Pre-checkout
  if (body.pre_checkout_query) {
    await telegramRequest('answerPreCheckoutQuery', {
      pre_checkout_query_id: body.pre_checkout_query.id,
      ok: true,
    });
    return NextResponse.json({ ok: true });
  }

  // 3. Успешная оплата
  if (body.message?.successful_payment) {
    const payment = body.message.successful_payment;
    const orderId = payment.invoice_payload;
    const chargeId = payment.telegram_payment_charge_id;

    const updatedOrder = await prisma.tgOrder.update({
      where: { id: orderId },
      data: { 
        status: 'PAID_WAITING_MODERATION', 
        paymentId: payment.provider_payment_charge_id,
        telegramPaymentChargeId: chargeId 
      }
    });

    const adminChatId = process.env.TELEGRAM_ADMIN_ID;

    // --- ЛОГИКА ДЛЯ RANDOM COFFEE ---
    if (updatedOrder.type === 'RANDOM_COFFEE') {
        const data = JSON.parse(updatedOrder.payload);
        const userId = updatedOrder.telegramUserId;

        const profile = await prisma.randomCoffeeProfile.upsert({
            where: { telegramUserId: userId },
            update: {
                name: data.rcName,
                specialty: data.rcSpecialty,
                interests: data.rcInterests,
                linkedin: data.rcLinkedin
            },
            create: {
                telegramUserId: userId,
                name: data.rcName,
                specialty: data.rcSpecialty,
                interests: data.rcInterests,
                linkedin: data.rcLinkedin
            }
        });

        const nextFriday = getNextFriday();
        await prisma.randomCoffeeParticipation.create({
            data: {
                profileId: profile.id,
                matchDate: nextFriday,
                status: 'PAID',
                telegramPaymentChargeId: chargeId
            }
        });

        const dateStr = nextFriday.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' });
        await telegramRequest('sendMessage', {
            chat_id: body.message.chat.id,
            text: `☕️ <b>Оплата принята! Вы в игре.</b>\n\nРаспределение пар произойдет в пятницу <b>${dateStr} в 10:00 МСК</b>.\nБот пришлет вам контакт собеседника.\n\nУдачи!`,
            parse_mode: 'HTML'
        });

        if (adminChatId) {
            try {
                await telegramRequest('sendMessage', {
                    chat_id: adminChatId,
                    text: `☕️ <b>Новый участник Random Coffee!</b>\n\n` +
                          `<b>Пользователь:</b> @${updatedOrder.telegramUsername || updatedOrder.telegramUserId}\n` +
                          `<b>Сумма:</b> ${updatedOrder.totalAmount} ⭐️\n` +
                          `<b>ID заказа:</b> <code>${updatedOrder.id}</code>`,
                    parse_mode: 'HTML',
                    reply_markup: {
                        inline_keyboard: [[{ text: "Перейти в RC админку", url: "https://evsi.store/ru/tg-admin/random-coffee" }]]
                    }
                });
            } catch (e) {}
        }

        return NextResponse.json({ ok: true });
    }
    
    // --- ЛОГИКА ДЛЯ ВАКАНСИЙ/РЕЗЮМЕ ---
    await telegramRequest('sendMessage', {
        chat_id: body.message.chat.id,
        text: `✅ <b>Оплата прошла успешно!</b>\n\nВаша заявка отправлена на модерацию.\n\n⏳ <b>Модерация занимает до 24 часов.</b>\n📢 Публикация происходит ежедневно с 09:00 до 20:00 МСК.\n\nМы пришлем вам ссылки на посты сразу после публикации.`,
        parse_mode: 'HTML'
    });

    if (adminChatId) {
        try {
            await telegramRequest('sendMessage', {
                chat_id: adminChatId,
                text: `🔥 <b>Новая заявка на модерацию!</b>\n\n` +
                      `<b>Тип:</b> ${updatedOrder.type === 'VACANCY' ? '💼 Вакансия' : '👤 Резюме'}\n` +
                      `<b>Пользователь:</b> @${updatedOrder.telegramUsername || updatedOrder.telegramUserId}\n` +
                      `<b>Сумма:</b> ${updatedOrder.totalAmount} ⭐️\n` +
                      `<b>ID заказа:</b> <code>${updatedOrder.id}</code>`,
                parse_mode: 'HTML',
                reply_markup: {
                    inline_keyboard: [
                        [{ text: "Перейти в админку", url: "https://evsi.store/ru/tg-admin" }]
                    ]
                }
            });
        } catch (e) {}
    }

    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ status: 'ignored' });
}