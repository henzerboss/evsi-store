-- CreateTable
CREATE TABLE IF NOT EXISTS "ChessChampionshipRankAward" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "awardType" TEXT NOT NULL,
    "periodType" TEXT NOT NULL,
    "periodKey" TEXT NOT NULL,
    "categoryKey" TEXT NOT NULL,
    "timeControlId" TEXT NOT NULL,
    "difficulty" TEXT NOT NULL,
    "ownerKey" TEXT NOT NULL,
    "rank" INTEGER NOT NULL,
    "wins" INTEGER NOT NULL,
    "participantCount" INTEGER NOT NULL,
    "playerId" TEXT,
    "playerPublicId" TEXT,
    "nickname" TEXT,
    "countryCode" TEXT NOT NULL,
    "countryName" TEXT NOT NULL,
    "countryFlag" TEXT NOT NULL,
    "finalizedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ChessChampionshipRankAward_playerId_fkey" FOREIGN KEY ("playerId") REFERENCES "ChessPlayer" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "ChessChampionshipRankAward_awardType_periodType_periodKey_categoryKey_ownerKey_key" ON "ChessChampionshipRankAward"("awardType", "periodType", "periodKey", "categoryKey", "ownerKey");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "ChessChampionshipRankAward_playerId_awardType_rank_idx" ON "ChessChampionshipRankAward"("playerId", "awardType", "rank");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "ChessChampionshipRankAward_countryCode_awardType_rank_idx" ON "ChessChampionshipRankAward"("countryCode", "awardType", "rank");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "ChessChampionshipRankAward_periodType_periodKey_categoryKey_awardType_rank_idx" ON "ChessChampionshipRankAward"("periodType", "periodKey", "categoryKey", "awardType", "rank");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "ChessChampionshipRankAward_createdAt_idx" ON "ChessChampionshipRankAward"("createdAt");
