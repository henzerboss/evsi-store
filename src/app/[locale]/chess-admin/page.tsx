import { auth } from "@/auth";
import prisma from "@/lib/prisma";
import { revalidateTag, unstable_cache } from "next/cache";
import { headers } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;
export const fetchCache = "force-no-store";

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
type PlayerAdminRow = {
  id: string;
  publicId: string;
  nickname: string;
  countryCode: string;
  countryName: string;
  countryFlag: string;
  isActive: number | boolean;
  totalWins: CountLike;
  lastWinAt: Date | string | null;
  createdAt: Date | string | null;
  updatedAt: Date | string | null;
  winEvents: CountLike;
  podiumAwards: CountLike;
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

function normalizePlayerSearch(value: string | string[] | undefined) {
  return (normalizeScalar(value) || "").normalize("NFKC").trim().slice(0, 64);
}

function sanitizeAdminNickname(value: FormDataEntryValue | null) {
  const normalized = String(value || "")
    .normalize("NFKC")
    .replace(/[\u0000-\u001f\u007f-\u009f\u200e\u200f\u202a-\u202e]/g, "")
    .replace(/[<>&"'`]/g, "")
    .replace(/[^\p{L}\p{N}_ .-]/gu, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 24);

  if (normalized.length < 2) {
    throw new Error("Ник должен содержать минимум 2 допустимых символа.");
  }

  return normalized;
}

function sanitizePublicId(value: FormDataEntryValue | null) {
  const normalized = String(value || "").trim();
  if (!/^[a-zA-Z0-9_-]{12,96}$/.test(normalized)) {
    throw new Error("Некорректный publicId игрока.");
  }
  return normalized;
}

function getSafeReturnTo(value: FormDataEntryValue | null) {
  const raw = String(value || "/ru/chess-admin");
  if (!raw.startsWith("/") || raw.startsWith("//") || raw.includes("\\")) return "/ru/chess-admin";
  return raw.slice(0, 500);
}

function withNotice(path: string, notice: string, noticeType: "ok" | "error" = "ok") {
  const url = new URL(path, "https://evsi.local");
  url.searchParams.set("adminNotice", notice.slice(0, 180));
  url.searchParams.set("adminNoticeType", noticeType);
  return `${url.pathname}${url.search}`;
}

function escapeSqlLike(value: string) {
  return value.replace(/[\\%_]/g, (match) => `\\${match}`);
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

async function requireAdminSession() {
  const session = await auth();
  if (!session) redirect("/login");
  return session;
}

async function renameChessPlayerAction(formData: FormData) {
  "use server";

  const returnTo = getSafeReturnTo(formData.get("returnTo"));
  await requireAdminSession();

  let redirectTo = returnTo;

  try {
    const publicId = sanitizePublicId(formData.get("publicId"));
    const nickname = sanitizeAdminNickname(formData.get("nickname"));

    const player = await prisma.chessPlayer.update({
      where: { publicId },
      data: { nickname },
      select: { id: true, publicId: true },
    });

    await prisma.chessChampionshipPodiumAward.updateMany({
      where: { playerId: player.id },
      data: { nickname },
    });

    revalidateTag("chess-admin-dashboard");
    redirectTo = withNotice(returnTo, `Игрок ${player.publicId} переименован.`);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Не удалось переименовать игрока.";
    redirectTo = withNotice(returnTo, message, "error");
  }

  redirect(redirectTo);
}

async function deleteChessPlayerAction(formData: FormData) {
  "use server";

  const returnTo = getSafeReturnTo(formData.get("returnTo"));
  await requireAdminSession();

  let redirectTo = returnTo;

  try {
    const publicId = sanitizePublicId(formData.get("publicId"));
    const confirmValue = String(formData.get("confirmDelete") || "").trim();

    if (confirmValue !== `DELETE ${publicId}`) {
      throw new Error(`Для удаления введите: DELETE ${publicId}`);
    }

    const result = await prisma.$transaction(async (tx) => {
      const player = await tx.chessPlayer.findUnique({
        where: { publicId },
        select: { id: true, publicId: true, countryCode: true },
      });

      if (!player) throw new Error("Игрок не найден.");

      const [allTimeStats, periodStats] = await Promise.all([
        tx.chessPlayerCategoryStat.findMany({
          where: { playerId: player.id },
          select: { categoryKey: true, wins: true },
        }),
        tx.chessPlayerPeriodCategoryStat.findMany({
          where: { playerId: player.id },
          select: { periodType: true, periodKey: true, categoryKey: true, wins: true },
        }),
      ]);

      for (const stat of allTimeStats) {
        if (stat.wins <= 0) continue;
        await tx.$executeRaw`
          UPDATE "ChessCountryCategoryStat"
          SET
            "wins" = CASE WHEN "wins" >= ${stat.wins} THEN "wins" - ${stat.wins} ELSE 0 END,
            "updatedAt" = CURRENT_TIMESTAMP
          WHERE "countryCode" = ${player.countryCode}
            AND "categoryKey" = ${stat.categoryKey}
        `;
      }

      for (const stat of periodStats) {
        if (stat.wins <= 0) continue;
        await tx.$executeRaw`
          UPDATE "ChessCountryPeriodCategoryStat"
          SET
            "wins" = CASE WHEN "wins" >= ${stat.wins} THEN "wins" - ${stat.wins} ELSE 0 END,
            "updatedAt" = CURRENT_TIMESTAMP
          WHERE "countryCode" = ${player.countryCode}
            AND "periodType" = ${stat.periodType}
            AND "periodKey" = ${stat.periodKey}
            AND "categoryKey" = ${stat.categoryKey}
        `;
      }

      await tx.chessChampionshipPodiumAward.deleteMany({
        where: { awardType: "player", playerId: player.id },
      });

      await tx.chessPlayer.delete({ where: { id: player.id } });

      return { publicId: player.publicId };
    });

    revalidateTag("chess-admin-dashboard");
    redirectTo = withNotice(returnTo, `Игрок ${result.publicId} удалён. Его личные победы вычтены из агрегатов страны.`);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Не удалось удалить игрока.";
    redirectTo = withNotice(returnTo, message, "error");
  }

  redirect(redirectTo);
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
  ["chess-admin-dashboard-v2"],
  { revalidate: 60, tags: ["chess-admin-dashboard"] },
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

async function getPlayerAdminRows(search: string): Promise<PlayerAdminRow[]> {
  const clean = search.trim();

  if (clean) {
    const like = `${escapeSqlLike(clean)}%`;
    return prisma.$queryRaw<PlayerAdminRow[]>`
      SELECT
        p."id" AS "id",
        p."publicId" AS "publicId",
        p."nickname" AS "nickname",
        p."countryCode" AS "countryCode",
        p."countryName" AS "countryName",
        p."countryFlag" AS "countryFlag",
        p."isActive" AS "isActive",
        p."totalWins" AS "totalWins",
        p."lastWinAt" AS "lastWinAt",
        p."createdAt" AS "createdAt",
        p."updatedAt" AS "updatedAt",
        (SELECT COUNT(1) FROM "ChessWinEvent" e WHERE e."playerId" = p."id") AS "winEvents",
        (SELECT COUNT(1) FROM "ChessChampionshipPodiumAward" a WHERE a."playerId" = p."id") AS "podiumAwards"
      FROM "ChessPlayer" p
      WHERE p."publicId" = ${clean}
         OR p."nickname" LIKE ${like} ESCAPE '\\'
      ORDER BY
        CASE WHEN p."publicId" = ${clean} THEN 0 ELSE 1 END ASC,
        p."updatedAt" DESC
      LIMIT 30
    `;
  }

  return prisma.$queryRaw<PlayerAdminRow[]>`
    SELECT
      p."id" AS "id",
      p."publicId" AS "publicId",
      p."nickname" AS "nickname",
      p."countryCode" AS "countryCode",
      p."countryName" AS "countryName",
      p."countryFlag" AS "countryFlag",
      p."isActive" AS "isActive",
      p."totalWins" AS "totalWins",
      p."lastWinAt" AS "lastWinAt",
      p."createdAt" AS "createdAt",
      p."updatedAt" AS "updatedAt",
      (SELECT COUNT(1) FROM "ChessWinEvent" e WHERE e."playerId" = p."id") AS "winEvents",
      (SELECT COUNT(1) FROM "ChessChampionshipPodiumAward" a WHERE a."playerId" = p."id") AS "podiumAwards"
    FROM "ChessPlayer" p
    ORDER BY p."updatedAt" DESC
    LIMIT 20
  `;
}

function NoticeBox({ notice, type }: { notice?: string; type?: string }) {
  if (!notice) return null;
  const isError = type === "error";
  return (
    <div className={`mb-6 rounded-2xl border p-4 text-sm font-bold shadow-sm ${isError ? "border-red-200 bg-red-50 text-red-800" : "border-emerald-200 bg-emerald-50 text-emerald-800"}`}>
      {notice}
    </div>
  );
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

function PlayerManagement({
  locale,
  returnTo,
  search,
  players,
  periodType,
  periodKey,
  categoryKey,
}: {
  locale: string;
  returnTo: string;
  search: string;
  players: PlayerAdminRow[];
  periodType: PeriodType;
  periodKey: string;
  categoryKey: string;
}) {
  return (
    <div className="mb-6 rounded-2xl border bg-white shadow-sm overflow-hidden">
      <div className="border-b bg-gray-50 px-5 py-4">
        <h2 className="font-black text-lg">Управление игроками</h2>
        <p className="mt-1 text-xs text-gray-500">
          Поиск работает по точному publicId или префиксу ника. Список ограничен 30 строками, чтобы не сканировать большую базу в админке.
        </p>
      </div>

      <div className="border-b px-5 py-4">
        <form action={`/${locale}/chess-admin`} className="grid gap-3 lg:grid-cols-[1fr_auto]">
          <input type="hidden" name="periodType" value={periodType} />
          <input type="hidden" name="periodKey" value={periodType === "all" ? "" : periodKey} />
          <input type="hidden" name="categoryKey" value={categoryKey} />
          <input
            name="playerSearch"
            defaultValue={search}
            placeholder="publicId или начало ника, например Player-ABC"
            className="rounded-xl border bg-white px-3 py-3 font-bold outline-none focus:ring-2 focus:ring-black/10"
          />
          <button className="rounded-xl bg-black px-6 py-3 font-black text-white shadow-sm hover:opacity-90">
            Найти игрока
          </button>
        </form>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-white text-left text-xs uppercase tracking-wide text-gray-400">
            <tr>
              <th className="px-5 py-3">Игрок</th>
              <th className="px-5 py-3 text-right">Победы</th>
              <th className="px-5 py-3 text-right">События</th>
              <th className="px-5 py-3">Переименовать</th>
              <th className="px-5 py-3">Удалить</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {players.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-5 py-8 text-center text-gray-400">
                  Игроки не найдены.
                </td>
              </tr>
            ) : (
              players.map((player) => {
                const isActive = player.isActive === true || player.isActive === 1;
                return (
                  <tr key={player.publicId} className="align-top hover:bg-gray-50">
                    <td className="px-5 py-4">
                      <div className="flex items-start gap-3">
                        <span className="text-xl">{player.countryFlag}</span>
                        <div className="min-w-0">
                          <div className="font-black text-gray-900">{player.nickname}</div>
                          <div className="mt-1 text-xs text-gray-500">
                            {player.countryName} · {player.publicId}
                          </div>
                          <div className="mt-2 flex flex-wrap gap-2 text-[11px] font-bold">
                            <span className={`rounded-full px-2 py-1 ${isActive ? "bg-emerald-50 text-emerald-700" : "bg-gray-100 text-gray-500"}`}>
                              {isActive ? "активен" : "не участвует"}
                            </span>
                            <span className="rounded-full bg-gray-100 px-2 py-1 text-gray-500">
                              кубки: {formatNumber(player.podiumAwards)}
                            </span>
                            <span className="rounded-full bg-gray-100 px-2 py-1 text-gray-500">
                              обновлён: {formatDate(player.updatedAt)}
                            </span>
                          </div>
                        </div>
                      </div>
                    </td>
                    <td className="px-5 py-4 text-right font-black">{formatNumber(player.totalWins)}</td>
                    <td className="px-5 py-4 text-right text-gray-500">{formatNumber(player.winEvents)}</td>
                    <td className="px-5 py-4">
                      <form action={renameChessPlayerAction} className="flex min-w-[260px] gap-2">
                        <input type="hidden" name="returnTo" value={returnTo} />
                        <input type="hidden" name="publicId" value={player.publicId} />
                        <input
                          name="nickname"
                          defaultValue={player.nickname}
                          maxLength={24}
                          className="min-w-0 flex-1 rounded-xl border bg-white px-3 py-2 font-bold outline-none focus:ring-2 focus:ring-black/10"
                        />
                        <button className="rounded-xl border bg-white px-3 py-2 font-black hover:bg-gray-50">OK</button>
                      </form>
                    </td>
                    <td className="px-5 py-4">
                      <form action={deleteChessPlayerAction} className="min-w-[280px] space-y-2">
                        <input type="hidden" name="returnTo" value={returnTo} />
                        <input type="hidden" name="publicId" value={player.publicId} />
                        <input
                          name="confirmDelete"
                          placeholder={`DELETE ${player.publicId}`}
                          className="w-full rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs font-bold text-red-800 outline-none focus:ring-2 focus:ring-red-200"
                        />
                        <button className="w-full rounded-xl bg-red-600 px-3 py-2 text-xs font-black text-white hover:bg-red-700">
                          Удалить игрока
                        </button>
                      </form>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}


function makeEmptyDashboardData() {
  return {
    ready: true as const,
    generatedAt: new Date().toISOString(),
    kpis: {
      totalPlayers: 0,
      activePlayers: 0,
      allTimeWins: 0,
      monthWins: 0,
      yearWins: 0,
      wins24h: 0,
      wins7d: 0,
      newPlayers7d: 0,
      podiumAwards: 0,
      finalizedCategories: 0,
    },
    activityRows: [],
    recentWins: [],
    podiumAwards: [],
    categoryMetric: { wins: 0, rowsCount: 0, lastUpdatedAt: null },
    players: [],
    countries: [],
  };
}

export default async function ChessAdminPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams?: Promise<SearchParams>;
}) {
  await headers();
  const session = await auth();
  if (!session) redirect("/login");

  const resolvedParams = await params;
  const resolvedSearchParams = searchParams ? await searchParams : {};
  const locale = resolvedParams.locale || "ru";
  const periodType = normalizePeriodType(resolvedSearchParams.periodType);
  const categoryKey = normalizeCategoryKey(resolvedSearchParams.categoryKey);
  const periodKey = normalizePeriodKey(periodType, resolvedSearchParams.periodKey);
  const playerSearch = normalizePlayerSearch(resolvedSearchParams.playerSearch);
  const notice = normalizeScalar(resolvedSearchParams.adminNotice);
  const noticeType = normalizeScalar(resolvedSearchParams.adminNoticeType);
  const selectedCategory = CATEGORIES.find((item) => item.key === categoryKey) || CATEGORIES[0];
  const returnToParams = new URLSearchParams();
  returnToParams.set("periodType", periodType);
  if (periodType !== "all") returnToParams.set("periodKey", periodKey);
  returnToParams.set("categoryKey", categoryKey);
  if (playerSearch) returnToParams.set("playerSearch", playerSearch);
  const returnTo = `/${locale}/chess-admin?${returnToParams.toString()}`;

  let dashboardError: string | null = null;
  let data: Awaited<ReturnType<typeof getDashboardData>> | ReturnType<typeof makeEmptyDashboardData> = makeEmptyDashboardData();
  let playerRows: PlayerAdminRow[] = [];

  try {
    data = await getDashboardData(periodType, periodKey, categoryKey);
  } catch (error) {
    console.error("Chess admin dashboard failed", error);
    dashboardError = error instanceof Error ? error.message : "Неизвестная ошибка дашборда.";
  }

  if (data.ready) {
    try {
      playerRows = await getPlayerAdminRows(playerSearch);
    } catch (error) {
      console.error("Chess admin player search failed", error);
      dashboardError = error instanceof Error ? error.message : "Не удалось загрузить игроков.";
    }
  }

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

        <NoticeBox notice={notice} type={noticeType} />
        {dashboardError ? (
          <div className="mb-6 rounded-2xl border border-red-200 bg-red-50 p-5 text-red-900 shadow-sm">
            <h2 className="font-black">Ошибка загрузки Chess Admin</h2>
            <p className="mt-2 text-sm">Страница не падает целиком, но один из запросов к БД вернул ошибку.</p>
            <code className="mt-3 block whitespace-pre-wrap rounded-xl bg-white/70 p-3 text-xs text-red-800">{dashboardError}</code>
          </div>
        ) : null}

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

            <PlayerManagement
              locale={locale}
              returnTo={returnTo}
              search={playerSearch}
              players={playerRows}
              periodType={periodType}
              periodKey={periodKey}
              categoryKey={categoryKey}
            />

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
