// file: src/i18n/request.ts
import {getRequestConfig} from 'next-intl/server';
import {hasLocale} from 'next-intl';
import {routing} from './routing';

export default getRequestConfig(async ({requestLocale}) => {
  const requested = await requestLocale;
  const locale = hasLocale(routing.locales, requested)
    ? requested
    : routing.defaultLocale;

  return {
    locale,
    // ИСПРАВЛЕНИЕ: Правильный относительный путь к папке messages
    messages: (await import(`../messages/${locale}.json`)).default
  };
});