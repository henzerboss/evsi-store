// file: src/app/[locale]/app/[...slug]/page.tsx
import prisma from '@/lib/prisma';
import { notFound } from 'next/navigation';
import type { Application } from "@prisma/client";
import { AppPageClient } from '@/components/app-page-client';

function getLocalizedValue(app: Application, fieldPrefix: 'title' | 'shortDescription' | 'description', locale: string): string | null {
  const localesInOrder = [locale, 'en', 'es', 'ru'];
  const uniqueLocales = [...new Set(localesInOrder)];
  for (const loc of uniqueLocales) {
    const key = `${fieldPrefix}_${loc}` as keyof Application;
    const value = app[key];
    if (typeof value === 'string' && value) { return value; }
  }
  return null;
}

export async function generateMetadata({ params }: { params: Promise<{ locale: string, slug: string[] }> }) {
    const { locale, slug } = await params;
    const appSlug = slug[0];
    const app = await prisma.application.findUnique({ where: { slug: appSlug } });

    if (!app) {
        return { title: 'Application Not Found' };
    }

    const title = getLocalizedValue(app, 'title', locale) || app.slug;
    const description = getLocalizedValue(app, 'shortDescription', locale) || '';

    return {
        title: `${title} | evsi.store`,
        description: description,
    };
}

export default async function AppPage({ params }: { params: Promise<{ locale: string, slug: string[] }> }) {
    const { locale, slug } = await params;
    const appSlug = slug[0];
    const isPrivacyOpen = slug.length > 1 && slug[1] === 'privacy';

    const app = await prisma.application.findUnique({ where: { slug: appSlug } });

    if (!app) {
        notFound();
    }

    const localizedData = {
        title: getLocalizedValue(app, 'title', locale) || app.slug,
        description: getLocalizedValue(app, 'description', locale) || 'No description available.',
    };

    return (
        <AppPageClient
            app={app}
            localizedData={localizedData}
            isPrivacyInitiallyOpen={isPrivacyOpen}
        />
    );
}
