-- CreateTable
CREATE TABLE "TgSettings" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT DEFAULT 1,
    "vacancyBasePriceStars" INTEGER NOT NULL DEFAULT 0,
    "resumeBasePriceStars" INTEGER NOT NULL DEFAULT 0,
    "channelDiscountPercent" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "TgChannel" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "priceStars" INTEGER NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "TgOrder" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "telegramUserId" TEXT NOT NULL,
    "telegramUsername" TEXT,
    "type" TEXT NOT NULL DEFAULT 'VACANCY',
    "payload" TEXT NOT NULL DEFAULT '{}',
    "totalAmount" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "telegramPaymentChargeId" TEXT,
    "paymentId" TEXT,
    "itemTitle" TEXT,
    "customerContact" TEXT,
    "publishedLinks" TEXT,
    "moderatedAt" DATETIME,
    "refundedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "TgOrderChannel" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "orderId" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    CONSTRAINT "TgOrderChannel_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "TgOrder" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "TgOrderChannel_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "TgChannel" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "RandomCoffeeProfile" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "telegramUserId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "specialty" TEXT NOT NULL,
    "interests" TEXT NOT NULL,
    "linkedin" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "RandomCoffeeParticipation" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "profileId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PAID',
    "matchDate" DATETIME NOT NULL,
    "telegramPaymentChargeId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "matchWithId" TEXT,
    CONSTRAINT "RandomCoffeeParticipation_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "RandomCoffeeProfile" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "RandomCoffeeHistory" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userAId" TEXT NOT NULL,
    "userBId" TEXT NOT NULL,
    "date" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "TgUserProfile" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "telegramUserId" TEXT NOT NULL,
    "resumeOriginal" TEXT,
    "resumeCorrected" TEXT,
    "updatedAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "TgChannel_username_key" ON "TgChannel"("username");

-- CreateIndex
CREATE UNIQUE INDEX "TgOrderChannel_orderId_channelId_key" ON "TgOrderChannel"("orderId", "channelId");

-- CreateIndex
CREATE UNIQUE INDEX "RandomCoffeeProfile_telegramUserId_key" ON "RandomCoffeeProfile"("telegramUserId");

-- CreateIndex
CREATE UNIQUE INDEX "RandomCoffeeHistory_userAId_userBId_key" ON "RandomCoffeeHistory"("userAId", "userBId");

-- CreateIndex
CREATE UNIQUE INDEX "TgUserProfile_telegramUserId_key" ON "TgUserProfile"("telegramUserId");
