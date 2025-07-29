// file: src/app/[locale]/privacy/page.tsx
import { getTranslations } from "next-intl/server";

export default async function PrivacyPage() {
  const t = await getTranslations("PrivacyPage");
  return (
    <div className="container max-w-3xl mx-auto py-12 md:py-20 px-4 sm:px-6 lg:px-8">
      <div className="prose dark:prose-invert max-w-none">
        <h1>{t('title')}</h1>
        <p className="text-sm text-muted-foreground">{t('last_updated')}</p>
        <p>{t('p1')}</p>
        
        <h2>{t('h_info')}</h2>
        <p>{t('p_info')}</p>

        <h2>{t('h_cookies')}</h2>
        <p>{t('p_cookies')}</p>

        <h2>{t('h_analytics')}</h2>
        <p>{t('p_analytics')}</p>

        <h2>{t('h_links')}</h2>
        <p>{t('p_links')}</p>

        <h2>{t('h_changes')}</h2>
        <p>{t('p_changes')}</p>

        <h2>{t('h_contact')}</h2>
        <p>{t('p_contact')}</p>
      </div>
    </div>
  );
}