// file: src/app/[locale]/app/[slug]/privacy/page.tsx
import prisma from '@/lib/prisma';
import { notFound } from 'next/navigation';

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

export default async function AppPrivacyPage({ params }: { params: Promise<{ locale: string, slug: string }> }) {
  const { locale, slug } = await params;
  const app = await prisma.application.findUnique({ where: { slug } });

  if (!app) {
    notFound();
  }

  const title = getLocalizedValue(app, 'title', locale) || app.slug;

  return (
    <div className="container max-w-3xl mx-auto px-4 py-12 sm:px-6 lg:px-8">
      <h1 className="text-3xl font-bold tracking-tight">Privacy Policy for {title}</h1>
      <div className="mt-8 prose dark:prose-invert max-w-none">
        <p style={{ whiteSpace: 'pre-wrap' }}>
          {app.privacyPolicy_en || 'No privacy policy provided.'}
        </p>
      </div>
    </div>
  );
}
