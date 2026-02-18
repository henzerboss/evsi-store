// file: src/app/api/tg-jobs/route.ts

import { NextResponse } from 'next/server';
import { PrismaClient } from '@prisma/client';
import { telegramRequest } from '@/lib/telegram';

const globalForPrisma = global as unknown as { prisma: PrismaClient };
const prisma = globalForPrisma.prisma || new PrismaClient();
if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma;

// --- Interfaces ---
interface TgChannel {
  id: string;
  priceStars: number;
  name: string;
  category: string;
  username: string;
}

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

// --- Helpers ---

// Safe JSON parse helper
const safeJson = (s?: string | null) => {
  if (!s) return null;
  try { return JSON.parse(s); } catch { return null; }
};

function getNextFriday() {
    const d = new Date();
    const day = d.getDay();
    const diff = 5 - day; 
    const daysToAdd = diff <= 0 ? diff + 7 : diff;
    d.setDate(d.getDate() + daysToAdd);
    d.setHours(10, 0, 0, 0); 
    return d;
}

async function generateImprovedResume(resumeData: ResumeData): Promise<AIResult> {
    const apiKey = process.env.GEMINI_API_KEY_RESUME;
    if (!apiKey) throw new Error("API Key not configured");

    const prompt = `
Ты — опытный HR. Проверь и улучши резюме.
Сохраняй смысл, улучшай стиль (деловой, без воды).
JSON формат: { "resume": { ...fields... }, "changes": [ { "field", "what_fixed", "why" } ] }

Данные:
Должность: ${resumeData.title}
ЗП: ${resumeData.salary}
Опыт: ${resumeData.experience}
Навыки: ${resumeData.skills}
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

    if (!response.ok) throw new Error(`Gemini API Error`);
    const data = await response.json();
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) throw new Error("No content");
    return JSON.parse(text) as AIResult;
}

// --- Handlers ---

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const action = searchParams.get('action');
  const userId = searchParams.get('userId');

  if (action === 'get_profile' && userId) {
      try {
          // 1. Random Coffee Profile
          const rcProfile = await prisma.randomCoffeeProfile.findUnique({
              where: { telegramUserId: String(userId) }
          });

          // 2. Resume Drafts
          const userProfile = await prisma.tgUserProfile.findUnique({
              where: { telegramUserId: String(userId) }
          });

          let isParticipating = false;
          if (rcProfile) {
              const nextFriday = getNextFriday();
              const participation = await prisma.randomCoffeeParticipation.findFirst({
                  where: {
                      profileId: rcProfile.id,
                      matchDate: nextFriday,
                      status: 'PAID'
                  }
              });
              if (participation) isParticipating = true;
          }

          return NextResponse.json({ 
              profile: rcProfile, 
              isParticipating,
              resumeDraft: userProfile ? {
                  original: safeJson(userProfile.resumeOriginal),
                  corrected: safeJson(userProfile.resumeCorrected)
              } : null
          });
      } catch (e) {
          console.error(e);
          return NextResponse.json({ profile: null, isParticipating: false, resumeDraft: null });
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

  // --- SAVE RESUME DRAFT ---
  if (body.action === 'save_resume_draft') {
      const { userId, original, corrected } = body;
      
      try {
          await prisma.tgUserProfile.upsert({
              where: { telegramUserId: String(userId) },
              update: {
                  resumeOriginal: original ? JSON.stringify(original) : null, // Используем null для очистки
                  resumeCorrected: corrected ? JSON.stringify(corrected) : null
              },
              create: {
                  telegramUserId: String(userId),
                  resumeOriginal: original ? JSON.stringify(original) : null,
                  resumeCorrected: corrected ? JSON.stringify(corrected) : null
              }
          });
          return NextResponse.json({ ok: true });
      } catch (e) {
          console.error("Failed to save draft:", e);
          return NextResponse.json({ error: "Failed to save" }, { status: 500 });
      }
  }

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
      
      if (!tgResponse.ok) return NextResponse.json({ error: 'Failed to create invoice' }, { status: 500 });
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

          await prisma.tgOrder.update({ where: { id: orderId }, data: { status: 'PUBLISHED' } });

          // Save corrected draft immediately
          await prisma.tgUserProfile.upsert({
              where: { telegramUserId: order.telegramUserId },
              update: { resumeCorrected: JSON.stringify(aiResult.resume) },
              create: { telegramUserId: order.telegramUserId, resumeCorrected: JSON.stringify(aiResult.resume) }
          });

          // Notifications...
          const userId = order.telegramUserId;
          await telegramRequest('sendMessage', {
              chat_id: userId,
              text: `✨ <b>Резюме улучшено!</b>\nМы обновили данные в Mini App.\n\nПроверьте вкладку "Исправленная".`,
              parse_mode: 'HTML'
          });

          return NextResponse.json({ success: true, aiResult });

      } catch (e: unknown) {
          console.error("AI Generation Failed:", e);
          if (order.telegramPaymentChargeId) {
              await telegramRequest('refundStarPayment', {
                  user_id: parseInt(order.telegramUserId, 10),
                  telegram_payment_charge_id: order.telegramPaymentChargeId
              });
              await prisma.tgOrder.update({ where: { id: orderId }, data: { status: 'REFUNDED' } });
          }
          return NextResponse.json({ error: 'AI Generation Failed, refunded' }, { status: 500 });
      }
  }

  // --- CANCEL RANDOM COFFEE ---
  if (body.action === 'cancel_random_coffee') {
      const { userId } = body;
      const nextFriday = getNextFriday();
      const participation = await prisma.randomCoffeeParticipation.findFirst({
          where: { profile: { telegramUserId: String(userId) }, matchDate: nextFriday, status: 'PAID' },
          include: { profile: true }
      });

      if (!participation || !participation.telegramPaymentChargeId) return NextResponse.json({ error: 'Запись не найдена' }, { status: 400 });

      const refundRes = await telegramRequest('refundStarPayment', {
          user_id: parseInt(participation.profile.telegramUserId, 10),
          telegram_payment_charge_id: participation.telegramPaymentChargeId
      });

      if (!refundRes.ok) return NextResponse.json({ error: refundRes.description }, { status: 500 });

      await prisma.randomCoffeeParticipation.update({ where: { id: participation.id }, data: { status: 'REFUNDED_BY_USER' } });
      return NextResponse.json({ ok: true });
  }

  // --- CREATE INVOICE (Standard) ---
  if (body.action === 'create_invoice') {
    const { channelIds, payload, type, userId, username } = body;
    let totalAmount = 0;
    
    if (type === 'RANDOM_COFFEE') totalAmount = 100;
    else {
        if (!channelIds?.length) return NextResponse.json({ error: 'Invalid data' }, { status: 400 });
        const channels = (await prisma.tgChannel.findMany({ where: { id: { in: channelIds } } })) as TgChannel[];
        totalAmount = channels.reduce((sum: number, ch: TgChannel) => sum + ch.priceStars, 0);
    }

    const order = await prisma.tgOrder.create({
      data: {
        telegramUserId: String(userId), telegramUsername: username, type: type, 
        payload: JSON.stringify(payload), totalAmount: totalAmount, status: 'PENDING',
        channels: { create: type === 'RANDOM_COFFEE' ? [] : channelIds.map((id: string) => ({ channelId: id })) }
      }
    });

    const title = type === 'RANDOM_COFFEE' ? 'Random Coffee' : (type === 'VACANCY' ? 'Вакансия' : 'Резюме');
    const invoiceData = {
      title: title, description: "Оплата услуги", payload: order.id, currency: "XTR",
      prices: [{ label: "Услуга", amount: totalAmount }],
    };

    const tgResponse = await telegramRequest('createInvoiceLink', invoiceData);
    if (!tgResponse.ok) return NextResponse.json({ error: 'Failed' }, { status: 500 });
    return NextResponse.json({ invoiceLink: tgResponse.result });
  }

  if (body.pre_checkout_query) {
    await telegramRequest('answerPreCheckoutQuery', { pre_checkout_query_id: body.pre_checkout_query.id, ok: true });
    return NextResponse.json({ ok: true });
  }

  // --- PAYMENT SUCCESS ---
  if (body.message?.successful_payment) {
    const payment = body.message.successful_payment;
    const orderId = payment.invoice_payload;
    const updatedOrder = await prisma.tgOrder.update({
      where: { id: orderId },
      data: { status: 'PAID_WAITING_MODERATION', paymentId: payment.provider_payment_charge_id, telegramPaymentChargeId: payment.telegram_payment_charge_id }
    });

    if (updatedOrder.type === 'RESUME_AI') return NextResponse.json({ ok: true });

    if (updatedOrder.type === 'RANDOM_COFFEE') {
        const data = JSON.parse(updatedOrder.payload);
        const userId = updatedOrder.telegramUserId;
        const profile = await prisma.randomCoffeeProfile.upsert({
            where: { telegramUserId: userId },
            update: { name: data.rcName, specialty: data.rcSpecialty, interests: data.rcInterests, linkedin: data.rcLinkedin },
            create: { telegramUserId: userId, name: data.rcName, specialty: data.rcSpecialty, interests: data.rcInterests, linkedin: data.rcLinkedin }
        });
        const nextFriday = getNextFriday();
        await prisma.randomCoffeeParticipation.create({
            data: { profileId: profile.id, matchDate: nextFriday, status: 'PAID', telegramPaymentChargeId: payment.telegram_payment_charge_id }
        });
        await telegramRequest('sendMessage', { chat_id: body.message.chat.id, text: `☕️ <b>Оплата принята!</b> Вы в игре.`, parse_mode: 'HTML' });
    } else {
        await telegramRequest('sendMessage', { chat_id: body.message.chat.id, text: `✅ <b>Оплата прошла успешно!</b> Заявка на модерации.`, parse_mode: 'HTML' });
    }
    
    // Admin notify
    const adminChatId = process.env.TELEGRAM_ADMIN_ID;
    if (adminChatId) {
        telegramRequest('sendMessage', { chat_id: adminChatId, text: `🔥 <b>Paid: ${updatedOrder.type}</b> @${updatedOrder.telegramUsername}`, parse_mode: 'HTML' }).catch(() => {});
    }

    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ status: 'ignored' });
}