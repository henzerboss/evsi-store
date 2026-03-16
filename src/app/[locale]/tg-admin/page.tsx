import { auth } from "@/auth";
import { redirect } from "next/navigation";
import Link from "next/link";
import { PrismaClient } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { telegramRequest, formatOrderText, type JobPayload } from "@/lib/telegram";
import { SignOutButton } from "@/components/sign-out-button";

const globalForPrisma = global as unknown as { prisma?: PrismaClient };
const prisma = globalForPrisma.prisma || new PrismaClient();
if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;

type TgOrderType = "VACANCY" | "RESUME" | "RANDOM_COFFEE" | "RESUME_AI";

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
  paymentId: string | null;
  itemTitle: string | null;
  customerContact: string | null;
  publishedLinks: string | null;
  moderatedAt: Date | null;
  refundedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  channels: TgOrderChannel[];
}

interface TelegramMessageResponse {
  result?: {
    message_id: number;
    chat: {
      username?: string;
      id: number;
    };
  };
}

function safeJson<T = unknown>(value: string | null | undefined): T | null {
  if (!value) return null;
  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
}

function stripHtml(value: string) {
  return value.replace(/<[^>]*>/g, "");
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function toSafeString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function normalizeJobPayload(value: unknown): JobPayload {
  const obj = isObject(value) ? value : {};

  return {
    title: toSafeString(obj.title),
    description: toSafeString(obj.description),
    contacts: toSafeString(obj.contacts),
    salary: toSafeString(obj.salary),
    company: toSafeString(obj.company) || undefined,
    location: toSafeString(obj.location) || undefined,
    experience: toSafeString(obj.experience) || undefined,
    skills: toSafeString(obj.skills) || undefined,
  };
}

function getFormatOrderTextInput(payload: string): JobPayload {
  const parsed = safeJson<unknown>(payload);
  return normalizeJobPayload(parsed);
}

function getTypeLabel(type: TgOrderType) {
  switch (type) {
    case "VACANCY":
      return "ВАКАНСИЯ";
    case "RESUME":
      return "РЕЗЮМЕ";
    case "RESUME_AI":
      return "AI-РЕЗЮМЕ";
    case "RANDOM_COFFEE":
      return "RANDOM COFFEE";
    default:
      return type;
  }
}

function getTypeBadgeClass(type: TgOrderType) {
  switch (type) {
    case "VACANCY":
      return "bg-blue-100 text-blue-700";
    case "RESUME":
      return "bg-purple-100 text-purple-700";
    case "RESUME_AI":
      return "bg-amber-100 text-amber-700";
    case "RANDOM_COFFEE":
      return "bg-teal-100 text-teal-700";
    default:
      return "bg-gray-100 text-gray-700";
  }
}

function getStatusLabel(status: string) {
  switch (status) {
    case "PENDING":
      return "Ожидает оплату";
    case "PAID_WAITING_MODERATION":
      return "Ждет модерации";
    case "PUBLISHED":
      return "Опубликован";
    case "REJECTED_REFUNDED":
      return "Отклонён и возвращён";
    case "REFUNDED":
      return "Возвращён";
    case "REFUNDED_BY_ADMIN":
      return "Возврат админом";
    default:
      return status;
  }
}

function canRefund(order: TgOrder) {
  if (!order.telegramPaymentChargeId) return false;

  return !["REJECTED_REFUNDED", "REFUNDED", "REFUNDED_BY_ADMIN", "REFUNDED_BY_USER"].includes(order.status);
}

function parseTelegramPostLink(link: string): { chatId: string; messageId: number } | null {
  try {
    const url = new URL(link);
    const parts = url.pathname.split("/").filter(Boolean);

    if (parts.length < 2) return null;

    const channelUsername = parts[0];
    const messageId = parseInt(parts[1], 10);

    if (!channelUsername || !Number.isFinite(messageId)) return null;

    return {
      chatId: `@${channelUsername}`,
      messageId,
    };
  } catch {
    return null;
  }
}

async function deletePublishedPosts(order: TgOrder) {
  const links = safeJson<string[]>(order.publishedLinks) || [];
  if (!links.length) {
    return {
      deletedCount: 0,
      failedCount: 0,
      errors: [] as string[],
    };
  }

  let deletedCount = 0;
  let failedCount = 0;
  const errors: string[] = [];

  for (const link of links) {
    const parsed = parseTelegramPostLink(link);

    if (!parsed) {
      failedCount++;
      errors.push(`Не удалось распарсить ссылку: ${link}`);
      continue;
    }

    try {
      const res = await telegramRequest("deleteMessage", {
        chat_id: parsed.chatId,
        message_id: parsed.messageId,
      });

      if (res.ok) {
        deletedCount++;
      } else {
        failedCount++;
        errors.push(`Ошибка удаления ${link}: ${res.description || "deleteMessage failed"}`);
      }
    } catch (e) {
      failedCount++;
      errors.push(`Ошибка удаления ${link}: ${e instanceof Error ? e.message : "unknown error"}`);
    }
  }

  return { deletedCount, failedCount, errors };
}

async function refundOrder(formData: FormData) {
  "use server";

  const orderId = formData.get("orderId") as string;
  const locale = (formData.get("locale") as string) || "ru";

  const rawOrder = await prisma.tgOrder.findUnique({
    where: { id: orderId },
    include: { channels: { include: { channel: true } } },
  });

  const order = rawOrder as unknown as TgOrder | null;

  if (!order) {
    throw new Error("Order not found");
  }

  if (!order.telegramPaymentChargeId) {
    throw new Error("No charge ID found for refund");
  }

  if (!canRefund(order)) {
    throw new Error("Refund is not available for this order");
  }

  const refundRes = await telegramRequest("refundStarPayment", {
    user_id: parseInt(order.telegramUserId, 10),
    telegram_payment_charge_id: order.telegramPaymentChargeId,
  });

  if (!refundRes.ok) {
    throw new Error(`Refund failed: ${refundRes.description}`);
  }

  const deleteResult = await deletePublishedPosts(order);

  await prisma.tgOrder.update({
    where: { id: orderId },
    data: {
      status: order.status === "PAID_WAITING_MODERATION" ? "REJECTED_REFUNDED" : "REFUNDED_BY_ADMIN",
      refundedAt: new Date(),
    },
  });

  let userText =
    `💸 <b>По вашему заказу оформлен возврат.</b>\n\n` +
    `Средства (Stars) были возвращены на ваш баланс.\n`;

  if (order.itemTitle) {
    userText += `\n<b>Товар:</b> ${order.itemTitle}\n`;
  }

  if ((safeJson<string[]>(order.publishedLinks) || []).length > 0) {
    if (deleteResult.failedCount === 0) {
      userText += `\n🗑 <b>Публикации по заказу были удалены из каналов.</b>`;
    } else if (deleteResult.deletedCount > 0) {
      userText += `\n⚠️ Часть публикаций была удалена, часть удалить не удалось.`;
    } else {
      userText += `\n⚠️ Возврат выполнен, но публикации автоматически удалить не удалось.`;
    }
  }

  await telegramRequest("sendMessage", {
    chat_id: order.telegramUserId,
    text: userText,
    parse_mode: "HTML",
  });

  revalidatePath(`/${locale}/tg-admin`);
}

async function moderateOrder(formData: FormData) {
  "use server";

  const orderId = formData.get("orderId") as string;
  const action = formData.get("action") as string;
  const locale = (formData.get("locale") as string) || "ru";

  const rawOrder = await prisma.tgOrder.findUnique({
    where: { id: orderId },
    include: { channels: { include: { channel: true } } },
  });

  const order = rawOrder as unknown as TgOrder | null;

  if (!order || order.status !== "PAID_WAITING_MODERATION") {
    throw new Error("Order not valid for moderation");
  }

  if (action === "approve") {
    const text = formatOrderText(
      order.type as "VACANCY" | "RESUME",
      getFormatOrderTextInput(order.payload)
    );

    const publishedLinks: string[] = [];

    for (const item of order.channels) {
      try {
        const res = await telegramRequest<TelegramMessageResponse["result"]>("sendMessage", {
          chat_id: item.channel.username,
          text: text,
          parse_mode: "HTML",
        });

        if (res.ok && res.result) {
          const channelUser = item.channel.username.replace("@", "");
          publishedLinks.push(`https://t.me/${channelUser}/${res.result.message_id}`);
        }
      } catch (e) {
        console.error(`Error posting to ${item.channel.username}`, e);
      }
    }

    const linksList =
      publishedLinks.length > 0
        ? publishedLinks.map((link, i) => `${i + 1}. ${link}`).join("\n")
        : "Посты опубликованы, но ссылки получить не удалось.";

    const userMessage =
      `✅ <b>Ваша заявка опубликована!</b>\n\n` +
      `Ссылки на посты:\n${linksList}\n\n` +
      `Спасибо, что пользуетесь нашим сервисом!`;

    await telegramRequest("sendMessage", {
      chat_id: order.telegramUserId,
      text: userMessage,
      parse_mode: "HTML",
      disable_web_page_preview: true,
    });

    await prisma.tgOrder.update({
      where: { id: orderId },
      data: {
        status: "PUBLISHED",
        moderatedAt: new Date(),
        publishedLinks: JSON.stringify(publishedLinks),
      },
    });
  } else if (action === "reject") {
    await refundOrder(formData);
    return;
  }

  revalidatePath(`/${locale}/tg-admin`);
}

export default async function TgAdminPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;

  const session = await auth();
  if (!session) redirect("/login");

  const rawPendingOrders = await prisma.tgOrder.findMany({
    where: {
      status: "PAID_WAITING_MODERATION",
      type: { not: "RANDOM_COFFEE" },
    },
    orderBy: { createdAt: "asc" },
    include: { channels: { include: { channel: true } } },
  });

  const rawAllOrders = await prisma.tgOrder.findMany({
    where: {
      type: { not: "RANDOM_COFFEE" },
    },
    orderBy: { createdAt: "desc" },
    include: { channels: { include: { channel: true } } },
  });

  const pendingOrders = rawPendingOrders as unknown as TgOrder[];
  const allOrders = rawAllOrders as unknown as TgOrder[];

  return (
    <div className="container max-w-7xl mx-auto py-10 px-4">
      <div className="flex justify-between items-center mb-8 gap-3">
        <div className="flex items-center gap-3 flex-wrap">
          <h1 className="text-3xl font-bold">TG Admin</h1>
          <Link
            href={`/${locale}/tg-admin/pricing`}
            className="text-sm font-bold px-3 py-2 rounded-lg border bg-white hover:bg-gray-50 transition"
          >
            💸 Цены и скидки
          </Link>
          <Link
            href={`/${locale}/tg-admin/random-coffee`}
            className="text-sm font-bold px-3 py-2 rounded-lg border bg-white hover:bg-gray-50 transition"
          >
            ☕ Random Coffee
          </Link>
        </div>
        <SignOutButton />
      </div>

      <section className="mb-12">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-2xl font-bold">Модерация ({pendingOrders.length})</h2>
        </div>

        {pendingOrders.length === 0 ? (
          <div className="p-10 text-center bg-gray-50 rounded-xl border border-dashed">
            <p className="text-gray-500">Нет заявок на проверку 🎉</p>
            <p className="text-sm text-gray-400 mt-2">Все оплаченные заявки уже обработаны.</p>
          </div>
        ) : (
          <div className="space-y-8">
            {pendingOrders.map((order) => {
              const formattedText =
                order.type === "VACANCY" || order.type === "RESUME"
                  ? formatOrderText(order.type, getFormatOrderTextInput(order.payload))
                  : order.payload;

              return (
                <div key={order.id} className="bg-white border rounded-xl shadow-sm overflow-hidden">
                  <div className="bg-gray-50 px-6 py-4 border-b flex justify-between items-center gap-4 flex-wrap">
                    <div>
                      <span className={`text-xs font-bold px-2 py-1 rounded mr-2 ${getTypeBadgeClass(order.type)}`}>
                        {getTypeLabel(order.type)}
                      </span>
                      <span className="text-sm text-gray-500">от @{order.telegramUsername || order.telegramUserId}</span>
                    </div>
                    <div className="text-sm font-bold text-yellow-700">Оплачено: ⭐️ {order.totalAmount}</div>
                  </div>

                  <div className="p-6 grid md:grid-cols-2 gap-6">
                    <div className="space-y-3 text-sm">
                      <div className="grid gap-2">
                        <p>
                          <strong>Товар:</strong> {order.itemTitle || "—"}
                        </p>
                        <p>
                          <strong>Контакт:</strong> {order.customerContact || "—"}
                        </p>
                        <p>
                          <strong>ID заказа:</strong> <code>{order.id}</code>
                        </p>
                        <p>
                          <strong>Каналы ({order.channels.length}):</strong>
                        </p>
                      </div>

                      <div className="flex flex-wrap gap-1 mb-4">
                        {order.channels.map((c) => (
                          <span key={c.id} className="bg-gray-100 px-2 py-1 rounded border text-xs">
                            {c.channel.username}
                          </span>
                        ))}
                      </div>

                      <div className="p-3 bg-gray-50 rounded border">
                        <pre className="whitespace-pre-wrap font-sans text-gray-700 text-sm">
                          {typeof formattedText === "string" ? stripHtml(formattedText) : stripHtml(String(formattedText))}
                        </pre>
                      </div>
                    </div>

                    <div className="flex flex-col justify-center items-center space-y-4 border-l pl-6">
                      <form action={moderateOrder} className="w-full">
                        <input type="hidden" name="orderId" value={order.id} />
                        <input type="hidden" name="locale" value={locale} />

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
                          ❌ Отклонить, вернуть {order.totalAmount} ⭐️ и удалить посты
                        </button>
                      </form>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      <section>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-2xl font-bold">Все заказы ({allOrders.length})</h2>
        </div>

        {allOrders.length === 0 ? (
          <div className="p-10 text-center bg-gray-50 rounded-xl border border-dashed">
            <p className="text-gray-500">Заказов пока нет</p>
          </div>
        ) : (
          <div className="space-y-4">
            {allOrders.map((order) => {
              const links = safeJson<string[]>(order.publishedLinks) || [];

              return (
                <div key={order.id} className="bg-white border rounded-xl shadow-sm overflow-hidden">
                  <div className="p-5 grid lg:grid-cols-[1.5fr_1fr_1fr_auto] gap-4 items-start">
                    <div className="space-y-2">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className={`text-xs font-bold px-2 py-1 rounded ${getTypeBadgeClass(order.type)}`}>
                          {getTypeLabel(order.type)}
                        </span>
                        <span className="text-xs font-semibold px-2 py-1 rounded bg-gray-100 text-gray-700">
                          {getStatusLabel(order.status)}
                        </span>
                      </div>

                      <div className="text-sm">
                        <p>
                          <strong>Товар:</strong> {order.itemTitle || "—"}
                        </p>
                        <p>
                          <strong>Контакт:</strong> {order.customerContact || "—"}
                        </p>
                        <p>
                          <strong>Пользователь:</strong> @{order.telegramUsername || order.telegramUserId}
                        </p>
                        <p>
                          <strong>ID заказа:</strong> <code>{order.id}</code>
                        </p>
                      </div>
                    </div>

                    <div className="text-sm space-y-2">
                      <p>
                        <strong>Сумма:</strong> ⭐️ {order.totalAmount}
                      </p>
                      <p>
                        <strong>Создан:</strong> {new Date(order.createdAt).toLocaleString("ru-RU")}
                      </p>
                      <p>
                        <strong>Модерация:</strong>{" "}
                        {order.moderatedAt ? new Date(order.moderatedAt).toLocaleString("ru-RU") : "—"}
                      </p>
                      <p>
                        <strong>Возврат:</strong>{" "}
                        {order.refundedAt ? new Date(order.refundedAt).toLocaleString("ru-RU") : "—"}
                      </p>
                    </div>

                    <div className="text-sm space-y-2">
                      <p>
                        <strong>Каналы:</strong>
                      </p>
                      {order.channels.length > 0 ? (
                        <div className="flex flex-wrap gap-1">
                          {order.channels.map((c) => (
                            <span key={c.id} className="bg-gray-100 px-2 py-1 rounded border text-xs">
                              {c.channel.username}
                            </span>
                          ))}
                        </div>
                      ) : (
                        <p className="text-gray-400">—</p>
                      )}

                      <div className="pt-2">
                        <p>
                          <strong>Ссылки:</strong>
                        </p>
                        {links.length > 0 ? (
                          <div className="flex flex-col gap-1">
                            {links.map((link) => (
                              <a
                                key={link}
                                href={link}
                                target="_blank"
                                rel="noreferrer"
                                className="text-blue-600 hover:underline break-all"
                              >
                                {link}
                              </a>
                            ))}
                          </div>
                        ) : (
                          <p className="text-gray-400">—</p>
                        )}
                      </div>
                    </div>

                    <div className="min-w-[220px]">
                      {canRefund(order) ? (
                        <form action={refundOrder}>
                          <input type="hidden" name="orderId" value={order.id} />
                          <input type="hidden" name="locale" value={locale} />
                          <button
                            type="submit"
                            className="w-full bg-red-50 hover:bg-red-100 text-red-600 font-bold py-3 px-4 rounded border border-red-200 transition text-sm"
                          >
                            💸 Возврат и удаление постов
                          </button>
                        </form>
                      ) : (
                        <div className="text-xs text-gray-400 border rounded-lg p-3 bg-gray-50">
                          Возврат недоступен
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}