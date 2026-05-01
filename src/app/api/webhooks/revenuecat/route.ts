import { NextRequest, NextResponse } from 'next/server';

export async function POST(request: NextRequest) {
  try {
    const authHeader = request.headers.get('authorization');
    if (authHeader !== process.env.REVENUECAT_WEBHOOK_AUTH) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const { event } = body;

    const type = event.type;
    // Используем цену в USD
    const priceUSD = event.price; 
    const productId = event.product_id;
    const store = event.store;
    const userId = event.app_user_id;

    const storeIcon = store === 'PLAY_STORE' ? '🤖 Google Play' : '🍏 App Store';

    let message = '';

    switch (type) {
      case 'INITIAL_PURCHASE':
        message = `💰 **НОВАЯ ПРОДАЖА!**\n\n` +
                  `💵 **Сумма:** $${priceUSD}\n` +
                  `📦 **Товар:** \`${productId}\`\n` +
                  `🏪 **Магазин:** ${storeIcon}\n` +
                  `👤 **ID:** \`${userId}\``;
        break;
      case 'RENEWAL':
        message = `🔄 **Продление подписки**\n` +
                  `💵 **Сумма:** $${priceUSD}\n` +
                  `👤 **User:** \`${userId}\``;
        break;
      case 'CANCELLATION':
        message = `❌ **Отмена подписки**\n` +
                  `👤 **User:** \`${userId}\`\n` +
                  `📝 **Причина:** ${event.cancel_reason || 'не указана'}`;
        break;
      default:
        message = `ℹ️ **Событие:** ${type}\n` +
                  `👤 **User:** \`${userId}\``;
    }

    // Отправка в Telegram
    await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN_RC}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: process.env.TELEGRAM_CHAT_ID,
        text: message,
        parse_mode: 'Markdown',
      }),
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error('Webhook Error:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}