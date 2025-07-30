// file: src/app/sitemap.ts
import { MetadataRoute } from 'next';
import prisma from '@/lib/prisma';
import { routing } from '@/i18n/routing';
import dotenv from 'dotenv';
import path from 'path';

// КЛЮЧЕВОЕ ИСПРАВЛЕНИЕ:
// Принудительно загружаем переменные из .env файла.
// Это гарантирует, что Prisma сможет подключиться к базе данных во время сборки.
dotenv.config({ path: path.resolve(process.cwd(), '.env') });

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const siteUrl = 'https://evsi.store';
  const { locales } = routing;

  try {
    const applications = await prisma.application.findMany({
      select: {
        slug: true,
        updatedAt: true,
      },
    });

    const appUrls = applications.flatMap((app) =>
      locales.map((locale) => ({
        url: `${siteUrl}/${locale}/app/${app.slug}`,
        lastModified: app.updatedAt,
      }))
    );

    const staticPages = ['/', '/about', '/privacy'];
    const staticUrls = staticPages.flatMap((path) =>
      locales.map((locale) => ({
        url: `${siteUrl}/${locale}${path === '/' ? '' : path}`,
        lastModified: new Date(),
      }))
    );

    return [...staticUrls, ...appUrls];
  } catch (error) {
    console.error('Failed to generate sitemap:', error);
    return [
      {
        url: siteUrl,
        lastModified: new Date(),
      },
    ];
  }
}