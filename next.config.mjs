// file: next.config.mjs

import 'dotenv/config'; // <-- ДОБАВЬТЕ ЭТУ СТРОКУ

import createNextIntlPlugin from 'next-intl/plugin';
 
// Плагин сам найдет файл конфигурации по пути src/i18n/request.ts
const withNextIntl = createNextIntlPlugin();
 
/** @type {import('next').NextConfig} */
const nextConfig = {
  // КЛЮЧЕВОЕ ИСПРАВЛЕНИЕ:
  // Добавляем наш домен в список разрешенных для оптимизации изображений.
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'evsi.store',
        port: '',
        pathname: '/uploads/**',
      },
    ],
  },
  async redirects() {
    return [
      {
        source: '/en/app/subscrab/privacy',
        destination: '/en/app/octosubs/privacy',
        permanent: true,
      },
    ];
  },
};

export default withNextIntl(nextConfig);