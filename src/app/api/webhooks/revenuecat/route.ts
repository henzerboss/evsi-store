import { NextRequest, NextResponse } from 'next/server';

export async function POST(request: NextRequest) {
  try {
    // 1. Проверка авторизации (опционально, но рекомендуется)
    const authHeader = request.headers.get('authorization');
    if (authHeader !== process.env.REVENUECAT_WEBHOOK_AUTH) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const { event } = body;

    // 2. Формируем текст сообщения в зависимости от типа события
    let message = '';
    const type = event.type;
    const price = event.price_in_usd;
    const userId = event.app_user_id;
    const product = event.product_id;

    switch (type) {
      case 'INITIAL_PURCHASE':
        message = `💰 **Новая продажа!**\nПользователь: \`${userId}\`\nПродукт: \`${product}\`\nСумма: $${price}`;
        break;
      case 'RENEWAL':
        message = `🔄 **Продление подписки**\nПользователь: \`${userId}\`\nСумма: $${price}`;
        break;
      case 'CANCELLATION':
        message = `❌ **Отмена подписки**\nПользователь: \`${userId}\`\nПричина: ${event.cancel_reason || 'не указана'}`;
        break;
      default:
        // Можно игнорировать другие типы событий или слать общее уведомление
        message = `ℹ️ **Событие RevenueCat: ${type}**\nUser: \`${userId}\``;
        break;
    }

    // 3. Отправка в Telegram
    const tgUrl = `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`;
    
    await fetch(tgUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: process.env.TELEGRAM_CHAT_ID,
        text: message,
        parse_mode: 'Markdown',
      }),
    });

    return NextResponse.json({ received: true }, { status: 200 });
  } catch (error) {
    console.error('RevenueCat Webhook Error:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}