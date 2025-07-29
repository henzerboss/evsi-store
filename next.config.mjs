// file: next.config.mjs
import createNextIntlPlugin from 'next-intl/plugin';
 
// Плагин сам найдет файл конфигурации по пути src/i18n/request.ts
const withNextIntl = createNextIntlPlugin();
 
/** @type {import('next').NextConfig} */
const nextConfig = {};
 
export default withNextIntl(nextConfig);