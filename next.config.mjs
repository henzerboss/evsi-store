// file: next.config.mjs
import 'dotenv/config';
import createNextIntlPlugin from 'next-intl/plugin';

const withNextIntl = createNextIntlPlugin(
  './src/i18n.ts'
);

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