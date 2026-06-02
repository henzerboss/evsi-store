-- CreateTable
CREATE TABLE "ChessChampionshipPodiumAward" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "awardType" TEXT NOT NULL,
    "periodType" TEXT NOT NULL,
    "periodKey" TEXT NOT NULL,
    "categoryKey" TEXT NOT NULL,
    "timeControlId" TEXT NOT NULL,
    "difficulty" TEXT NOT NULL,
    "place" INTEGER NOT NULL,
    "wins" INTEGER NOT NULL,
    "playerId" TEXT,
    "playerPublicId" TEXT,
    "nickname" TEXT,
    "countryCode" TEXT NOT NULL,
    "countryName" TEXT NOT NULL,
    "countryFlag" TEXT NOT NULL,
    "finalizedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ChessChampionshipPodiumAward_playerId_fkey" FOREIGN KEY ("playerId") REFERENCES "ChessPlayer" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ChessChampionshipPodiumFinalization" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "periodType" TEXT NOT NULL,
    "periodKey" TEXT NOT NULL,
    "categoryKey" TEXT NOT NULL,
    "finalizedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE UNIQUE INDEX "ChessChampionshipPodiumAward_awardType_periodType_periodKey_categoryKey_place_key" ON "ChessChampionshipPodiumAward"("awardType", "periodType", "periodKey", "categoryKey", "place");

-- CreateIndex
CREATE INDEX "ChessChampionshipPodiumAward_playerId_awardType_periodType_periodKey_idx" ON "ChessChampionshipPodiumAward"("playerId", "awardType", "periodType", "periodKey");

-- CreateIndex
CREATE INDEX "ChessChampionshipPodiumAward_countryCode_awardType_periodType_periodKey_idx" ON "ChessChampionshipPodiumAward"("countryCode", "awardType", "periodType", "periodKey");

-- CreateIndex
CREATE INDEX "ChessChampionshipPodiumAward_periodType_periodKey_categoryKey_awardType_idx" ON "ChessChampionshipPodiumAward"("periodType", "periodKey", "categoryKey", "awardType");

-- CreateIndex
CREATE UNIQUE INDEX "ChessChampionshipPodiumFinalization_periodType_periodKey_categoryKey_key" ON "ChessChampionshipPodiumFinalization"("periodType", "periodKey", "categoryKey");

-- CreateIndex
CREATE INDEX "ChessChampionshipPodiumFinalization_periodType_periodKey_idx" ON "ChessChampionshipPodiumFinalization"("periodType", "periodKey");
