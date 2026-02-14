// file: src/app/api/tg-jobs/route.ts

import { NextResponse } from 'next/server';
import { PrismaClient } from '@prisma/client';
import { telegramRequest } from '@/lib/telegram';

const globalForPrisma = global as unknown as { prisma: PrismaClient };
const prisma = globalForPrisma.prisma || new PrismaClient();
if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma;

// Определяем локальный интерфейс для канала, чтобы избежать ошибок импорта
interface TgChannel {
  id: string;
  priceStars: number;
  name: string;
  category: string;
  username: string;
}

// Получение списка каналов
export async function GET() {
  try {
    const channels = await prisma.tgChannel.findMany({
      where: { isActive: true },
      orderBy: { category: 'asc' },
    });
    return NextResponse.json(channels);
  } catch (error) {
    return NextResponse.json({ error: 'Database error' }, { status: 500 });
  }
}

export async function POST(req: Request) {
  const body = await req.json();

  // 1. Создание заказа (из Mini App)
  if (body.action === 'create_invoice') {
    const { channelIds, payload, type, userId, username } = body;

    if (!channelIds?.length || !payload || !type) {
      return NextResponse.json({ error: 'Invalid data' }, { status: 400 });
    }

    // Явно приводим результат к нашему интерфейсу
    const channels = (await prisma.tgChannel.findMany({
      where: { id: { in: channelIds } },
    })) as TgChannel[];
    
    // Теперь TypeScript знает, что у ch есть priceStars
    const totalAmount = channels.reduce((sum: number, ch: TgChannel) => sum + ch.priceStars, 0);

    const order = await prisma.tgOrder.create({
      data: {
        telegramUserId: String(userId),
        telegramUsername: username,
        type: type, // VACANCY или RESUME
        payload: JSON.stringify(payload),
        totalAmount: totalAmount,
        status: 'PENDING',
        channels: {
          create: channels.map((ch: TgChannel) => ({ channelId: ch.id }))
        }
      }
    });

    const invoiceData = {
      title: type === 'VACANCY' ? 'Публикация вакансии' : 'Публикация резюме',
      description: `Размещение в ${channels.length} канал(ах). Модерация перед публикацией.`,
      payload: order.id,
      currency: "XTR",
      prices: [{ label: "Размещение", amount: totalAmount }],
    };

    const tgResponse = await telegramRequest('createInvoiceLink', invoiceData);
    
    if (!tgResponse.ok) {
        console.error('Invoice Error:', tgResponse);
        return NextResponse.json({ error: 'Failed to create invoice' }, { status: 500 });
    }

    return NextResponse.json({ invoiceLink: tgResponse.result });
  }

  // 2. Webhook: Pre-checkout (Telegram проверяет возможность оплаты)
  if (body.pre_checkout_query) {
    await telegramRequest('answerPreCheckoutQuery', {
      pre_checkout_query_id: body.pre_checkout_query.id,
      ok: true,
    });
    return NextResponse.json({ ok: true });
  }

  // 3. Webhook: Successful Payment (Деньги списаны)
  if (body.message?.successful_payment) {
    const payment = body.message.successful_payment;
    const orderId = payment.invoice_payload;
    const chargeId = payment.telegram_payment_charge_id; // ВАЖНО для возврата

    await prisma.tgOrder.update({
      where: { id: orderId },
      data: { 
        status: 'PAID_WAITING_MODERATION',
        paymentId: payment.provider_payment_charge_id,
        telegramPaymentChargeId: chargeId 
      }
    });
    
    // Уведомляем пользователя
    await telegramRequest('sendMessage', {
        chat_id: body.message.chat.id,
        text: '✅ Оплата прошла успешно! Ваша заявка отправлена на модерацию. Мы пришлем уведомление о публикации.',
    });

    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ status: 'ignored' });
}