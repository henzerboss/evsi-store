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
};

export default withNextIntl(nextConfig);