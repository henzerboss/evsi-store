import { NextResponse } from 'next/server';
import { PrismaClient } from '@prisma/client';
import { telegramRequest } from '@/lib/telegram';
import { sendNotificationEmail } from '@/lib/mail'; 

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

  // 1. Создание инвойса
  if (body.action === 'create_invoice') {
    const { channelIds, payload, type, userId, username } = body;

    if (!channelIds?.length || !payload || !type) {
      return NextResponse.json({ error: 'Invalid data' }, { status: 400 });
    }

    const channels = (await prisma.tgChannel.findMany({
      where: { id: { in: channelIds } },
    })) as TgChannel[];
    
    const totalAmount = channels.reduce((sum: number, ch: TgChannel) => sum + ch.priceStars, 0);

    const order = await prisma.tgOrder.create({
      data: {
        telegramUserId: String(userId),
        telegramUsername: username,
        type: type, 
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
      description: `Размещение в ${channels.length} канал(ах). Модерация до 24 часов.`,
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

  // 2. Pre-checkout
  if (body.pre_checkout_query) {
    await telegramRequest('answerPreCheckoutQuery', {
      pre_checkout_query_id: body.pre_checkout_query.id,
      ok: true,
    });
    return NextResponse.json({ ok: true });
  }

  // 3. Успешная оплата -> Отправка на модерацию
  if (body.message?.successful_payment) {
    const payment = body.message.successful_payment;
    const orderId = payment.invoice_payload;
    const chargeId = payment.telegram_payment_charge_id;

    // Обновляем статус в БД
    const updatedOrder = await prisma.tgOrder.update({
      where: { id: orderId },
      data: { 
        status: 'PAID_WAITING_MODERATION',
        paymentId: payment.provider_payment_charge_id,
        telegramPaymentChargeId: chargeId 
      }
    });
    
    // Уведомляем пользователя в Telegram
    // Делаем это параллельно с отправкой почты для скорости, или последовательно
    await telegramRequest('sendMessage', {
        chat_id: body.message.chat.id,
        text: `✅ <b>Оплата прошла успешно!</b>\n\nВаша заявка отправлена на модерацию.\n\n⏳ <b>Модерация занимает до 24 часов.</b>\n📢 Публикация происходит ежедневно с 09:00 до 20:00 МСК.\n\nМы пришлем вам ссылки на посты сразу после публикации.`,
        parse_mode: 'HTML'
    });

    // --- ОТПРАВКА EMAIL АДМИНУ ---
    // Добавили await, чтобы процесс дождался отправки
    console.log('Start sending email...');
    try {
        await sendNotificationEmail(
            updatedOrder.id, 
            updatedOrder.type, 
            updatedOrder.totalAmount, 
            updatedOrder.telegramUsername
        );
    } catch (e) {
        console.error('Critical email error:', e);
    }

    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ status: 'ignored' });
}