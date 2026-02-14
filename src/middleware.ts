import createMiddleware from 'next-intl/middleware';
import {routing} from './i18n/routing';

export default createMiddleware(routing);

export const config = {
  // Исключаем все пути, которые не должны обрабатываться:
  // api, _next, uploads, статические файлы и теперь tg-app
  matcher: [
    '/((?!api|_next/static|_next/image|uploads|icon.svg|favicon.ico|robots.txt|sitemap.xml|rates.json|tg-app|admin|tg-admin).*)'
  ]
};