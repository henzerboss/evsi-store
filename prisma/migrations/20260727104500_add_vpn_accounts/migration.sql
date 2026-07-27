-- CreateTable
CREATE TABLE "VpnAccount" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "activationKey" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "appUserId" TEXT,
    "promoCode" TEXT,
    "entitlement" TEXT NOT NULL DEFAULT 'premium',
    "maxDevices" INTEGER NOT NULL DEFAULT 10,
    "expiresAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "VpnDevice" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "accountId" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "name" TEXT,
    "platform" TEXT,
    "lastSeenAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "VpnDevice_accountId_fkey"
      FOREIGN KEY ("accountId") REFERENCES "VpnAccount" ("id")
      ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "VpnAccount_activationKey_key" ON "VpnAccount"("activationKey");

-- CreateIndex
CREATE UNIQUE INDEX "VpnAccount_appUserId_key" ON "VpnAccount"("appUserId");

-- CreateIndex
CREATE INDEX "VpnAccount_appUserId_idx" ON "VpnAccount"("appUserId");

-- CreateIndex
CREATE UNIQUE INDEX "VpnDevice_accountId_deviceId_key" ON "VpnDevice"("accountId", "deviceId");

-- CreateIndex
CREATE INDEX "VpnDevice_deviceId_idx" ON "VpnDevice"("deviceId");
