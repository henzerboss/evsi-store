-- CreateTable
CREATE TABLE "Application" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "slug" TEXT NOT NULL,
    "iconUrl" TEXT NOT NULL,
    "title_en" TEXT NOT NULL,
    "description_en" TEXT NOT NULL,
    "title_es" TEXT NOT NULL,
    "description_es" TEXT NOT NULL,
    "title_ru" TEXT NOT NULL,
    "description_ru" TEXT NOT NULL,
    "appStoreUrl" TEXT,
    "googlePlayUrl" TEXT,
    "githubUrl" TEXT,
    "privacyPolicy_en" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "Application_slug_key" ON "Application"("slug");
