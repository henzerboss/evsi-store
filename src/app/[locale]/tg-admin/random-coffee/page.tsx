// file: src/app/[locale]/tg-admin/random-coffee/page.tsx

import { auth } from "@/auth";
import { redirect } from "next/navigation";
import { PrismaClient } from '@prisma/client';
import { SignOutButton } from "@/components/sign-out-button";
import Link from "next/link"; // Импортируем Link

const prisma = new PrismaClient();

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
  profile: RCProfile;
}

interface RCHistory {
  id: string;
  date: Date;
  userAId: string;
  userBId: string;
}

export default async function RandomCoffeeAdminPage() {
  const session = await auth();
  if (!session) redirect('/login');

  // 1. Все профили
  const profiles = (await prisma.randomCoffeeProfile.findMany({
    orderBy: { createdAt: 'desc' }
  })) as RCProfile[];

  // 2. Участники на БЛИЖАЙШУЮ пятницу (или сегодня, если пятница)
  const today = new Date();
  const startOfDay = new Date(); startOfDay.setHours(0,0,0,0);
  
  const activeParticipations = (await prisma.randomCoffeeParticipation.findMany({
    where: {
        status: 'PAID', // Только те, кто оплатил и ждет
        matchDate: { gte: startOfDay }
    },
    include: { profile: true },
    orderBy: { matchDate: 'asc' }
  })) as RCParticipation[];

  // 3. История совпадений (последние 50)
  const history = (await prisma.randomCoffeeHistory.findMany({
    take: 50,
    orderBy: { date: 'desc' }
  })) as RCHistory[];

  return (
    <div className="container max-w-6xl mx-auto py-10 px-4">
      <div className="flex justify-between items-center mb-8 border-b pb-4">
        <div>
            <h1 className="text-3xl font-bold">☕️ Random Coffee Admin</h1>
            <p className="text-gray-500">Управление нетворкингом</p>
        </div>
        <div className="flex items-center gap-4">
            {/* ИСПРАВЛЕНИЕ: Используем Link вместо a */}
            <Link href="/ru/tg-admin" className="text-sm font-medium text-blue-600 hover:underline">
              ← Назад в Job Admin
            </Link>
            <SignOutButton />
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-10">
        <div className="p-6 bg-white rounded-xl border shadow-sm">
            <h3 className="text-sm font-medium text-gray-500">Всего участников</h3>
            <p className="text-3xl font-bold text-orange-600">{profiles.length}</p>
        </div>
        <div className="p-6 bg-white rounded-xl border shadow-sm">
            <h3 className="text-sm font-medium text-gray-500">Записано на пятницу</h3>
            <p className="text-3xl font-bold text-blue-600">{activeParticipations.length}</p>
        </div>
        <div className="p-6 bg-white rounded-xl border shadow-sm">
            <h3 className="text-sm font-medium text-gray-500">Всего встреч</h3>
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
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100">
                            {activeParticipations.length === 0 ? (
                                <tr><td colSpan={4} className="px-6 py-4 text-center text-gray-500">Очередь пуста</td></tr>
                            ) : (
                                activeParticipations.map(p => (
                                    <tr key={p.id} className="hover:bg-gray-50">
                                        <td className="px-6 py-4 font-medium text-gray-900">
                                            {new Date(p.matchDate).toLocaleDateString()}
                                        </td>
                                        <td className="px-6 py-4">
                                            {p.profile.name} <br/>
                                            <span className="text-xs text-gray-400">ID: {p.profile.telegramUserId}</span>
                                        </td>
                                        <td className="px-6 py-4">{p.profile.specialty}</td>
                                        <td className="px-6 py-4 max-w-xs truncate" title={p.profile.interests}>{p.profile.interests}</td>
                                    </tr>
                                ))
                            )}
                        </tbody>
                    </table>
                </div>
            </div>
        </section>

        {/* Секция 2: Все профили */}
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
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                        {profiles.map(p => (
                            <tr key={p.id} className="hover:bg-gray-50">
                                <td className="px-6 py-4 font-medium">{p.name}</td>
                                <td className="px-6 py-4">{p.specialty}</td>
                                <td className="px-6 py-4">
                                    {p.linkedin ? (
                                        <a href={p.linkedin} target="_blank" className="text-blue-600 hover:underline">Link</a>
                                    ) : '-'}
                                </td>
                                <td className="px-6 py-4 text-gray-500">
                                    {new Date(p.createdAt).toLocaleDateString()}
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