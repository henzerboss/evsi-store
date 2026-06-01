-- Add monthly/yearly championship aggregate tables.
-- This migration only creates new tables and indexes; existing site data is not deleted or modified.

CREATE TABLE "ChessPlayerPeriodCategoryStat" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "playerId" TEXT NOT NULL,
    "periodType" TEXT NOT NULL,
    "periodKey" TEXT NOT NULL,
    "categoryKey" TEXT NOT NULL,
    "timeControlId" TEXT NOT NULL,
    "difficulty" TEXT NOT NULL,
    "wins" INTEGER NOT NULL DEFAULT 0,
    "bestTimeSec" INTEGER,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ChessPlayerPeriodCategoryStat_playerId_fkey" FOREIGN KEY ("playerId") REFERENCES "ChessPlayer" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "ChessCountryPeriodCategoryStat" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "countryCode" TEXT NOT NULL,
    "countryName" TEXT NOT NULL,
    "countryFlag" TEXT NOT NULL,
    "periodType" TEXT NOT NULL,
    "periodKey" TEXT NOT NULL,
    "categoryKey" TEXT NOT NULL,
    "timeControlId" TEXT NOT NULL,
    "difficulty" TEXT NOT NULL,
    "wins" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

CREATE UNIQUE INDEX "ChessPlayerPeriodCategoryStat_playerId_periodType_periodKey_categoryKey_key" ON "ChessPlayerPeriodCategoryStat"("playerId", "periodType", "periodKey", "categoryKey");
CREATE INDEX "ChessPlayerPeriodCategoryStat_periodType_periodKey_categoryKey_wins_updatedAt_idx" ON "ChessPlayerPeriodCategoryStat"("periodType", "periodKey", "categoryKey", "wins", "updatedAt");
CREATE INDEX "ChessPlayerPeriodCategoryStat_playerId_periodType_periodKey_idx" ON "ChessPlayerPeriodCategoryStat"("playerId", "periodType", "periodKey");

CREATE UNIQUE INDEX "ChessCountryPeriodCategoryStat_countryCode_periodType_periodKey_categoryKey_key" ON "ChessCountryPeriodCategoryStat"("countryCode", "periodType", "periodKey", "categoryKey");
CREATE INDEX "ChessCountryPeriodCategoryStat_periodType_periodKey_categoryKey_wins_updatedAt_idx" ON "ChessCountryPeriodCategoryStat"("periodType", "periodKey", "categoryKey", "wins", "updatedAt");
CREATE INDEX "ChessCountryPeriodCategoryStat_countryCode_periodType_periodKey_idx" ON "ChessCountryPeriodCategoryStat"("countryCode", "periodType", "periodKey");
