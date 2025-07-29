// file: src/app/[locale]/page.tsx
import { getTranslations } from "next-intl/server";
import prisma from "@/lib/prisma";
import { ApplicationCard } from "@/components/application-card";

function getLocalizedValue(app: any, fieldPrefix: string, locale: string) {
  const localesInOrder = [locale, 'en', 'es', 'ru'];
  const uniqueLocales = [...new Set(localesInOrder)];

  for (const loc of uniqueLocales) {
    const value = app[`${fieldPrefix}_${loc}`];
    if (value) {
      return value;
    }
  }
  return null;
}

// КЛЮЧЕВОЕ ИСПРАВЛЕНИЕ: Обновляем сигнатуру функции для правильной работы с асинхронными params
export default async function Home({ params }: { params: Promise<{ locale: string }> }) {
  // Сначала ожидаем (await) params, и только потом извлекаем locale
  const { locale } = await params; 
  const t = await getTranslations("HomePage");
  const applications = await prisma.application.findMany({
    orderBy: { createdAt: 'desc' },
  });

  return (
    <div className="mx-auto max-w-7xl px-4 py-12 sm:px-6 lg:px-8">
      <div className="text-center mb-12">
        <h1 className="text-4xl font-bold tracking-tight sm:text-5xl">
          {t("title")}
        </h1>
        <p className="mt-4 max-w-2xl mx-auto text-lg text-muted-foreground">
          {t("subtitle")}
        </p>
      </div>

      {applications.length > 0 ? (
        <div className="grid grid-cols-1 gap-x-8 gap-y-12 md:grid-cols-2 lg:grid-cols-3">
          {applications.map((app) => {
            const title = getLocalizedValue(app, 'title', locale) || app.slug;
            const shortDescription = getLocalizedValue(app, 'shortDescription', locale) || '';
            return (
              <ApplicationCard
                key={app.id}
                slug={app.slug}
                iconUrl={app.iconUrl}
                title={title}
                shortDescription={shortDescription}
                appStoreUrl={app.appStoreUrl}
                googlePlayUrl={app.googlePlayUrl}
              />
            );
          })}
        </div>
      ) : (
        <p className="text-center text-muted-foreground">Приложений для отображения пока нет.</p>
      )}
    </div>
  );
}