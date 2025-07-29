-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Application" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "slug" TEXT NOT NULL,
    "iconUrl" TEXT NOT NULL,
    "title_en" TEXT,
    "description_en" TEXT,
    "title_es" TEXT,
    "description_es" TEXT,
    "title_ru" TEXT,
    "description_ru" TEXT,
    "appStoreUrl" TEXT,
    "googlePlayUrl" TEXT,
    "githubUrl" TEXT,
    "privacyPolicy_en" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_Application" ("appStoreUrl", "createdAt", "description_en", "description_es", "description_ru", "githubUrl", "googlePlayUrl", "iconUrl", "id", "privacyPolicy_en", "slug", "title_en", "title_es", "title_ru", "updatedAt") SELECT "appStoreUrl", "createdAt", "description_en", "description_es", "description_ru", "githubUrl", "googlePlayUrl", "iconUrl", "id", "privacyPolicy_en", "slug", "title_en", "title_es", "title_ru", "updatedAt" FROM "Application";
DROP TABLE "Application";
ALTER TABLE "new_Application" RENAME TO "Application";
CREATE UNIQUE INDEX "Application_slug_key" ON "Application"("slug");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
