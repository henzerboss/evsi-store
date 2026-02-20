// file: src/app/[locale]/tg-admin/random-coffee/page.tsx

import { auth } from "@/auth";
import { redirect } from "next/navigation";
import { PrismaClient } from "@prisma/client";
import { SignOutButton } from "@/components/sign-out-button";
import Link from "next/link";
import { revalidatePath } from "next/cache";
import { telegramRequest } from "@/lib/telegram";

const prisma = new PrismaClient();

const RC_PRICE_STARS = Number(process.env.RANDOM_COFFEE_PRICE_STARS || 100);

// Для server action "дослать ссылки"
const SITE_URL = (process.env.SITE_URL || "https://evsi.store").replace(/\/$/, "");
const CRON_SECRET = process.env.CRON_SECRET || "";

// Локальные интерфейсы для безопасности
interface RCProfile {
  id: string;
  telegramUserId: string;
  name: string;
  specialty: string;
  interests: string;
  linkedin: string | null;
  createdAt: Date;
}

interface RCParticipation {
  id: string;
  status: string;
  matchDate: Date;
  telegramPaymentChargeId: string | null;
  matchWithId?: string | null;
  profile: RCProfile;
}

interface RCHistory {
  id: string;
  date: Date;
  userAId: string;
  userBId: string;
}

/**
 * Server Action: отменить участие (refund Stars) по participationId
 */
async function cancelParticipationAction(formData: FormData) {
  "use server";

  const session = await auth();
  if (!session) redirect("/login");

  const participationId = String(formData.get("participationId") || "");
  const locale = String(formData.get("locale") || "ru");

  if (!participationId) throw new Error("No participationId provided");

  const p = await prisma.randomCoffeeParticipation.findUnique({
    where: { id: participationId },
    include: { profile: true },
  });

  if (!p) throw new Error("Participation not found");

  if (!p.telegramPaymentChargeId) {
    await prisma.randomCoffeeParticipation.update({
      where: { id: participationId },
      data: { status: "CANCELLED_NO_CHARGE" },
    });
    revalidatePath(`/${locale}/tg-admin/random-coffee`);
    return;
  }

  const refundRes = await telegramRequest("refundStarPayment", {
    user_id: parseInt(p.profile.telegramUserId, 10),
    telegram_payment_charge_id: p.telegramPaymentChargeId,
  });

  if (!refundRes?.ok) {
    console.error("Refund failed:", refundRes);
    throw new Error(refundRes?.description || "Refund failed");
  }

  await prisma.randomCoffeeParticipation.update({
    where: { id: participationId },
    data: { status: "REFUNDED_BY_ADMIN" },
  });

  try {
    await telegramRequest("sendMessage", {
      chat_id: p.profile.telegramUserId,
      text:
        `☕️ Ваше участие в Random Coffee отменено администратором.\n\n` +
        `Мы вернули вам ${RC_PRICE_STARS} ⭐️.`,
    });
  } catch (err) {
    console.error("Failed to notify user about refund:", err);
  }

  revalidatePath(`/${locale}/tg-admin/random-coffee`);
}

/**
 * Server Action: удалить профиль участника (и его participations)
 */
async function deleteProfileAction(formData: FormData) {
  "use server";

  const session = await auth();
  if (!session) redirect("/login");

  const profileId = String(formData.get("profileId") || "");
  const locale = String(formData.get("locale") || "ru");

  if (!profileId) throw new Error("No profileId provided");

  await prisma.randomCoffeeParticipation.deleteMany({
    where: { profileId },
  });

  await prisma.randomCoffeeProfile.delete({
    where: { id: profileId },
  });

  revalidatePath(`/${locale}/tg-admin/random-coffee`);
}

/**
 * Server Action: дослать ссылки на пары за дату (YYYY-MM-DD)
 * Дергает /api/cron/random-coffee?action=resend_links&date=...
 */
