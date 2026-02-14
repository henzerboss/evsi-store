// file: src/lib/telegram.ts

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN!;

if (!TELEGRAM_BOT_TOKEN) {
  throw new Error("TELEGRAM_BOT_TOKEN is not defined");
}

type TelegramMethod = 'sendMessage' | 'createInvoiceLink' | 'answerPreCheckoutQuery' | 'refundStarPayment';

interface TelegramResponse<T> {
  ok: boolean;
  result: T;
  description?: string;
}

// Интерфейс для полей формы (вакансии или резюме)
export interface JobPayload {
  title: string;
  description: string;
  contacts: string;
  salary: string;
  company?: string;
  location?: string;
  experience?: string;
  skills?: string;
  [key: string]: string | undefined; // Индексная сигнатура для безопасности
}

// Тип для параметров запроса (вместо any)
type TelegramRequestParams = Record<string, string | number | boolean | object | undefined>;

/**
 * Базовая функция запроса к Telegram Bot API
 */
export async function telegramRequest<T = unknown>(method: TelegramMethod, params: TelegramRequestParams): Promise<TelegramResponse<T>> {
  const response = await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
    cache: 'no-store',
  });
  return response.json();
}

/**
 * Формирование красивого текста объявления
 */
export function formatOrderText(type: 'VACANCY' | 'RESUME', payload: JobPayload | string): string {
  // Если payload пришел как JSON-строка из БД, парсим её. Если объект - используем как есть.
  const data: JobPayload = typeof payload === 'string' ? JSON.parse(payload) : payload;
  
  if (type === 'VACANCY') {
    return `
<b>💼 ВАКАНСИЯ: ${sanitize(data.title)}</b>

<b>Компания:</b> ${sanitize(data.company)}
<b>Зарплата:</b> ${sanitize(data.salary || 'Не указана')}
<b>Локация/Format:</b> ${sanitize(data.location)}

${sanitize(data.description)}

<b>Контакты:</b> ${sanitize(data.contacts)}

#вакансия
    `.trim();
  } else {
    return `
<b>👤 РЕЗЮМЕ: ${sanitize(data.title)}</b>

<b>Опыт:</b> ${sanitize(data.experience)}
<b>Зарплата:</b> ${sanitize(data.salary || 'По договоренности')}
<b>Навыки:</b> ${sanitize(data.skills)}

${sanitize(data.description)}

<b>Контакты:</b> ${sanitize(data.contacts)}

#резюме
    `.trim();
  }
}

// Простая защита от HTML инъекций для parse_mode: HTML
function sanitize(str: string | undefined) {
  if (!str) return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}