// file: src/app/[locale]/tg-admin/page.tsx

import { auth } from "@/auth";
import { redirect } from "next/navigation";
import { PrismaClient } from '@prisma/client';
import { revalidatePath } from "next/cache";
import { telegramRequest, formatOrderText } from "@/lib/telegram";
import { SignOutButton } from "@/components/sign-out-button";

const prisma = new PrismaClient();

// Локальные типы
type TgOrderType = 'VACANCY' | 'RESUME';

interface TgChannel {
  id: string;
  name: string;
  username: string;
  priceStars: number;
}

interface TgOrderChannel {
  id: string;
  channel: TgChannel;
}

interface TgOrder {
  id: string;
  telegramUserId: string;
  telegramUsername: string | null;
  type: TgOrderType; 
  payload: string;
  totalAmount: number;
  status: string;
  telegramPaymentChargeId: string | null;
  createdAt: Date;
  channels: TgOrderChannel[];
}

// Интерфейс ответа Telegram при отправке сообщения
interface TelegramMessageResponse {
    result?: {
        message_id: number;
        chat: {
            username?: string;
            id: number;
        }
    }
}

async function moderateOrder(formData: FormData) {
  "use server";
  
  const orderId = formData.get('orderId') as string;
  const action = formData.get('action') as string;
  
  const rawOrder = await prisma.tgOrder.findUnique({
    where: { id: orderId },
    include: { channels: { include: { channel: true } } }
  });

  const order = rawOrder as unknown as TgOrder;

  if (!order || order.status !== 'PAID_WAITING_MODERATION') {
    throw new Error('Order not valid for moderation');
  }

  if (action === 'approve') {
    const text = formatOrderText(order.type, order.payload);
    const publishedLinks: string[] = [];
    
    // Публикация и сбор ссылок
    for (const item of order.channels) {
        try {
           const res = await telegramRequest<TelegramMessageResponse['result']>('sendMessage', {
               chat_id: item.channel.username,
               text: text,
               parse_mode: 'HTML'
           });

           if (res.ok && res.result) {
               // Формируем ссылку: https://t.me/username/message_id
               const channelUser = item.channel.username.replace('@', '');
               publishedLinks.push(`https://t.me/${channelUser}/${res.result.message_id}`);
           }
        } catch (e) {
            console.error(`Error posting to ${item.channel.username}`, e);
        }
    }

    // Формируем отчет пользователю
    const linksList = publishedLinks.map((link, i) => `${i + 1}. ${link}`).join('\n');
    const userMessage = `✅ <b>Ваша заявка опубликована!</b>\n\nСсылки на посты:\n${linksList}\n\nСпасибо, что пользуетесь нашим сервисом!`;

    await telegramRequest('sendMessage', {
        chat_id: order.telegramUserId,
        text: userMessage,
        parse_mode: 'HTML',
        disable_web_page_preview: true
    });

    await prisma.tgOrder.update({
        where: { id: orderId },
        data: { status: 'PUBLISHED' }
    });

  } else if (action === 'reject') {
    if (!order.telegramPaymentChargeId) {
        throw new Error('No charge ID found for refund');
    }

    const refundRes = await telegramRequest('refundStarPayment', {
        user_id: parseInt(order.telegramUserId),
        telegram_payment_charge_id: order.telegramPaymentChargeId
    });

    if (!refundRes.ok) {
        throw new Error(`Refund failed: ${refundRes.description}`);
    }

    await telegramRequest('sendMessage', {
        chat_id: order.telegramUserId,
        text: '❌ Ваша заявка не прошла модерацию. Средства (Stars) были возвращены на ваш баланс.',
    });

    await prisma.tgOrder.update({
        where: { id: orderId },
        data: { status: 'REJECTED_REFUNDED' }
    });
  }

  revalidatePath('/tg-admin');
}

export default async function TgAdminPage() {
  const session = await auth();
  if (!session) redirect('/login');

  const rawPendingOrders = await prisma.tgOrder.findMany({
    where: { status: 'PAID_WAITING_MODERATION' },
    orderBy: { createdAt: 'asc' },
    include: { channels: { include: { channel: true } } }
  });

  const pendingOrders = rawPendingOrders as unknown as TgOrder[];

  return (
    <div className="container max-w-5xl mx-auto py-10 px-4">
      <div className="flex justify-between items-center mb-8">
        <h1 className="text-3xl font-bold">Модерация ({pendingOrders.length})</h1>
        <SignOutButton />
      </div>

      {pendingOrders.length === 0 ? (
        <div className="p-10 text-center bg-gray-50 rounded-xl border border-dashed">
            <p className="text-gray-500">Нет заявок на проверку 🎉</p>
        </div>
      ) : (
        <div className="space-y-8">
          {pendingOrders.map((order) => {
            const payload = JSON.parse(order.payload);
            const formattedText = formatOrderText(order.type, payload);

            return (
              <div key={order.id} className="bg-white border rounded-xl shadow-sm overflow-hidden">
                <div className="bg-gray-50 px-6 py-4 border-b flex justify-between items-center">
                    <div>
                        <span className={`text-xs font-bold px-2 py-1 rounded mr-2 ${order.type === 'VACANCY' ? 'bg-blue-100 text-blue-700' : 'bg-purple-100 text-purple-700'}`}>
                            {order.type === 'VACANCY' ? 'ВАКАНСИЯ' : 'РЕЗЮМЕ'}
                        </span>
                        <span className="text-sm text-gray-500">
                            от @{order.telegramUsername || order.telegramUserId}
                        </span>
                    </div>
                    <div className="text-sm font-bold text-yellow-700">
                        Оплачено: ⭐️ {order.totalAmount}
                    </div>
                </div>

                <div className="p-6 grid md:grid-cols-2 gap-6">
                    <div className="space-y-2 text-sm">
                        <p><strong>Каналы ({order.channels.length}):</strong></p>
                        <div className="flex flex-wrap gap-1 mb-4">
                            {order.channels.map((c) => (
                                <span key={c.id} className="bg-gray-100 px-2 py-1 rounded border text-xs">
                                    {c.channel.username}
                                </span>
                            ))}
                        </div>
                        
                        <div className="p-3 bg-gray-50 rounded border">
                            <pre className="whitespace-pre-wrap font-sans text-gray-700 text-sm">
                                {formattedText.replace(/<[^>]*>/g, '')}
                            </pre>
                        </div>
                    </div>

                    <div className="flex flex-col justify-center items-center space-y-4 border-l pl-6">
                        <form action={moderateOrder} className="w-full">
                            <input type="hidden" name="orderId" value={order.id} />
                            
                            <button 
                                type="submit" 
                                name="action" 
                                value="approve"
                                className="w-full mb-3 bg-green-600 hover:bg-green-700 text-white font-bold py-3 px-4 rounded transition flex items-center justify-center gap-2"
                            >
                                ✅ Опубликовать
                            </button>

                            <button 
                                type="submit" 
                                name="action" 
                                value="reject"
                                className="w-full bg-red-50 hover:bg-red-100 text-red-600 font-bold py-3 px-4 rounded border border-red-200 transition text-sm"
                            >
                                ❌ Отклонить и вернуть {order.totalAmount} ⭐️
                            </button>
                        </form>
                    </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}