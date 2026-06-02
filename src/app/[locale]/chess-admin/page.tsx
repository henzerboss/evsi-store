import { auth } from "@/auth";
import prisma from "@/lib/prisma";
import { unstable_cache } from "next/cache";
import Link from "next/link";
import { redirect } from "next/navigation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type PeriodType = "all" | "monthly" | "yearly";

type SearchParams = Record<string, string | string[] | undefined>;

type CountLike = number | bigint | null | undefined;

type KpiRow = {
  totalPlayers: CountLike;
  activePlayers: CountLike;
  allTimeWins: CountLike;
  monthWins: CountLike;
  yearWins: CountLike;
  wins24h: CountLike;
  wins7d: CountLike;
  newPlayers7d: CountLike;
  podiumAwards: CountLike;
  finalizedCategories: CountLike;
};

type RankingRow = {
  rank?: number;
  wins: CountLike;
  updatedAt: Date | string | null;
  nickname?: string | null;
  publicId?: string | null;
  countryCode: string;
  countryName: string;
  countryFlag: string;
};

type ActivityRow = {
  day: string;
  wins: CountLike;
};

type RecentWinRow = {
  createdAt: Date | string | null;
  eventId: string;
  nickname: string;
  publicId: string;
  countryCode: string;
  countryName: string;
  countryFlag: string;
  categoryKey: string;
  timeControlId: string;
  difficulty: string;
  elapsedSec: CountLike;
};

type PodiumAwardRow = {
  createdAt: Date | string | null;
  awardType: string;
  periodType: string;
  periodKey: string;
  categoryKey: string;
  place: CountLike;
  wins: CountLike;
  nickname: string | null;
  playerPublicId: string | null;
  countryCode: string;
  countryName: string;
  countryFlag: string;
};

type CategoryMetricRow = {
  wins: CountLike;
  rowsCount: CountLike;
  lastUpdatedAt: Date | string | null;
};

const TIME_CONTROLS = [
  { id: "classic_60", group: "Классика", label: "60 мин" },
  { id: "rapid_30_20", group: "Рапид", label: "30+20" },
  { id: "rapid_25_0", group: "Рапид", label: "25+0" },
  { id: "rapid_15_10", group: "Рапид", label: "15+10" },
  { id: "rapid_10_0", group: "Рапид", label: "10+0" },
  { id: "blitz_5_3", group: "Блиц", label: "5+3" },
  { id: "blitz_5_0", group: "Блиц", label: "5+0" },
  { id: "blitz_3_2", group: "Блиц", label: "3+2" },
  { id: "blitz_3_0", group: "Блиц", label: "3+0" },
  { id: "bullet_2_1", group: "Пуля", label: "2+1" },
  { id: "bullet_1_1", group: "Пуля", label: "1+1" },
  { id: "bullet_1_0", group: "Пуля", label: "1+0" },
] as const;

const DIFFICULTIES = [
  { id: "beginner", label: "Новичок" },
  { id: "casual", label: "Любитель" },
  { id: "club", label: "Клубный" },
  { id: "expert", label: "Эксперт" },
  { id: "grandmaster", label: "Гроссмейстер" },
] as const;

const CATEGORIES = TIME_CONTROLS.flatMap((timeControl) =>
  DIFFICULTIES.map((difficulty) => ({
    key: `${timeControl.id}__${difficulty.id}`,
    timeControlId: timeControl.id,
    difficulty: difficulty.id,
    label: `${timeControl.group} ${timeControl.label} · ${difficulty.label}`,
  })),
);

const DEFAULT_CATEGORY = "classic_60__beginner";

function pad2(value: number) {
  return String(value).padStart(2, "0");
}

function currentMonthKey(date = new Date()) {
  return `${date.getUTCFullYear()}-${pad2(date.getUTCMonth() + 1)}`;
}

function currentYearKey(date = new Date()) {
  return String(date.getUTCFullYear());
}

