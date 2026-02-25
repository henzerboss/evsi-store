// file: src/app/api/tg-jobs/route.ts

import { NextResponse } from "next/server";
import { PrismaClient } from "@prisma/client";
import { telegramRequest } from "@/lib/telegram";

const globalForPrisma = global as unknown as { prisma: PrismaClient };
const prisma = globalForPrisma.prisma || new PrismaClient();
if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;

// --- ENV-driven price (kept) ---
const DEFAULT_RESUME_AI_PRICE = 10;

const getResumeAiPrice = () => {
  const raw = process.env.RESUME_AI_PRICE_STARS;
  const n = raw ? parseInt(raw, 10) : DEFAULT_RESUME_AI_PRICE;
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_RESUME_AI_PRICE;
};

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
const safeJson = (s?: string | null) => {
  if (!s) return null;
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
};

function sanitizeForHtml(str: string | undefined | null): string {
  if (!str) return "";
  return String(str).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function clampInt(n: number, min: number, max: number) {
  if (!Number.isFinite(n)) return min;
  return Math.max(min, Math.min(max, Math.trunc(n)));
}

function calcDiscounted(price: number, discountPercent: number) {
  const p = clampInt(price, 0, 1_000_000);
  const d = clampInt(discountPercent, 0, 95);
  const v = Math.round((p * (100 - d)) / 100);
  return Math.max(1, v);
}

async function getSettings() {
  const s =
    (await prisma.tgSettings.findUnique({ where: { id: 1 } })) ??
    (await prisma.tgSettings.create({
      data: { id: 1, vacancyBasePriceStars: 0, resumeBasePriceStars: 0, channelDiscountPercent: 0 },
    }));
  return s;
}

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
Ты — опытный HR, карьерный консультант и специалист по подбору персонала с 10+ лет опыта.

Твоя задача — проверить и улучшить резюме кандидата так, чтобы оно соответствовало лучшим практикам оформления, было привлекательным для рекрутеров, HR и ATS-систем.

ВАЖНО:
1. Сохраняй смысл информации кандидата. Не выдумывай факты, опыт, навыки или достижения.
2. Улучшай стиль, грамматику, ясность и профессиональность.
3. Делай текст более конкретным, структурированным и ориентированным на результат.
4. Убирай воду, клише, разговорные выражения и повторения.
5. Используй уверенный, деловой и естественный стиль.
6. Проверяй орфографию, пунктуацию и логичность.
7. Не используй длинное тире, специальные символы или другие признаки, которые могут указывать на использование ИИ. Используй только обычные знаки препинания.
8. Текст должен выглядеть так, как будто его написал человек.
9. Не добавляй искусственных или чрезмерно «продающих» формулировок.

СООТВЕТСТВИЕ:
10. Проверь соответствие между должностью, опытом, навыками и описанием.
11. Если есть несоответствия, исправь формулировки так, чтобы все поля логично дополняли друг друга.
12. Убедись, что навыки и опыт релевантны заявленной должности.
13. Если должность слишком общая, сделай её более конкретной, но без выдумывания.

КЛЮЧЕВЫЕ НАВЫКИ:
14. Навыки нельзя выдумывать.
15. Можно аккуратно дополнить список навыков только если это очевидно из опыта/описания и это базовые вещи.
16. Не добавляй редкие/узкие навыки, если кандидат их явно не упоминает.
17. Не используй «коммуникабельный», «ответственный» и т.п.

ATS:
18. Используй ключевые слова профессии.
19. Делай текст понятным для ATS.

ФОРМАТ JSON (СТРОГО):
{
  "resume": {
    "title": "строка, макс 150",
    "salary": "строка, макс 100",
    "experience": "строка, макс 500",
    "skills": "строка, макс 500",
    "description": "строка, макс 3000",
    "contacts": "строка, макс 200"
  },
  "changes": [
    { "field": "Название поля", "what_fixed": "Что исправлено", "why": "Почему это лучше" }
  ]
}

Данные кандидата:
Должность: ${resumeData.title}
ЗП: ${resumeData.salary}
Опыт: ${resumeData.experience}
Навыки: ${resumeData.skills}
Описание: ${resumeData.description}
Контакты: ${resumeData.contacts}
`;

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent?key=${apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { responseMimeType: "application/json" },
      }),
    }
  );

  if (!response.ok) throw new Error(`Gemini API Error`);
  const data = await response.json();
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error("No content generated");

  try {
    return JSON.parse(text) as AIResult;
  } catch (e) {
    console.error("JSON Parse Error:", text);
    throw new Error("Invalid JSON from AI");
  }
}

// --- Handlers ---

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const action = searchParams.get("action");
  const userId = searchParams.get("userId");

  const settings = await getSettings();

  if (action === "get_profile" && userId) {
    try {
      const rcProfile = await prisma.randomCoffeeProfile.findUnique({
        where: { telegramUserId: String(userId) },
      });

      const userProfile = await prisma.tgUserProfile.findUnique({
        where: { telegramUserId: String(userId) },
      });

      let isParticipating = false;
      if (rcProfile) {
        const nextFriday = getNextFriday();
        const participation = await prisma.randomCoffeeParticipation.findFirst({
          where: {
            profileId: rcProfile.id,
            matchDate: nextFriday,
            status: "PAID",
          },
        });
        if (participation) isParticipating = true;
      }

      return NextResponse.json({
        profile: rcProfile,
        isParticipating,
        settings: {
          vacancyBasePriceStars: settings.vacancyBasePriceStars,
          resumeBasePriceStars: settings.resumeBasePriceStars,
          channelDiscountPercent: settings.channelDiscountPercent,
        },
        prices: {
          resumeAi: getResumeAiPrice(),
        },
        resumeDraft: userProfile
          ? {
              original: safeJson(userProfile.resumeOriginal),
              corrected: safeJson(userProfile.resumeCorrected),
            }
          : null,
      });
    } catch (e) {
      console.error(e);
      return NextResponse.json({
        profile: null,
        isParticipating: false,
        settings: {
          vacancyBasePriceStars: settings.vacancyBasePriceStars,
          resumeBasePriceStars: settings.resumeBasePriceStars,
          channelDiscountPercent: settings.channelDiscountPercent,
        },
        prices: { resumeAi: getResumeAiPrice() },
        resumeDraft: null,
      });
    }
  }

  try {
    const channels = await prisma.tgChannel.findMany({
      where: { isActive: true },
      orderBy: { category: "asc" },
    });

    // Возвращаем объект, чтобы фронт видел настройки
    return NextResponse.json({
      settings: {
        vacancyBasePriceStars: settings.vacancyBasePriceStars,
        resumeBasePriceStars: settings.resumeBasePriceStars,
        channelDiscountPercent: settings.channelDiscountPercent,
      },
      channels,
    });
  } catch {
    return NextResponse.json({ error: "Database error" }, { status: 500 });
  }
}

export async function POST(req: Request) {
  const body = await req.json();
  const settings = await getSettings();

  // --- SAVE RESUME DRAFT ---
  if (body.action === "save_resume_draft") {
    const { userId, original, corrected } = body;
    try {
      await prisma.tgUserProfile.upsert({
        where: { telegramUserId: String(userId) },
        update: {
          resumeOriginal: original ? JSON.stringify(original) : null,
          resumeCorrected: corrected ? JSON.stringify(corrected) : null,
        },
        create: {
          telegramUserId: String(userId),
          resumeOriginal: original ? JSON.stringify(original) : null,
          resumeCorrected: corrected ? JSON.stringify(corrected) : null,
        },
      });
      return NextResponse.json({ ok: true });
    } catch (e) {
      console.error("Failed to save draft:", e);
      return NextResponse.json({ error: "Failed to save" }, { status: 500 });
    }
  }

  // --- AI RESUME FIX: Create Invoice ---
  if (body.action === "create_ai_invoice") {
    const price = getResumeAiPrice();
    const { userId, payload } = body;

    const order = await prisma.tgOrder.create({
      data: {
        telegramUserId: String(userId),
        telegramUsername: body.username,
        type: "RESUME_AI",
        payload: JSON.stringify(payload),
        totalAmount: price,
        status: "PENDING",
        channels: { create: [] },
      },
    });

    const invoiceData = {
      title: "AI-улучшение резюме",
      description: "Профессиональная коррекция текста с помощью ИИ.",
      payload: order.id,
      currency: "XTR",
      prices: [{ label: "AI Analysis", amount: price }],
    };

    const tgResponse = await telegramRequest("createInvoiceLink", invoiceData);
    if (!tgResponse.ok) return NextResponse.json({ error: "Failed to create invoice" }, { status: 500 });
    return NextResponse.json({ invoiceLink: tgResponse.result, orderId: order.id });
  }

  // --- AI RESUME FIX: Generate Content ---
  if (body.action === "generate_ai_resume") {
    const price = getResumeAiPrice();
    const { orderId } = body;
    const order = await prisma.tgOrder.findUnique({ where: { id: orderId } });

    if (!order || order.status !== "PAID_WAITING_MODERATION") {
      return NextResponse.json({ error: "Order not paid or processing", code: "ORDER_NOT_READY" }, { status: 400 });
    }

    try {
      const originalData = JSON.parse(order.payload) as ResumeData;
      const aiResult = await generateImprovedResume(originalData);

      await prisma.tgOrder.update({ where: { id: orderId }, data: { status: "PUBLISHED" } });

      await prisma.tgUserProfile.upsert({
        where: { telegramUserId: order.telegramUserId },
        update: { resumeCorrected: JSON.stringify(aiResult.resume) },
        create: { telegramUserId: order.telegramUserId, resumeCorrected: JSON.stringify(aiResult.resume) },
      });

      const userId = order.telegramUserId;
      try {
        await telegramRequest("sendMessage", {
          chat_id: userId,
          text:
            `📄 <b>Ваше оригинальное резюме:</b>\n\n` +
            `<b>Должность:</b> ${sanitizeForHtml(originalData.title)}\n` +
            `<b>Опыт:</b> ${sanitizeForHtml(originalData.experience)}\n` +
            `<b>Навыки:</b> ${sanitizeForHtml(originalData.skills)}\n\n` +
            `<i>Обработано AI</i>`,
          parse_mode: "HTML",
        });

        const fixed = aiResult.resume;
        await telegramRequest("sendMessage", {
          chat_id: userId,
          text:
            `✨ <b>Исправленная версия:</b>\n\n` +
            `<b>Должность:</b> ${sanitizeForHtml(fixed.title)}\n` +
            `<b>ЗП:</b> ${sanitizeForHtml(fixed.salary)}\n` +
            `<b>Опыт:</b> ${sanitizeForHtml(fixed.experience)}\n` +
            `<b>Навыки:</b> ${sanitizeForHtml(fixed.skills)}\n` +
            `<b>Описание:</b> ${sanitizeForHtml(fixed.description)}\n` +
            `<b>Контакты:</b> ${sanitizeForHtml(fixed.contacts)}`,
          parse_mode: "HTML",
        });

        let changesText = "📝 <b>Что улучшили:</b>\n\n";
        aiResult.changes.forEach((c: AIChange) => {
          changesText += `• <b>${sanitizeForHtml(c.field)}:</b> ${sanitizeForHtml(c.what_fixed)}\n  <i>${sanitizeForHtml(
            c.why
          )}</i>\n\n`;
        });

        await telegramRequest("sendMessage", {
          chat_id: userId,
          text: changesText,
          parse_mode: "HTML",
        });
      } catch (e) {
        console.error("Failed to send notifications", e);
      }

      const adminChatId = process.env.TELEGRAM_ADMIN_ID;
      if (adminChatId) {
        try {
          await telegramRequest("sendMessage", {
            chat_id: adminChatId,
            text: `🤖 <b>AI Resume Fix Used!</b>\nUser: @${order.telegramUsername}\nIncome: ${price} ⭐️`,
            parse_mode: "HTML",
          });
        } catch {}
      }

      return NextResponse.json({ success: true, aiResult });
    } catch (e: unknown) {
      console.error("AI Generation Failed:", e);
      if (order.telegramPaymentChargeId) {
        await telegramRequest("refundStarPayment", {
          user_id: parseInt(order.telegramUserId, 10),
          telegram_payment_charge_id: order.telegramPaymentChargeId,
        });
        await prisma.tgOrder.update({ where: { id: orderId }, data: { status: "REFUNDED" } });
        await telegramRequest("sendMessage", {
          chat_id: order.telegramUserId,
          text: `⚠️ Произошла ошибка при генерации AI-резюме. Мы вернули вам ${price} звезд.`,
        });
      }
      return NextResponse.json({ error: "AI Generation Failed, refunded" }, { status: 500 });
    }
  }

  // --- CANCEL RANDOM COFFEE ---
  if (body.action === "cancel_random_coffee") {
    const { userId } = body;
    const nextFriday = getNextFriday();

    const participation = await prisma.randomCoffeeParticipation.findFirst({
      where: {
        profile: { telegramUserId: String(userId) },
        matchDate: nextFriday,
        status: "PAID",
      },
      include: { profile: true },
    });

    if (!participation || !participation.telegramPaymentChargeId) {
      return NextResponse.json({ error: "Запись не найдена или уже отменена" }, { status: 400 });
    }

    const refundRes = await telegramRequest("refundStarPayment", {
      user_id: parseInt(participation.profile.telegramUserId, 10),
      telegram_payment_charge_id: participation.telegramPaymentChargeId,
    });

    if (!refundRes.ok) {
      console.error("Refund failed:", refundRes);
      return NextResponse.json({ error: refundRes.description || "Refund failed" }, { status: 500 });
    }

    await prisma.randomCoffeeParticipation.update({
      where: { id: participation.id },
      data: { status: "REFUNDED_BY_USER" },
    });

    return NextResponse.json({ ok: true });
  }

  // --- CREATE INVOICE ---
  if (body.action === "create_invoice") {
    const { channelIds, payload, type, userId, username } = body;

    let totalAmount = 0;

    if (type === "RANDOM_COFFEE") {
      totalAmount = 100;
    } else {
      if (!channelIds?.length) return NextResponse.json({ error: "Invalid data" }, { status: 400 });

      const channels = (await prisma.tgChannel.findMany({ where: { id: { in: channelIds } } })) as TgChannel[];

      const discount = settings.channelDiscountPercent;
      const sumChannelsDiscounted = channels.reduce((sum: number, ch: TgChannel) => {
        const p = discount > 0 ? calcDiscounted(ch.priceStars, discount) : ch.priceStars;
        return sum + p;
      }, 0);

      const base =
        type === "VACANCY"
          ? settings.vacancyBasePriceStars
          : type === "RESUME"
            ? settings.resumeBasePriceStars
            : 0;

      totalAmount = base + sumChannelsDiscounted;
    }

    const order = await prisma.tgOrder.create({
      data: {
        telegramUserId: String(userId),
        telegramUsername: username,
        type: type,
        payload: JSON.stringify(payload),
        totalAmount: totalAmount,
        status: "PENDING",
        channels: { create: type === "RANDOM_COFFEE" ? [] : channelIds.map((id: string) => ({ channelId: id })) },
      },
    });

    const title = type === "RANDOM_COFFEE" ? "Random Coffee" : type === "VACANCY" ? "Вакансия" : "Резюме";
    const invoiceData = {
      title: title,
      description: "Оплата услуги",
      payload: order.id,
      currency: "XTR",
      prices: [{ label: "Услуга", amount: totalAmount }],
    };

    const tgResponse = await telegramRequest("createInvoiceLink", invoiceData);
    if (!tgResponse.ok) return NextResponse.json({ error: "Failed" }, { status: 500 });
    return NextResponse.json({ invoiceLink: tgResponse.result, orderId: order.id });
  }

  if (body.pre_checkout_query) {
    await telegramRequest("answerPreCheckoutQuery", { pre_checkout_query_id: body.pre_checkout_query.id, ok: true });
    return NextResponse.json({ ok: true });
  }

  // --- PAYMENT SUCCESS ---
  if (body.message?.successful_payment) {
    const payment = body.message.successful_payment;
    const orderId = payment.invoice_payload;

    const updatedOrder = await prisma.tgOrder.update({
      where: { id: orderId },
      data: {
        status: "PAID_WAITING_MODERATION",
        paymentId: payment.provider_payment_charge_id,
        telegramPaymentChargeId: payment.telegram_payment_charge_id,
      },
    });

    if (updatedOrder.type === "RESUME_AI") return NextResponse.json({ ok: true });

    const adminChatId = process.env.TELEGRAM_ADMIN_ID;

    if (updatedOrder.type === "RANDOM_COFFEE") {
      const data = JSON.parse(updatedOrder.payload);
      const userId = updatedOrder.telegramUserId;

      const profile = await prisma.randomCoffeeProfile.upsert({
        where: { telegramUserId: userId },
        update: { name: data.rcName, specialty: data.rcSpecialty, interests: data.rcInterests, linkedin: data.rcLinkedin },
        create: { telegramUserId: userId, name: data.rcName, specialty: data.rcSpecialty, interests: data.rcInterests, linkedin: data.rcLinkedin },
      });

      const nextFriday = getNextFriday();
      const dateStr = nextFriday.toLocaleDateString("ru-RU", { day: "numeric", month: "long" });

      await prisma.randomCoffeeParticipation.create({
        data: { profileId: profile.id, matchDate: nextFriday, status: "PAID", telegramPaymentChargeId: payment.telegram_payment_charge_id },
      });

      await telegramRequest("sendMessage", {
        chat_id: body.message.chat.id,
        text: `☕️ <b>Оплата принята! Вы в игре.</b>\n\nРаспределение пар произойдет в пятницу <b>${dateStr} в 10:00 МСК</b>.\nБот пришлет вам контакт собеседника.\n\nУдачи!`,
        parse_mode: "HTML",
      });

      if (adminChatId) {
        try {
          await telegramRequest("sendMessage", {
            chat_id: adminChatId,
            text:
              `☕️ <b>Новый участник Random Coffee!</b>\n\n` +
              `<b>Пользователь:</b> @${updatedOrder.telegramUsername || updatedOrder.telegramUserId}\n` +
              `<b>Сумма:</b> ${updatedOrder.totalAmount} ⭐️\n` +
              `<b>ID заказа:</b> <code>${updatedOrder.id}</code>`,
            parse_mode: "HTML",
            reply_markup: {
              inline_keyboard: [[{ text: "Перейти в RC админку", url: "https://evsi.store/ru/tg-admin/random-coffee" }]],
            },
          });
        } catch {}
      }
      return NextResponse.json({ ok: true });
    }

    // Vacancy/Resume moderation
    await telegramRequest("sendMessage", {
      chat_id: body.message.chat.id,
      text: `✅ <b>Оплата прошла успешно!</b>\n\nВаша заявка отправлена на модерацию.\n\n⏳ <b>Модерация занимает до 24 часов.</b>\n📢 Публикация происходит ежедневно с 09:00 до 20:00 МСК.`,
      parse_mode: "HTML",
    });

    if (adminChatId) {
      try {
        await telegramRequest("sendMessage", {
          chat_id: adminChatId,
          text:
            `🔥 <b>Новая заявка на модерацию!</b>\n\n` +
            `<b>Тип:</b> ${updatedOrder.type === "VACANCY" ? "💼 Вакансия" : "👤 Резюме"}\n` +
            `<b>Пользователь:</b> @${updatedOrder.telegramUsername || updatedOrder.telegramUserId}\n` +
            `<b>Сумма:</b> ${updatedOrder.totalAmount} ⭐️\n` +
            `<b>ID заказа:</b> <code>${updatedOrder.id}</code>`,
          parse_mode: "HTML",
          reply_markup: {
            inline_keyboard: [[{ text: "Перейти в админку", url: "https://evsi.store/ru/tg-admin" }]],
          },
        });
      } catch {}
    }

    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ status: "ignored" });
}