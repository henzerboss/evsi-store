// file: src/app/[locale]/tg-admin/pricing/page.tsx

import { auth } from "@/auth";
import { redirect } from "next/navigation";
import Link from "next/link";
import { revalidatePath } from "next/cache";
import { PrismaClient } from "@prisma/client";

const globalForPrisma = global as unknown as { prisma?: PrismaClient };
const prisma = globalForPrisma.prisma || new PrismaClient();
if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;

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

async function saveSettings(formData: FormData) {
  "use server";

  const vacancyBase = clampInt(Number(formData.get("vacancyBasePriceStars")), 0, 1_000_000);
  const resumeBase = clampInt(Number(formData.get("resumeBasePriceStars")), 0, 1_000_000);
  const discount = clampInt(Number(formData.get("channelDiscountPercent")), 0, 95);

  await prisma.tgSettings.upsert({
    where: { id: 1 },
    update: {
      vacancyBasePriceStars: vacancyBase,
      resumeBasePriceStars: resumeBase,
      channelDiscountPercent: discount,
    },
    create: {
      id: 1,
      vacancyBasePriceStars: vacancyBase,
      resumeBasePriceStars: resumeBase,
      channelDiscountPercent: discount,
    },
  });

  revalidatePath("/tg-admin/pricing");
  revalidatePath("/tg-admin");
  revalidatePath("/tg-app");
}

export default async function TgAdminPricingPage() {
  const session = await auth();
  if (!session) redirect("/login");

  const settings =
    (await prisma.tgSettings.findUnique({ where: { id: 1 } })) ??
    (await prisma.tgSettings.create({
      data: { id: 1, vacancyBasePriceStars: 0, resumeBasePriceStars: 0, channelDiscountPercent: 0 },
    }));

  const channels = await prisma.tgChannel.findMany({
    where: { isActive: true },
    orderBy: [{ category: "asc" }, { priceStars: "asc" }],
  });

  return (
    <div className="container max-w-5xl mx-auto py-10 px-4">
      <div className="flex items-center justify-between mb-8 gap-3">
        <div className="flex items-center gap-3">
          <h1 className="text-3xl font-bold">Цены и скидки</h1>
          <Link href="/tg-admin" className="text-sm font-bold px-3 py-2 rounded-lg border bg-white hover:bg-gray-50 transition">
            ← Назад к модерации
          </Link>
        </div>
        <div className="text-xs text-gray-400">
          Скидка применяется ко <b>всем каналам</b>. Базовая цена добавляется к сумме каналов.
        </div>
      </div>

      <div className="grid md:grid-cols-2 gap-8">
        <div className="bg-white border rounded-2xl shadow-sm overflow-hidden">
          <div className="px-6 py-4 border-b bg-gray-50">
            <h2 className="font-bold">Настройки</h2>
            <p className="text-sm text-gray-500 mt-1">Задайте базовые цены и скидку на каналы.</p>
          </div>

          <form action={saveSettings} className="p-6 space-y-5">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-xs font-bold text-gray-500 uppercase tracking-wide">База: вакансия (⭐️)</label>
                <input
                  name="vacancyBasePriceStars"
                  defaultValue={settings.vacancyBasePriceStars}
                  inputMode="numeric"
                  className="mt-2 w-full p-3 rounded-xl border bg-white outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="например 50"
                />
                <p className="text-xs text-gray-400 mt-1">Добавляется к сумме каналов при оплате вакансии.</p>
              </div>

              <div>
                <label className="text-xs font-bold text-gray-500 uppercase tracking-wide">База: резюме (⭐️)</label>
                <input
                  name="resumeBasePriceStars"
                  defaultValue={settings.resumeBasePriceStars}
                  inputMode="numeric"
                  className="mt-2 w-full p-3 rounded-xl border bg-white outline-none focus:ring-2 focus:ring-purple-500"
                  placeholder="например 50"
                />
                <p className="text-xs text-gray-400 mt-1">Добавляется к сумме каналов при оплате резюме.</p>
              </div>
            </div>

            <div>
              <label className="text-xs font-bold text-gray-500 uppercase tracking-wide">Скидка на все каналы (%)</label>
              <input
                name="channelDiscountPercent"
                defaultValue={settings.channelDiscountPercent}
                inputMode="numeric"
                className="mt-2 w-full p-3 rounded-xl border bg-white outline-none focus:ring-2 focus:ring-amber-500"
                placeholder="например 20"
              />
              <div className="mt-2 p-3 rounded-xl border bg-amber-50 text-amber-900 text-sm">
                Сейчас: <b>-{settings.channelDiscountPercent}%</b> на цену каждого канала.
              </div>
            </div>

            <button className="w-full bg-black text-white font-bold py-3 rounded-xl hover:opacity-90 transition">
              💾 Сохранить
            </button>
          </form>
        </div>

        <div className="bg-white border rounded-2xl shadow-sm overflow-hidden">
          <div className="px-6 py-4 border-b bg-gray-50">
            <h2 className="font-bold">Превью цен каналов</h2>
            <p className="text-sm text-gray-500 mt-1">Показывает, как увидит пользователь в приложении.</p>
          </div>

          <div className="p-6 space-y-4">
            {channels.length === 0 ? (
              <div className="text-gray-500">Нет активных каналов.</div>
            ) : (
              <div className="space-y-3">
                {channels.slice(0, 18).map((ch) => {
                  const d = settings.channelDiscountPercent;
                  const discounted = d > 0 ? calcDiscounted(ch.priceStars, d) : ch.priceStars;

                  return (
                    <div key={ch.id} className="flex items-center justify-between p-3 rounded-xl border bg-white">
                      <div className="min-w-0">
                        <div className="text-sm font-bold text-gray-900 truncate">{ch.name}</div>
                        <div className="text-xs text-gray-400 truncate">{ch.username} • {ch.category}</div>
                      </div>

                      <div className="flex items-center gap-2">
                        {d > 0 && (
                          <span className="text-[10px] font-bold px-2 py-1 rounded-full bg-amber-100 text-amber-800">
                            -{d}%
                          </span>
                        )}
                        <div className="text-right">
                          {d > 0 && (
                            <div className="text-xs text-gray-400 line-through">⭐️ {ch.priceStars}</div>
                          )}
                          <div className="text-sm font-bold text-gray-900">⭐️ {discounted}</div>
                        </div>
                      </div>
                    </div>
                  );
                })}

                {channels.length > 18 && (
                  <div className="text-xs text-gray-400">
                    Показаны первые 18 каналов (всего {channels.length}). В приложении будет полный список.
                  </div>
                )}
              </div>
            )}

            <div className="p-4 rounded-2xl border bg-gray-50 text-sm">
              <div className="font-bold mb-1">Формула:</div>
              <div className="text-gray-600">
                Итог = <b>база</b> (по типу объявления) + <b>сумма каналов</b> (каждый канал со скидкой).
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}