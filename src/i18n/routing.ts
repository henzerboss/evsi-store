// file: src/i18n/routing.ts
import {defineRouting} from 'next-intl/routing';

export const routing = defineRouting({
  // Список всех поддерживаемых локалей
  locales: ['en', 'es', 'ru'],

  // Локаль по умолчанию
  defaultLocale: 'en'
});