async function resendLinksAction(formData: FormData) {
  "use server";

  const session = await auth();
  if (!session) redirect("/login");

  const locale = String(formData.get("locale") || "ru");
  const date = String(formData.get("date") || "").trim(); // YYYY-MM-DD
  const safeDate = date || new Date().toISOString().slice(0, 10);

  if (!CRON_SECRET) {
    redirect(`/${locale}/tg-admin/random-coffee?resend=error&msg=${encodeURIComponent("CRON_SECRET is not set")}`);
  }

  const url =
    `${SITE_URL}/api/cron/random-coffee` +
    `?secret=${encodeURIComponent(CRON_SECRET)}` +
    `&action=resend_links` +
    `&date=${encodeURIComponent(safeDate)}`;

  try {
    const res = await fetch(url, { method: "GET", cache: "no-store" });
    const json = await res.json().catch(() => null);

    if (!res.ok) {
      const msg = json?.error || json?.message || `HTTP ${res.status}`;
      redirect(`/${locale}/tg-admin/random-coffee?resend=error&msg=${encodeURIComponent(msg)}`);
    }

    const sent = json?.sent ?? 0;
    const matched = json?.matched ?? json?.count ?? 0;
    const skipped = json?.skipped ?? 0;

    redirect(
      `/${locale}/tg-admin/random-coffee?resend=ok` +
        `&date=${encodeURIComponent(safeDate)}` +
        `&sent=${encodeURIComponent(String(sent))}` +
        `&matched=${encodeURIComponent(String(matched))}` +
        `&skipped=${encodeURIComponent(String(skipped))}`
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    redirect(`/${locale}/tg-admin/random-coffee?resend=error&msg=${encodeURIComponent(msg)}`);
  }
}

export default async function RandomCoffeeAdminPage({
  params,
  searchParams,
}: {
  // ✅ Next 15: params может быть Promise
  params: Promise<{ locale: string }>;
  // ✅ searchParams тоже может быть Promise
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await auth();
  if (!session) redirect("/login");

  const { locale = "ru" } = await params;
  const sp = (await searchParams) || {};

  const resendStatus = typeof sp.resend === "string" ? sp.resend : "";
  const resendMsg = typeof sp.msg === "string" ? sp.msg : "";
  const resendDate = typeof sp.date === "string" ? sp.date : "";
  const resendSent = typeof sp.sent === "string" ? sp.sent : "";
  const resendMatched = typeof sp.matched === "string" ? sp.matched : "";
  const resendSkipped = typeof sp.skipped === "string" ? sp.skipped : "";

  const profiles = (await prisma.randomCoffeeProfile.findMany({
    orderBy: { createdAt: "desc" },
  })) as RCProfile[];

  const profileById = new Map<string, RCProfile>();
  for (const p of profiles) profileById.set(p.id, p);

  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);

  const activeParticipations = (await prisma.randomCoffeeParticipation.findMany({
    where: {
      status: "PAID",
      matchDate: { gte: startOfDay },
    },
    include: { profile: true },
    orderBy: { matchDate: "asc" },
  })) as RCParticipation[];

  const history = (await prisma.randomCoffeeHistory.findMany({
    take: 50,
    orderBy: { date: "desc" },
  })) as RCHistory[];

  // дефолт для инпута даты: сегодня
  const today = new Date().toISOString().slice(0, 10);

  return (
    <div className="container max-w-6xl mx-auto py-10 px-4">
      <div className="flex justify-between items-center mb-8 border-b pb-4">
        <div>
          <h1 className="text-3xl font-bold">☕️ Random Coffee Admin</h1>
          <p className="text-gray-500">Управление нетворкингом</p>
        </div>
        <div className="flex items-center gap-4">
          <Link
            href={`/${locale}/tg-admin`}
            className="text-sm font-medium text-blue-600 hover:underline"
          >
            ← Назад в Job Admin
          </Link>
          <SignOutButton />
        </div>
      </div>

      {/* Панель действий */}
      <div className="mb-8 bg-white rounded-xl border shadow-sm p-4">
        <div className="flex flex-col md:flex-row md:items-end gap-4 justify-between">
          <div>
            <div className="text-sm font-semibold text-gray-900">⚡️ Быстрые действия</div>
            <div className="text-xs text-gray-500 mt-1">
              Можно дослать кнопки «Написать» по уже смэтченным парам за выбранную дату.
            </div>
          </div>

          <form action={resendLinksAction} className="flex flex-col sm:flex-row gap-3 sm:items-end">
            <input type="hidden" name="locale" value={locale} />
            <div>
              <label className="block text-xs font-semibold text-gray-600 mb-1">Дата мэтча</label>
              <input
                type="date"
                name="date"
                defaultValue={today}
                className="h-10 rounded-lg border border-gray-200 px-3 text-sm"
              />
            </div>
            <button
              type="submit"
              className="h-10 inline-flex items-center justify-center rounded-lg bg-blue-600 px-4 text-sm font-semibold text-white hover:bg-blue-700"
              title="Разошлет сообщение с кнопкой «Написать» по всем MATCHED за дату"
            >
              Дослать ссылки
            </button>
          </form>
        </div>

        {/* Статус результата */}
        {resendStatus === "ok" && (
          <div className="mt-4 rounded-lg border border-green-200 bg-green-50 p-3 text-sm text-green-800">
            ✅ Ссылки досланы за дату <b>{resendDate || "—"}</b>. Отправлено: <b>{resendSent}</b>, matched: <b>{resendMatched}</b>, пропущено: <b>{resendSkipped}</b>.
          </div>
        )}
        {resendStatus === "error" && (
          <div className="mt-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">
            ❌ Ошибка при рассылке: <b>{resendMsg || "Unknown error"}</b>
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-10">
        <div className="p-6 bg-white rounded-xl border shadow-sm">
          <h3 className="text-sm font-medium text-gray-500">Всего участников</h3>
          <p className="text-3xl font-bold text-orange-600">{profiles.length}</p>
        </div>
        <div className="p-6 bg-white rounded-xl border shadow-sm">
          <h3 className="text-sm font-medium text-gray-500">Записано на пятницу</h3>
          <p className="text-3xl font-bold text-blue-600">
            {activeParticipations.length}
          </p>
        </div>
        <div className="p-6 bg-white rounded-xl border shadow-sm">
          <h3 className="text-sm font-medium text-gray-500">Всего встреч (в выборке)</h3>
          <p className="text-3xl font-bold text-green-600">{history.length}</p>
        </div>
      </div>

      <div className="space-y-12">
        {/* Секция 1: Очередь на распределение */}
        <section>
          <h2 className="text-xl font-bold mb-4 flex items-center gap-2">
            ⏳ Очередь на распределение ({activeParticipations.length})
          </h2>

          <div className="bg-white rounded-xl border shadow-sm overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm text-left">
                <thead className="bg-gray-50 text-gray-700 uppercase text-xs">
                  <tr>
                    <th className="px-6 py-3">Дата мэтча</th>
                    <th className="px-6 py-3">Имя</th>
                    <th className="px-6 py-3">Специальность</th>
                    <th className="px-6 py-3">Интересы</th>
                    <th className="px-6 py-3 text-right">Действия</th>
                  </tr>
                </thead>

                <tbody className="divide-y divide-gray-100">
                  {activeParticipations.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="px-6 py-4 text-center text-gray-500">
                        Очередь пуста
                      </td>
                    </tr>
                  ) : (
                    activeParticipations.map((p) => (
                      <tr key={p.id} className="hover:bg-gray-50">
                        <td className="px-6 py-4 font-medium text-gray-900">
                          {new Date(p.matchDate).toLocaleDateString()}
                        </td>
                        <td className="px-6 py-4">
                          {p.profile.name}
                          <br />
                          <span className="text-xs text-gray-400">
                            ID: {p.profile.telegramUserId}
                          </span>
                        </td>
                        <td className="px-6 py-4">{p.profile.specialty}</td>
                        <td className="px-6 py-4 max-w-xs truncate" title={p.profile.interests}>
                          {p.profile.interests}
                        </td>
                        <td className="px-6 py-4 text-right">
                          <form action={cancelParticipationAction}>
                            <input type="hidden" name="participationId" value={p.id} />
                            <input type="hidden" name="locale" value={locale} />
                            <button
                              type="submit"
                              className="inline-flex items-center justify-center rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs font-semibold text-red-700 hover:bg-red-100"
                              title={`Отменить участие и вернуть ${RC_PRICE_STARS} ⭐️`}
                            >
                              Отменить + вернуть ⭐️
                            </button>
                          </form>
                          {!p.telegramPaymentChargeId && (
                            <div className="text-[10px] text-gray-400 mt-1">
                              Нет payment_charge_id (refund невозможен)
                            </div>
                          )}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </section>

        {/* Секция 2: История мэтчей */}
        <section>
          <h2 className="text-xl font-bold mb-4">🧾 История мэтчей (последние 50)</h2>

          <div className="bg-white rounded-xl border shadow-sm overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm text-left">
                <thead className="bg-gray-50 text-gray-700 uppercase text-xs">
                  <tr>
                    <th className="px-6 py-3">Дата</th>
                    <th className="px-6 py-3">Пара</th>
                    <th className="px-6 py-3">ID профилей</th>
                  </tr>
                </thead>

                <tbody className="divide-y divide-gray-100">
                  {history.length === 0 ? (
                    <tr>
                      <td colSpan={3} className="px-6 py-4 text-center text-gray-500">
                        История пуста
                      </td>
                    </tr>
                  ) : (
                    history.map((h) => {
                      const a = profileById.get(h.userAId);
                      const b = profileById.get(h.userBId);

                      return (
                        <tr key={h.id} className="hover:bg-gray-50">
                          <td className="px-6 py-4 font-medium text-gray-900">
                            {new Date(h.date).toLocaleString()}
                          </td>
                          <td className="px-6 py-4">
                            <div className="font-semibold">
                              {a?.name || "Удалённый профиль"}{" "}
                              <span className="text-gray-400">↔</span>{" "}
                              {b?.name || "Удалённый профиль"}
                            </div>
                            <div className="text-xs text-gray-500 mt-1">
                              {a?.specialty || "-"} / {b?.specialty || "-"}
                            </div>
                          </td>
                          <td className="px-6 py-4 text-gray-500">
                            <code className="text-xs">{h.userAId}</code>
                            <span className="mx-2">—</span>
                            <code className="text-xs">{h.userBId}</code>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </section>

        {/* Секция 3: Все профили */}
        <section>
          <h2 className="text-xl font-bold mb-4">👥 База участников ({profiles.length})</h2>

          <div className="bg-white rounded-xl border shadow-sm overflow-hidden max-h-[500px] overflow-y-auto">
            <table className="w-full text-sm text-left">
              <thead className="bg-gray-50 text-gray-700 uppercase text-xs sticky top-0">
                <tr>
                  <th className="px-6 py-3">Имя</th>
                  <th className="px-6 py-3">Специальность</th>
                  <th className="px-6 py-3">LinkedIn</th>
                  <th className="px-6 py-3">Регистрация</th>
                  <th className="px-6 py-3 text-right">Действия</th>
                </tr>
              </thead>

              <tbody className="divide-y divide-gray-100">
                {profiles.map((p) => (
                  <tr key={p.id} className="hover:bg-gray-50">
                    <td className="px-6 py-4 font-medium">
                      {p.name}
                      <div className="text-xs text-gray-400">ID: {p.telegramUserId}</div>
                    </td>
                    <td className="px-6 py-4">{p.specialty}</td>
                    <td className="px-6 py-4">
                      {p.linkedin ? (
                        <a
                          href={p.linkedin}
                          target="_blank"
                          className="text-blue-600 hover:underline"
                          rel="noreferrer"
                        >
                          Link
                        </a>
                      ) : (
                        "-"
                      )}
                    </td>
                    <td className="px-6 py-4 text-gray-500">
                      {new Date(p.createdAt).toLocaleDateString()}
                    </td>
                    <td className="px-6 py-4 text-right">
                      <form action={deleteProfileAction}>
                        <input type="hidden" name="profileId" value={p.id} />
                        <input type="hidden" name="locale" value={locale} />
                        <button
                          type="submit"
                          className="inline-flex items-center justify-center rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs font-semibold text-gray-700 hover:bg-gray-50"
                          title="Удалить профиль (и его участия)"
                        >
                          Удалить
                        </button>
                      </form>
                      <div className="text-[10px] text-gray-400 mt-1">
                        Удалит также записи участия
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </div>
  );
}