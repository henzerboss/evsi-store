-- CreateTable
CREATE TABLE "ChessPlayer" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "publicId" TEXT NOT NULL,
    "nickname" TEXT NOT NULL,
    "countryCode" TEXT NOT NULL,
    "countryName" TEXT NOT NULL,
    "countryFlag" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "joinedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "leftAt" DATETIME,
    "totalWins" INTEGER NOT NULL DEFAULT 0,
    "lastWinAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "ChessPlayerCategoryStat" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "playerId" TEXT NOT NULL,
    "categoryKey" TEXT NOT NULL,
    "timeControlId" TEXT NOT NULL,
    "difficulty" TEXT NOT NULL,
    "wins" INTEGER NOT NULL DEFAULT 0,
    "bestTimeSec" INTEGER,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ChessPlayerCategoryStat_playerId_fkey" FOREIGN KEY ("playerId") REFERENCES "ChessPlayer" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ChessCountryCategoryStat" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "countryCode" TEXT NOT NULL,
    "countryName" TEXT NOT NULL,
    "countryFlag" TEXT NOT NULL,
    "categoryKey" TEXT NOT NULL,
    "timeControlId" TEXT NOT NULL,
    "difficulty" TEXT NOT NULL,
    "wins" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "ChessWinEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "eventId" TEXT NOT NULL,
    "playerId" TEXT NOT NULL,
    "countryCode" TEXT NOT NULL,
    "categoryKey" TEXT NOT NULL,
    "timeControlId" TEXT NOT NULL,
    "difficulty" TEXT NOT NULL,
    "elapsedSec" INTEGER,
    "occurredAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ChessWinEvent_playerId_fkey" FOREIGN KEY ("playerId") REFERENCES "ChessPlayer" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "ChessPlayer_publicId_key" ON "ChessPlayer"("publicId");
CREATE INDEX "ChessPlayer_countryCode_idx" ON "ChessPlayer"("countryCode");
CREATE INDEX "ChessPlayer_isActive_totalWins_idx" ON "ChessPlayer"("isActive", "totalWins");

CREATE UNIQUE INDEX "ChessPlayerCategoryStat_playerId_categoryKey_key" ON "ChessPlayerCategoryStat"("playerId", "categoryKey");
CREATE INDEX "ChessPlayerCategoryStat_categoryKey_wins_updatedAt_idx" ON "ChessPlayerCategoryStat"("categoryKey", "wins", "updatedAt");

CREATE UNIQUE INDEX "ChessCountryCategoryStat_countryCode_categoryKey_key" ON "ChessCountryCategoryStat"("countryCode", "categoryKey");
CREATE INDEX "ChessCountryCategoryStat_categoryKey_wins_updatedAt_idx" ON "ChessCountryCategoryStat"("categoryKey", "wins", "updatedAt");

CREATE UNIQUE INDEX "ChessWinEvent_eventId_key" ON "ChessWinEvent"("eventId");
CREATE INDEX "ChessWinEvent_playerId_createdAt_idx" ON "ChessWinEvent"("playerId", "createdAt");
CREATE INDEX "ChessWinEvent_categoryKey_createdAt_idx" ON "ChessWinEvent"("categoryKey", "createdAt");
CREATE INDEX "ChessWinEvent_countryCode_categoryKey_idx" ON "ChessWinEvent"("countryCode", "categoryKey");
