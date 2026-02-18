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

// Интерфейсы для AI
interface ResumeData {
  title: string;
  salary: string;
  experience: string;
  skills: string;
  description: string;
  contacts: string;
}

interface AIChange {
  field: string;
  what_fixed: string;
  why: string;
}

interface AIResult {
  resume: ResumeData;
  changes: AIChange[];
}

// Helper: Get next Friday
function getNextFriday() {
    const d = new Date();
    const day = d.getDay();
    const diff = 5 - day; 
    const daysToAdd = diff <= 0 ? diff + 7 : diff;
    d.setDate(d.getDate() + daysToAdd);
    d.setHours(10, 0, 0, 0); 
    return d;
}

// Helper: Gemini AI Call
async function generateImprovedResume(resumeData: ResumeData): Promise<AIResult> {
    const apiKey = process.env.GEMINI_API_KEY_RESUME;
    if (!apiKey) throw new Error("API Key not configured");

    const prompt = `
Ты — опытный HR, карьерный консультант и специалист по подбору персонала с 10+ лет опыта.
Твоя задача — проверить и улучшить резюме кандидата.

ВАЖНО:
1. Сохраняй смысл. Не выдумывай факты.
2. Улучшай стиль, грамматику, ясность. Делай текст конкретным и деловым.
3. Убирай воду и клише.
4. Не используй длинное тире или спецсимволы, выдающие ИИ.
5. Проверяй соответствие должности и опыта.

ФОРМАТ JSON:
{
  "resume": {
    "title": "Исправленная должность (макс 150)",
    "salary": "Исправленная зп (макс 100)",
    "experience": "Исправленный опыт (макс 500)",
    "skills": "Исправленные навыки (макс 500)",
    "description": "Исправленное описание (макс 3000)",
    "contacts": "Исправленные контакты (макс 200)"
  },
  "changes": [
    { "field": "Название поля", "what_fixed": "Что исправлено", "why": "Почему это лучше" }
  ]
}

Данные кандидата:
Желаемая должность: ${resumeData.title}
Зарплатные ожидания: ${resumeData.salary}
Опыт работы: ${resumeData.experience}
Ключевые навыки: ${resumeData.skills}
Описание: ${resumeData.description}
Контакты: ${resumeData.contacts}
`;

    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent?key=${apiKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: { responseMimeType: "application/json" }
        })
    });

    if (!response.ok) {
        const err = await response.text();
        throw new Error(`Gemini API Error: ${err}`);
    }

    const data = await response.json();
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) throw new Error("No content generated");
    
    return JSON.parse(text) as AIResult;
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const action = searchParams.get('action');
  const userId = searchParams.get('userId');

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

  // --- AI RESUME FIX: 1. Create Invoice ---
  if (body.action === 'create_ai_invoice') {
      const { userId, payload } = body;
      
      const order = await prisma.tgOrder.create({
          data: {
              telegramUserId: String(userId),
              telegramUsername: body.username,
              type: 'RESUME_AI',
              payload: JSON.stringify(payload),
              totalAmount: 100,
              status: 'PENDING',
              channels: { create: [] }
          }
      });

      const invoiceData = {
          title: "AI-улучшение резюме",
          description: "Профессиональная коррекция текста с помощью ИИ.",
          payload: order.id,
          currency: "XTR",
          prices: [{ label: "AI Analysis", amount: 100 }],
      };

      const tgResponse = await telegramRequest('createInvoiceLink', invoiceData);
      
      if (!tgResponse.ok) {
          return NextResponse.json({ error: 'Failed to create invoice' }, { status: 500 });
      }
      return NextResponse.json({ invoiceLink: tgResponse.result, orderId: order.id });
  }

  // --- AI RESUME FIX: 2. Generate Content ---
  if (body.action === 'generate_ai_resume') {
      const { orderId } = body;

      const order = await prisma.tgOrder.findUnique({ where: { id: orderId } });
      
      if (!order || order.status !== 'PAID_WAITING_MODERATION') {
          return NextResponse.json({ error: 'Order not paid or processing', code: 'ORDER_NOT_READY' }, { status: 400 });
      }

      try {
          const originalData = JSON.parse(order.payload) as ResumeData;
          const aiResult = await generateImprovedResume(originalData);

          await prisma.tgOrder.update({
              where: { id: orderId },
              data: { status: 'PUBLISHED' }
          });

          // Уведомления пользователю
          const userId = order.telegramUserId;

          // 1. Оригинал
          await telegramRequest('sendMessage', {
              chat_id: userId,
              text: `📄 <b>Ваше оригинальное резюме:</b>\n\n` + 
                    `<b>Должность:</b> ${originalData.title}\n` +
                    `<b>Опыт:</b> ${originalData.experience}\n` +
                    `<b>Навыки:</b> ${originalData.skills}\n\n` +
                    `<i>Обработано AI</i>`,
              parse_mode: 'HTML'
          });

          // 2. Исправленное
          const fixed = aiResult.resume;
          await telegramRequest('sendMessage', {
              chat_id: userId,
              text: `✨ <b>Исправленная версия:</b>\n\n` + 
                    `<b>Должность:</b> ${fixed.title}\n` +
                    `<b>ЗП:</b> ${fixed.salary}\n` +
                    `<b>Опыт:</b> ${fixed.experience}\n` +
                    `<b>Навыки:</b> ${fixed.skills}\n` +
                    `<b>Описание:</b> ${fixed.description}\n` +
                    `<b>Контакты:</b> ${fixed.contacts}`,
              parse_mode: 'HTML'
          });

          // 3. Изменения
          let changesText = "📝 <b>Что улучшили:</b>\n\n";
          aiResult.changes.forEach((c: AIChange) => {
              changesText += `• <b>${c.field}:</b> ${c.what_fixed}\n  <i>${c.why}</i>\n\n`;
          });
          
          await telegramRequest('sendMessage', {
              chat_id: userId,
              text: changesText,
              parse_mode: 'HTML'
          });

          // Админу
          const adminChatId = process.env.TELEGRAM_ADMIN_ID;
          if (adminChatId) {
              try {
                await telegramRequest('sendMessage', {
                    chat_id: adminChatId,
                    text: `🤖 <b>AI Resume Fix Used!</b>\nUser: @${order.telegramUsername}\nIncome: 100 ⭐️`,
                    parse_mode: 'HTML'
                });
              } catch {}
          }

          return NextResponse.json({ success: true, aiResult });

      } catch (e: unknown) {
          console.error("AI Generation Failed:", e);
          
          if (order.telegramPaymentChargeId) {
              await telegramRequest('refundStarPayment', {
                  user_id: parseInt(order.telegramUserId, 10),
                  telegram_payment_charge_id: order.telegramPaymentChargeId
              });
              
              await telegramRequest('sendMessage', {
                  chat_id: order.telegramUserId,
                  text: `⚠️ Произошла ошибка при генерации AI-резюме. Мы вернули вам 100 звезд. Попробуйте позже.`,
              });

              await prisma.tgOrder.update({
                  where: { id: orderId },
                  data: { status: 'REFUNDED' }
              });
          }

          return NextResponse.json({ error: 'AI Generation Failed, refunded' }, { status: 500 });
      }
  }

  // --- CANCEL RANDOM COFFEE ---
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

      const refundRes = await telegramRequest('refundStarPayment', {
          user_id: parseInt(participation.profile.telegramUserId, 10),
          telegram_payment_charge_id: participation.telegramPaymentChargeId
      });

      if (!refundRes.ok) {
           return NextResponse.json({ error: refundRes.description || 'Error' }, { status: 500 });
      }

      await prisma.randomCoffeeParticipation.update({
          where: { id: participation.id },
          data: { status: 'REFUNDED_BY_USER' }
      });

      return NextResponse.json({ ok: true });
  }

  // --- CREATE INVOICE (Standard) ---
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

  if (body.pre_checkout_query) {
    await telegramRequest('answerPreCheckoutQuery', {
      pre_checkout_query_id: body.pre_checkout_query.id,
      ok: true,
    });
    return NextResponse.json({ ok: true });
  }

  // --- PAYMENT SUCCESS ---
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

    if (updatedOrder.type === 'RESUME_AI') {
        return NextResponse.json({ ok: true });
    }

    const adminChatId = process.env.TELEGRAM_ADMIN_ID;

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
                    text: `☕️ <b>Новый участник Random Coffee!</b>\nUser: @${updatedOrder.telegramUsername}`,
                    parse_mode: 'HTML',
                    reply_markup: { inline_keyboard: [[{ text: "RC Admin", url: "https://evsi.store/ru/tg-admin/random-coffee" }]] }
                });
            } catch (e) {}
        }
        return NextResponse.json({ ok: true });
    }
    
    // Стандартные вакансии/резюме
    await telegramRequest('sendMessage', {
        chat_id: body.message.chat.id,
        text: `✅ <b>Оплата прошла успешно!</b>\n\nВаша заявка отправлена на модерацию.\n\n⏳ <b>Модерация занимает до 24 часов.</b>\n📢 Публикация происходит ежедневно с 09:00 до 20:00 МСК.`,
        parse_mode: 'HTML'
    });

    if (adminChatId) {
        try {
            await telegramRequest('sendMessage', {
                chat_id: adminChatId,
                text: `🔥 <b>Новая заявка на модерацию!</b>\n\n` +
                      `<b>Тип:</b> ${updatedOrder.type === 'VACANCY' ? '💼 Вакансия' : '👤 Резюме'}\n` +
                      `<b>Пользователь:</b> @${updatedOrder.telegramUsername}\n` +
                      `<b>Сумма:</b> ${updatedOrder.totalAmount} ⭐️\n` +
                      `<b>ID:</b> <code>${updatedOrder.id}</code>`,
                parse_mode: 'HTML',
                reply_markup: {
                    inline_keyboard: [[{ text: "Перейти в админку", url: "https://evsi.store/ru/tg-admin" }]]
                }
            });
        } catch (e) {}
    }

    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ status: 'ignored' });
}