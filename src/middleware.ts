// file: src/middleware.ts
import createMiddleware from 'next-intl/middleware';
import {routing} from './i18n/routing';

export default createMiddleware(routing);

export const config = {
  // Исключаем все пути, которые не должны обрабатываться
  matcher: ['/((?!api|_next/static|_next/image|uploads|icon.svg|favicon.ico).*)']
};