function normalizeScalar(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function normalizePeriodType(value: string | string[] | undefined): PeriodType {
  const periodType = normalizeScalar(value);
  if (periodType === "all" || periodType === "monthly" || periodType === "yearly") return periodType;
  return "monthly";
}

function normalizeCategoryKey(value: string | string[] | undefined) {
  const categoryKey = normalizeScalar(value);
  if (categoryKey && CATEGORIES.some((item) => item.key === categoryKey)) return categoryKey;
  return DEFAULT_CATEGORY;
}

function normalizePeriodKey(periodType: PeriodType, value: string | string[] | undefined) {
  const raw = normalizeScalar(value)?.trim();
  if (periodType === "yearly") {
    if (raw && /^\d{4}$/.test(raw)) return raw;
    return currentYearKey();
  }
  if (periodType === "monthly") {
    if (raw && /^\d{4}-\d{2}$/.test(raw)) return raw;
    return currentMonthKey();
  }
  return "all";
}

function toNumber(value: CountLike) {
  if (typeof value === "bigint") return Number(value);
  if (typeof value === "number") return value;
  return 0;
}

function formatNumber(value: CountLike) {
  return new Intl.NumberFormat("ru-RU").format(toNumber(value));
}

function formatDate(value: Date | string | null | undefined) {
  if (!value) return "—";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    year: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function formatElapsed(value: CountLike) {
  const seconds = toNumber(value);
  if (!seconds) return "—";
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return `${minutes}:${pad2(rest)}`;
}

function getCategoryLabel(categoryKey: string) {
  return CATEGORIES.find((item) => item.key === categoryKey)?.label || categoryKey;
}

function getPeriodLabel(periodType: PeriodType, periodKey: string) {
  if (periodType === "all") return "За всё время";
  if (periodType === "yearly") return `${periodKey} год`;
  const [year, month] = periodKey.split("-").map(Number);
  if (!year || !month) return periodKey;
  return new Intl.DateTimeFormat("ru-RU", { month: "long", year: "numeric" }).format(
    new Date(Date.UTC(year, month - 1, 1)),
  );
}

function placeIcon(place: CountLike) {
  switch (toNumber(place)) {
    case 1:
      return "🥇";
    case 2:
      return "🥈";
    case 3:
      return "🥉";
    default:
      return "🏅";
  }
}

async function hasChampionshipTables() {
  const rows = await prisma.$queryRaw<{ name: string }[]>`
    SELECT name
    FROM sqlite_master
    WHERE type = 'table'
      AND name IN (
        'ChessPlayer',
        'ChessPlayerPeriodCategoryStat',
        'ChessCountryPeriodCategoryStat',
        'ChessPlayerCategoryStat',
        'ChessCountryCategoryStat',
        'ChessWinEvent',
        'ChessChampionshipPodiumAward',
        'ChessChampionshipPodiumFinalization'
      )
  `;

  const found = new Set(rows.map((row) => row.name));
  const required = [
    "ChessPlayer",
    "ChessPlayerPeriodCategoryStat",
    "ChessCountryPeriodCategoryStat",
    "ChessPlayerCategoryStat",
    "ChessCountryCategoryStat",
    "ChessWinEvent",
    "ChessChampionshipPodiumAward",
    "ChessChampionshipPodiumFinalization",
  ];

  return {
    ready: required.every((table) => found.has(table)),
    missing: required.filter((table) => !found.has(table)),
  };
}

const getDashboardData = unstable_cache(
  async (periodType: PeriodType, periodKey: string, categoryKey: string) => {
    const tables = await hasChampionshipTables();
    if (!tables.ready) {
      return {
        ready: false as const,
        missingTables: tables.missing,
        generatedAt: new Date().toISOString(),
      };
    }

    const now = new Date();
    const last24h = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const last7d = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const monthKey = currentMonthKey(now);
    const yearKey = currentYearKey(now);

    const [kpiRows, activityRows, recentWins, podiumAwards, categoryMetricRows] = await Promise.all([
      prisma.$queryRaw<KpiRow[]>`
        SELECT
          (SELECT COUNT(1) FROM "ChessPlayer") AS "totalPlayers",
          (SELECT COUNT(1) FROM "ChessPlayer" WHERE "isActive" = 1) AS "activePlayers",
          (SELECT COALESCE(SUM("wins"), 0) FROM "ChessCountryCategoryStat") AS "allTimeWins",
          (SELECT COALESCE(SUM("wins"), 0) FROM "ChessCountryPeriodCategoryStat" WHERE "periodType" = 'monthly' AND "periodKey" = ${monthKey}) AS "monthWins",
          (SELECT COALESCE(SUM("wins"), 0) FROM "ChessCountryPeriodCategoryStat" WHERE "periodType" = 'yearly' AND "periodKey" = ${yearKey}) AS "yearWins",
          (SELECT COUNT(1) FROM "ChessWinEvent" WHERE "createdAt" >= ${last24h}) AS "wins24h",
          (SELECT COUNT(1) FROM "ChessWinEvent" WHERE "createdAt" >= ${last7d}) AS "wins7d",
          (SELECT COUNT(1) FROM "ChessPlayer" WHERE "createdAt" >= ${last7d}) AS "newPlayers7d",
          (SELECT COUNT(1) FROM "ChessChampionshipPodiumAward") AS "podiumAwards",
          (SELECT COUNT(1) FROM "ChessChampionshipPodiumFinalization") AS "finalizedCategories"
      `,
      prisma.$queryRaw<ActivityRow[]>`
        SELECT DATE("createdAt") AS "day", COUNT(1) AS "wins"
        FROM "ChessWinEvent"
        WHERE "createdAt" >= ${new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000)}
        GROUP BY DATE("createdAt")
        ORDER BY "day" ASC
      `,
      prisma.$queryRaw<RecentWinRow[]>`
        SELECT
          e."createdAt" AS "createdAt",
          e."eventId" AS "eventId",
          e."categoryKey" AS "categoryKey",
          e."timeControlId" AS "timeControlId",
          e."difficulty" AS "difficulty",
          e."elapsedSec" AS "elapsedSec",
          p."nickname" AS "nickname",
          p."publicId" AS "publicId",
          p."countryCode" AS "countryCode",
          p."countryName" AS "countryName",
          p."countryFlag" AS "countryFlag"
        FROM "ChessWinEvent" e
        JOIN "ChessPlayer" p ON p."id" = e."playerId"
        ORDER BY e."createdAt" DESC
        LIMIT 30
      `,
      prisma.$queryRaw<PodiumAwardRow[]>`
        SELECT
          "createdAt",
          "awardType",
          "periodType",
          "periodKey",
          "categoryKey",
          "place",
          "wins",
          "nickname",
          "playerPublicId",
          "countryCode",
          "countryName",
          "countryFlag"
        FROM "ChessChampionshipPodiumAward"
        ORDER BY "createdAt" DESC
        LIMIT 30
      `,
      getCategoryMetricRows(periodType, periodKey, categoryKey),
    ]);

    const [players, countries] = await Promise.all([
      getTopPlayers(periodType, periodKey, categoryKey),
      getTopCountries(periodType, periodKey, categoryKey),
    ]);

    const kpis = kpiRows[0]
      ? {
          totalPlayers: toNumber(kpiRows[0].totalPlayers),
          activePlayers: toNumber(kpiRows[0].activePlayers),
          allTimeWins: toNumber(kpiRows[0].allTimeWins),
          monthWins: toNumber(kpiRows[0].monthWins),
          yearWins: toNumber(kpiRows[0].yearWins),
          wins24h: toNumber(kpiRows[0].wins24h),
          wins7d: toNumber(kpiRows[0].wins7d),
          newPlayers7d: toNumber(kpiRows[0].newPlayers7d),
          podiumAwards: toNumber(kpiRows[0].podiumAwards),
          finalizedCategories: toNumber(kpiRows[0].finalizedCategories),
        }
      : null;

    const categoryMetric = categoryMetricRows[0]
      ? {
          wins: toNumber(categoryMetricRows[0].wins),
          rowsCount: toNumber(categoryMetricRows[0].rowsCount),
          lastUpdatedAt: categoryMetricRows[0].lastUpdatedAt ? String(categoryMetricRows[0].lastUpdatedAt) : null,
        }
      : null;

    return {
      ready: true as const,
      generatedAt: new Date().toISOString(),
      kpis,
      activityRows: activityRows.map((row) => ({ ...row, wins: toNumber(row.wins) })),
      recentWins: recentWins.map((row) => ({
        ...row,
        createdAt: row.createdAt ? String(row.createdAt) : null,
        elapsedSec: toNumber(row.elapsedSec),
      })),
      podiumAwards: podiumAwards.map((row) => ({
        ...row,
        createdAt: row.createdAt ? String(row.createdAt) : null,
        place: toNumber(row.place),
        wins: toNumber(row.wins),
      })),
      categoryMetric,
      players: players.map((row, index) => ({
        ...row,
        rank: index + 1,
        wins: toNumber(row.wins),
        updatedAt: row.updatedAt ? String(row.updatedAt) : null,
      })),
      countries: countries.map((row, index) => ({
        ...row,
        rank: index + 1,
        wins: toNumber(row.wins),
        updatedAt: row.updatedAt ? String(row.updatedAt) : null,
      })),
    };
  },
  ["chess-admin-dashboard-v1"],
  { revalidate: 60 },
);

async function getCategoryMetricRows(periodType: PeriodType, periodKey: string, categoryKey: string) {
  if (periodType === "all") {
    return prisma.$queryRaw<CategoryMetricRow[]>`
      SELECT
        COALESCE(SUM("wins"), 0) AS "wins",
        COUNT(1) AS "rowsCount",
        MAX("updatedAt") AS "lastUpdatedAt"
      FROM "ChessCountryCategoryStat"
      WHERE "categoryKey" = ${categoryKey}
    `;
  }

  return prisma.$queryRaw<CategoryMetricRow[]>`
    SELECT
      COALESCE(SUM("wins"), 0) AS "wins",
      COUNT(1) AS "rowsCount",
      MAX("updatedAt") AS "lastUpdatedAt"
    FROM "ChessCountryPeriodCategoryStat"
    WHERE "periodType" = ${periodType}
      AND "periodKey" = ${periodKey}
      AND "categoryKey" = ${categoryKey}
  `;
}

async function getTopPlayers(periodType: PeriodType, periodKey: string, categoryKey: string) {
  if (periodType === "all") {
    return prisma.$queryRaw<RankingRow[]>`
      SELECT
        s."wins" AS "wins",
        s."updatedAt" AS "updatedAt",
        p."nickname" AS "nickname",
        p."publicId" AS "publicId",
        p."countryCode" AS "countryCode",
        p."countryName" AS "countryName",
        p."countryFlag" AS "countryFlag"
      FROM "ChessPlayerCategoryStat" s
      JOIN "ChessPlayer" p ON p."id" = s."playerId"
      WHERE s."categoryKey" = ${categoryKey}
        AND s."wins" > 0
      ORDER BY s."wins" DESC, s."updatedAt" ASC
      LIMIT 30
    `;
  }

  return prisma.$queryRaw<RankingRow[]>`
    SELECT
      s."wins" AS "wins",
      s."updatedAt" AS "updatedAt",
      p."nickname" AS "nickname",
      p."publicId" AS "publicId",
      p."countryCode" AS "countryCode",
      p."countryName" AS "countryName",
      p."countryFlag" AS "countryFlag"
    FROM "ChessPlayerPeriodCategoryStat" s
    JOIN "ChessPlayer" p ON p."id" = s."playerId"
    WHERE s."periodType" = ${periodType}
      AND s."periodKey" = ${periodKey}
      AND s."categoryKey" = ${categoryKey}
      AND s."wins" > 0
    ORDER BY s."wins" DESC, s."updatedAt" ASC
    LIMIT 30
  `;
}

async function getTopCountries(periodType: PeriodType, periodKey: string, categoryKey: string) {
  if (periodType === "all") {
    return prisma.$queryRaw<RankingRow[]>`
      SELECT
        "wins" AS "wins",
        "updatedAt" AS "updatedAt",
        "countryCode" AS "countryCode",
        "countryName" AS "countryName",
        "countryFlag" AS "countryFlag"
      FROM "ChessCountryCategoryStat"
      WHERE "categoryKey" = ${categoryKey}
        AND "wins" > 0
      ORDER BY "wins" DESC, "updatedAt" ASC
      LIMIT 30
    `;
  }

  return prisma.$queryRaw<RankingRow[]>`
    SELECT
      "wins" AS "wins",
      "updatedAt" AS "updatedAt",
      "countryCode" AS "countryCode",
      "countryName" AS "countryName",
      "countryFlag" AS "countryFlag"
    FROM "ChessCountryPeriodCategoryStat"
    WHERE "periodType" = ${periodType}
      AND "periodKey" = ${periodKey}
      AND "categoryKey" = ${categoryKey}
      AND "wins" > 0
    ORDER BY "wins" DESC, "updatedAt" ASC
    LIMIT 30
  `;
}

function KpiCard({ title, value, subtitle }: { title: string; value: string; subtitle?: string }) {
  return (
    <div className="rounded-2xl border bg-white p-5 shadow-sm">
      <div className="text-xs font-bold uppercase tracking-wide text-gray-400">{title}</div>
      <div className="mt-2 text-3xl font-black text-gray-950">{value}</div>
      {subtitle && <div className="mt-1 text-sm text-gray-500">{subtitle}</div>}
    </div>
  );
}

function RankingTable({
  title,
  rows,
  type,
}: {
  title: string;
  rows: RankingRow[];
  type: "players" | "countries";
}) {
  return (
    <div className="rounded-2xl border bg-white shadow-sm overflow-hidden">
      <div className="border-b bg-gray-50 px-5 py-4">
        <h2 className="font-black text-lg">{title}</h2>
        <p className="text-xs text-gray-500 mt-1">Показываются первые 30 строк выбранной категории.</p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-white text-left text-xs uppercase tracking-wide text-gray-400">
            <tr>
              <th className="px-5 py-3">#</th>
              <th className="px-5 py-3">{type === "players" ? "Игрок" : "Страна"}</th>
              <th className="px-5 py-3 text-right">Победы</th>
              <th className="px-5 py-3 text-right">Обновлено</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {rows.length === 0 ? (
              <tr>
                <td colSpan={4} className="px-5 py-8 text-center text-gray-400">
                  Пока нет данных в этой категории.
                </td>
              </tr>
            ) : (
              rows.map((row) => (
                <tr key={`${type}-${row.rank}-${row.countryCode}-${row.publicId || row.countryName}`} className="hover:bg-gray-50">
                  <td className="px-5 py-3 font-bold text-gray-500">{row.rank}</td>
                  <td className="px-5 py-3">
                    <div className="flex items-center gap-3">
                      <span className="text-xl">{row.countryFlag}</span>
                      <div>
                        <div className="font-bold text-gray-900">
                          {type === "players" ? row.nickname || "Без ника" : row.countryName}
                        </div>
                        <div className="text-xs text-gray-400">
                          {type === "players"
                            ? `${row.countryName} · ${row.publicId || "—"}`
                            : row.countryCode}
                        </div>
                      </div>
                    </div>
                  </td>
                  <td className="px-5 py-3 text-right font-black">{formatNumber(row.wins)}</td>
                  <td className="px-5 py-3 text-right text-gray-500">{formatDate(row.updatedAt)}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default async function ChessAdminPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams?: Promise<SearchParams>;
}) {
  const session = await auth();
  if (!session) redirect("/login");

  const resolvedParams = await params;
  const resolvedSearchParams = searchParams ? await searchParams : {};
  const locale = resolvedParams.locale || "ru";
  const periodType = normalizePeriodType(resolvedSearchParams.periodType);
  const categoryKey = normalizeCategoryKey(resolvedSearchParams.categoryKey);
  const periodKey = normalizePeriodKey(periodType, resolvedSearchParams.periodKey);
  const selectedCategory = CATEGORIES.find((item) => item.key === categoryKey) || CATEGORIES[0];

  const data = await getDashboardData(periodType, periodKey, categoryKey);

  return (
    <div className="min-h-screen bg-[#f6f2ea]">
      <div className="container mx-auto max-w-7xl px-4 py-8">
        <div className="mb-8 flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <Link href={`/${locale}/admin`} className="rounded-full border bg-white px-4 py-2 text-sm font-bold shadow-sm hover:bg-gray-50">
                ← Общая админка
              </Link>
              <Link href={`/${locale}/tg-admin`} className="rounded-full border bg-white px-4 py-2 text-sm font-bold shadow-sm hover:bg-gray-50">
                Telegram admin
              </Link>
            </div>
            <h1 className="text-4xl font-black text-gray-950">♟️ Chess Pro Admin</h1>
            <p className="mt-2 max-w-3xl text-gray-600">
              Дашборд чемпионатов читает агрегированные таблицы, кэшируется на 60 секунд и показывает только лимитированные топы, чтобы не создавать лишнюю нагрузку на SQLite даже при большом количестве партий.
            </p>
          </div>
          <div className="rounded-2xl border bg-white px-5 py-4 text-sm text-gray-500 shadow-sm">
            <div className="font-bold text-gray-900">Кэш страницы: 60 сек</div>
            <div>Сгенерировано: {formatDate(data.generatedAt)}</div>
          </div>
        </div>

        {!data.ready ? (
          <div className="rounded-2xl border border-amber-200 bg-amber-50 p-6 text-amber-900 shadow-sm">
            <h2 className="text-xl font-black">Таблицы чемпионата ещё не готовы</h2>
            <p className="mt-2">Не найдены таблицы: {data.missingTables.join(", ")}</p>
            <p className="mt-2 text-sm">
              На сервере нужно применить миграции чемпионата: <code>npx prisma migrate deploy</code>, затем <code>npx prisma generate</code>.
            </p>
          </div>
        ) : (
          <>
            <form action={`/${locale}/chess-admin`} className="mb-6 rounded-2xl border bg-white p-5 shadow-sm">
              <div className="grid gap-4 lg:grid-cols-[180px_180px_1fr_auto] lg:items-end">
                <div>
                  <label className="text-xs font-bold uppercase tracking-wide text-gray-400">Период</label>
                  <select
                    name="periodType"
                    defaultValue={periodType}
                    className="mt-2 w-full rounded-xl border bg-white px-3 py-3 font-bold outline-none focus:ring-2 focus:ring-black/10"
                  >
                    <option value="monthly">Месячный</option>
                    <option value="yearly">Годовой</option>
                    <option value="all">За всё время</option>
                  </select>
                </div>
                <div>
                  <label className="text-xs font-bold uppercase tracking-wide text-gray-400">Ключ периода</label>
                  <input
                    name="periodKey"
                    defaultValue={periodType === "all" ? "" : periodKey}
                    placeholder={periodType === "yearly" ? "2026" : "2026-06"}
                    className="mt-2 w-full rounded-xl border bg-white px-3 py-3 font-bold outline-none focus:ring-2 focus:ring-black/10"
                  />
                </div>
                <div>
                  <label className="text-xs font-bold uppercase tracking-wide text-gray-400">Категория рейтинга</label>
                  <select
                    name="categoryKey"
                    defaultValue={categoryKey}
                    className="mt-2 w-full rounded-xl border bg-white px-3 py-3 font-bold outline-none focus:ring-2 focus:ring-black/10"
                  >
                    {TIME_CONTROLS.map((timeControl) => (
                      <optgroup key={timeControl.id} label={`${timeControl.group} ${timeControl.label}`}>
                        {DIFFICULTIES.map((difficulty) => {
                          const key = `${timeControl.id}__${difficulty.id}`;
                          return (
                            <option key={key} value={key}>
                              {difficulty.label}
                            </option>
                          );
                        })}
                      </optgroup>
                    ))}
                  </select>
                </div>
                <button className="rounded-xl bg-black px-6 py-3 font-black text-white shadow-sm hover:opacity-90">
                  Показать
                </button>
              </div>
              <div className="mt-4 flex flex-wrap gap-2 text-xs font-bold text-gray-500">
                <span className="rounded-full bg-[#f6f2ea] px-3 py-1">{getPeriodLabel(periodType, periodKey)}</span>
                <span className="rounded-full bg-[#f6f2ea] px-3 py-1">{selectedCategory.label}</span>
                <span className="rounded-full bg-[#f6f2ea] px-3 py-1">60 категорий = 12 контролей × 5 сложностей</span>
              </div>
            </form>

            <div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
              <KpiCard title="Игроки" value={formatNumber(data.kpis?.totalPlayers)} subtitle={`Активны: ${formatNumber(data.kpis?.activePlayers)}`} />
              <KpiCard title="Победы всего" value={formatNumber(data.kpis?.allTimeWins)} subtitle="по агрегатам стран" />
              <KpiCard title="Текущий месяц" value={formatNumber(data.kpis?.monthWins)} subtitle={`За 24 часа: ${formatNumber(data.kpis?.wins24h)}`} />
              <KpiCard title="Текущий год" value={formatNumber(data.kpis?.yearWins)} subtitle={`За 7 дней: ${formatNumber(data.kpis?.wins7d)}`} />
              <KpiCard title="Подиумы" value={formatNumber(data.kpis?.podiumAwards)} subtitle={`Финализаций: ${formatNumber(data.kpis?.finalizedCategories)}`} />
            </div>

            <div className="mb-6 grid gap-4 lg:grid-cols-3">
              <div className="rounded-2xl border bg-white p-5 shadow-sm lg:col-span-2">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <h2 className="text-lg font-black">Активность за 14 дней</h2>
                    <p className="text-sm text-gray-500">Берётся из индекса по последним событиям побед.</p>
                  </div>
                  <div className="rounded-full bg-gray-100 px-3 py-1 text-xs font-bold text-gray-500">
                    Новые игроки за 7 дней: {formatNumber(data.kpis?.newPlayers7d)}
                  </div>
                </div>
                <div className="mt-5 flex h-44 items-end gap-2">
                  {data.activityRows.length === 0 ? (
                    <div className="flex h-full w-full items-center justify-center rounded-xl bg-gray-50 text-gray-400">Нет событий за период</div>
                  ) : (
                    data.activityRows.map((row) => {
                      const max = Math.max(...data.activityRows.map((item) => toNumber(item.wins)), 1);
                      const height = Math.max(8, Math.round((toNumber(row.wins) / max) * 160));
                      return (
                        <div key={row.day} className="flex flex-1 flex-col items-center gap-2">
                          <div className="w-full rounded-t-xl bg-black/80" style={{ height }} title={`${row.day}: ${formatNumber(row.wins)}`} />
                          <div className="text-[10px] text-gray-400">{row.day.slice(5)}</div>
                        </div>
                      );
                    })
                  )}
                </div>
              </div>

              <div className="rounded-2xl border bg-white p-5 shadow-sm">
                <h2 className="text-lg font-black">Выбранная категория</h2>
                <div className="mt-4 rounded-2xl bg-[#f6f2ea] p-4">
                  <div className="text-sm text-gray-500">{getPeriodLabel(periodType, periodKey)}</div>
                  <div className="mt-1 text-xl font-black">{getCategoryLabel(categoryKey)}</div>
                  <div className="mt-4 grid grid-cols-2 gap-3">
                    <div>
                      <div className="text-xs font-bold uppercase text-gray-400">Победы</div>
                      <div className="text-2xl font-black">{formatNumber(data.categoryMetric?.wins)}</div>
                    </div>
                    <div>
                      <div className="text-xs font-bold uppercase text-gray-400">Строк стран</div>
                      <div className="text-2xl font-black">{formatNumber(data.categoryMetric?.rowsCount)}</div>
                    </div>
                  </div>
                  <div className="mt-3 text-xs text-gray-500">Последнее обновление: {formatDate(data.categoryMetric?.lastUpdatedAt)}</div>
                </div>
              </div>
            </div>

            <div className="mb-6 grid gap-6 xl:grid-cols-2">
              <RankingTable title="Топ игроков" rows={data.players} type="players" />
              <RankingTable title="Топ стран" rows={data.countries} type="countries" />
            </div>

            <div className="grid gap-6 xl:grid-cols-2">
              <div className="rounded-2xl border bg-white shadow-sm overflow-hidden">
                <div className="border-b bg-gray-50 px-5 py-4">
                  <h2 className="font-black text-lg">Последние победы</h2>
                  <p className="text-xs text-gray-500 mt-1">Последние 30 событий, без полного сканирования истории.</p>
                </div>
                <div className="divide-y">
                  {data.recentWins.length === 0 ? (
                    <div className="p-8 text-center text-gray-400">Побед пока нет.</div>
                  ) : (
                    data.recentWins.map((win) => (
                      <div key={win.eventId} className="flex items-center justify-between gap-4 px-5 py-4">
                        <div className="min-w-0">
                          <div className="font-bold truncate">
                            {win.countryFlag} {win.nickname}
                          </div>
                          <div className="text-xs text-gray-500 truncate">
                            {getCategoryLabel(win.categoryKey)} · {formatElapsed(win.elapsedSec)} · {win.publicId}
                          </div>
                        </div>
                        <div className="shrink-0 text-right text-xs text-gray-500">{formatDate(win.createdAt)}</div>
                      </div>
                    ))
                  )}
                </div>
              </div>

              <div className="rounded-2xl border bg-white shadow-sm overflow-hidden">
                <div className="border-b bg-gray-50 px-5 py-4">
                  <h2 className="font-black text-lg">Последние кубки</h2>
                  <p className="text-xs text-gray-500 mt-1">Последние 30 подиумов, которые уже выданы игрокам/странам.</p>
                </div>
                <div className="divide-y">
                  {data.podiumAwards.length === 0 ? (
                    <div className="p-8 text-center text-gray-400">Кубки ещё не выдавались.</div>
                  ) : (
                    data.podiumAwards.map((award) => (
                      <div
                        key={`${award.awardType}-${award.periodType}-${award.periodKey}-${award.categoryKey}-${award.place}-${award.playerPublicId || award.countryCode}`}
                        className="flex items-center justify-between gap-4 px-5 py-4"
                      >
                        <div className="min-w-0">
                          <div className="font-bold truncate">
                            {placeIcon(award.place)} {award.awardType === "player" ? award.nickname || "Игрок" : award.countryName}
                          </div>
                          <div className="text-xs text-gray-500 truncate">
                            {award.countryFlag} {award.periodType === "yearly" ? "Год" : "Месяц"} {award.periodKey} · {getCategoryLabel(award.categoryKey)}
                          </div>
                        </div>
                        <div className="shrink-0 text-right">
                          <div className="font-black">{formatNumber(award.wins)}</div>
                          <div className="text-xs text-gray-400">{formatDate(award.createdAt)}</div>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
