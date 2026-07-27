import crypto from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { appendRevenueCatSummaryEvent } from '@/lib/revenuecatDailySummary';

export const runtime = 'nodejs';

type RevenueCatWebhookBody = {
  api_version?: string;
  event?: RevenueCatEvent;
};

type RevenueCatEvent = {
  [key: string]: unknown;

  id?: string;
  type?: string;
  app_id?: string | null;
  app_user_id?: string | null;
  original_app_user_id?: string | null;
  aliases?: string[];

  product_id?: string | null;
  new_product_id?: string | null;
  store?: string | null;
  environment?: string | null;
  country_code?: string | null;
  currency?: string | null;

  price?: number | null; // USD
  price_in_purchased_currency?: number | null;

  period_type?: string | null;
  renewal_number?: number | null;
  is_trial_conversion?: boolean | null;

  purchased_at_ms?: number | null;
  expiration_at_ms?: number | null;
  event_timestamp_ms?: number | null;
  grace_period_expiration_at_ms?: number | null;
  auto_resume_at_ms?: number | null;

  cancel_reason?: string | null;
  expiration_reason?: string | null;

  entitlement_id?: string | null;
  entitlement_ids?: string[] | null;
  presented_offering_id?: string | null;
  offer_code?: string | null;

  transaction_id?: string | null;
  original_transaction_id?: string | null;

  transferred_from?: string[] | null;
  transferred_to?: string[] | null;

  paywall_id?: string | null;
  paywall_name?: string | null;
  offering_id?: string | null;
  session_id?: string | null;
  platform?: string | null;
  locale?: string | null;
  display_mode?: string | null;
  component_type?: string | null;
  component_value?: string | null;
  component_name?: string | null;
  current_product_id?: string | null;
  resulting_product_id?: string | null;
  destination_product_id?: string | null;

  experiment_id?: string | null;
  experiment_variant?: string | null;

  redemption_outcome?: string | null;
  redemption_platform?: string | null;
  redeemed_from?: string[] | null;
  redeemed_by?: string[] | null;
};

const PROJECTS_BY_KEY: Record<string, { name: string; emoji: string }> = {
  caloriecounterai: { name: 'Calorie Counter Photo AI', emoji: '🥗' },
  dishkin: { name: 'Dishkin AI', emoji: '🍳' },
  evsvpn: { name: 'evsVPN', emoji: '🛡️' },
  evpdf: { name: 'evPDF', emoji: '📄' },

  quitsmoke: { name: 'QuitNic AI: Quit Smoking', emoji: '🚭' },
  quitvape: { name: 'QuitNic AI: Quit Vaping', emoji: '💨' },

  chesspro: { name: 'Chess Pro', emoji: '♟️' },
};

// Опционально: сюда можно добавить RevenueCat app_id,
// если захочешь определять проект даже без ?project=...
const PROJECTS_BY_REVENUECAT_APP_ID: Record<string, { name: string; emoji: string }> = {
  // 'appxxxxxxxxxxxx': { name: 'Calorie Counter Photo AI', emoji: '🥗' },
  // 'appxxxxxxxxxxxx': { name: 'evsVPN', emoji: '🛡️' },
};

const STORE_LABELS: Record<string, string> = {
  APP_STORE: '🍏 App Store',
  MAC_APP_STORE: '🍏 Mac App Store',
  PLAY_STORE: '🤖 Google Play',
  AMAZON: '📦 Amazon',
  STRIPE: '💳 Stripe',
  RC_BILLING: '💳 RevenueCat Billing',
  PADDLE: '💳 Paddle',
  ROKU: '📺 Roku',
  PROMOTIONAL: '🎁 Promotional',
  TEST_STORE: '🧪 Test Store',
};

const EVENT_TITLES: Record<string, string> = {
  TEST: '🧪 Тестовый webhook',

  INITIAL_PURCHASE: '💰 НОВАЯ ПРОДАЖА!',
  RENEWAL: '🔄 Продление подписки',
  CANCELLATION: '❌ Отмена / возврат',
  UNCANCELLATION: '✅ Возобновление подписки',
  EXPIRATION: '⌛ Подписка истекла',
  BILLING_ISSUE: '⚠️ Проблема с оплатой',
  PRODUCT_CHANGE: '🔁 Смена продукта',
  NON_RENEWING_PURCHASE: '💳 Разовая покупка',
  SUBSCRIPTION_PAUSED: '⏸️ Подписка будет на паузе',
  SUBSCRIPTION_EXTENDED: '➕ Подписка продлена',
  REFUND_REVERSED: '↩️ Возврат отменён',
  INVOICE_ISSUANCE: '🧾 Выпущен invoice',

  TRANSFER: '🔀 Transfer подписки',
  TEMPORARY_ENTITLEMENT_GRANT: '⏳ Временный доступ',
  PURCHASE_REDEEMED: '🎟️ Web-покупка привязана',
  VIRTUAL_CURRENCY_TRANSACTION: '🪙 Virtual currency transaction',
  EXPERIMENT_ENROLLMENT: '🧪 Пользователь попал в эксперимент',

  PAYWALL_IMPRESSION: '👀 Paywall показан',
  PAYWALL_CLOSE: '🚪 Paywall закрыт',
  PAYWALL_CANCEL: '🛑 Покупка на paywall отменена',
  PAYWALL_EXIT_OFFER: '🎁 Exit offer показан',
  PAYWALL_COMPONENT_INTERACTED: '👆 Клик/выбор на paywall',

  PRICE_INCREASE_CONSENT_REQUIRED: '📈 Требуется согласие на повышение цены',
  PRICE_INCREASE_CONSENT_APPROVED: '✅ Повышение цены принято',
};

function normalizeProjectKey(value: string | null): string | null {
  if (!value) return null;

  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, '');

  return normalized || null;
}

function escapeHtml(value: unknown): string {
  return String(value ?? '—')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function code(value: unknown): string {
  return `<code>${escapeHtml(value ?? '—')}</code>`;
}

function countryCodeToFlag(countryCode?: string | null): string {
  const codeValue = countryCode?.trim().toUpperCase();

  if (!codeValue || !/^[A-Z]{2}$/.test(codeValue)) {
    return '🏳️';
  }

  return Array.from(codeValue)
    .map((char) => String.fromCodePoint(127397 + char.charCodeAt(0)))
    .join('');
}

function countryNameRu(countryCode?: string | null): string {
  const codeValue = countryCode?.trim().toUpperCase();

  if (!codeValue || !/^[A-Z]{2}$/.test(codeValue)) {
    return 'Неизвестно';
  }

  try {
    const displayNames = new Intl.DisplayNames(['ru'], { type: 'region' });
    return displayNames.of(codeValue) || codeValue;
  } catch {
    return codeValue;
  }
}

function formatCountry(countryCode?: string | null): string {
  const codeValue = countryCode?.trim().toUpperCase();

  if (!codeValue) {
    return '🏳️ Неизвестно';
  }

  return `${countryCodeToFlag(codeValue)} ${countryNameRu(codeValue)} (${codeValue})`;
}

function formatMoney(amount?: number | null, currency?: string | null): string | null {
  if (typeof amount !== 'number' || Number.isNaN(amount)) {
    return null;
  }

  const safeCurrency = currency?.trim().toUpperCase();

  if (safeCurrency && /^[A-Z]{3}$/.test(safeCurrency)) {
    try {
      return new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: safeCurrency,
        maximumFractionDigits: 2,
      }).format(amount);
    } catch {
      return `${amount.toFixed(2)} ${safeCurrency}`;
    }
  }

  return amount.toFixed(2);
}

function getPriceText(event: RevenueCatEvent): string | null {
  const localPrice = formatMoney(
    event.price_in_purchased_currency,
    event.currency,
  );

  const usdPrice =
    typeof event.price === 'number' && !Number.isNaN(event.price)
      ? `$${event.price.toFixed(2)}`
      : null;

  if (
    localPrice &&
    usdPrice &&
    event.currency &&
    event.currency.toUpperCase() !== 'USD'
  ) {
    return `${localPrice} / ${usdPrice}`;
  }

  return localPrice || usdPrice;
}

function getProjectInfo(projectKey: string | null, event: RevenueCatEvent) {
  if (projectKey && PROJECTS_BY_KEY[projectKey]) {
    return PROJECTS_BY_KEY[projectKey];
  }

  if (event.app_id && PROJECTS_BY_REVENUECAT_APP_ID[event.app_id]) {
    return PROJECTS_BY_REVENUECAT_APP_ID[event.app_id];
  }

  return {
    name: projectKey || event.app_id || 'Unknown RevenueCat project',
    emoji: '📱',
  };
}

function getStoreLabel(store?: string | null): string | null {
  if (!store) return null;
  return STORE_LABELS[store] || store;
}

function getExpectedAuth(projectKey: string | null): string | undefined {
  // Можно использовать общий секрет:
  // REVENUECAT_WEBHOOK_AUTH=...
  //
  // Или отдельные по проектам:
  // REVENUECAT_WEBHOOK_AUTH_CALORIECOUNTERAI=...
  // REVENUECAT_WEBHOOK_AUTH_DISHKIN=...
  // REVENUECAT_WEBHOOK_AUTH_EVSVPN=...
  // REVENUECAT_WEBHOOK_AUTH_QUITSMOKE=...
  // REVENUECAT_WEBHOOK_AUTH_QUITVAPE=...
  // REVENUECAT_WEBHOOK_AUTH_EVPDF=...

  if (projectKey) {
    const envKey = `REVENUECAT_WEBHOOK_AUTH_${projectKey
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, '_')}`;

    return process.env[envKey] || process.env.REVENUECAT_WEBHOOK_AUTH;
  }

  return process.env.REVENUECAT_WEBHOOK_AUTH;
}

function getHmacSecret(projectKey: string | null): string | undefined {
  // Необязательно. Нужно только если включишь HMAC webhook signing в RevenueCat.
  //
  // Общий:
  // REVENUECAT_WEBHOOK_HMAC_SECRET=...
  //
  // Или отдельные:
  // REVENUECAT_WEBHOOK_HMAC_SECRET_CALORIECOUNTERAI=...
  // REVENUECAT_WEBHOOK_HMAC_SECRET_EVSVPN=...
  // REVENUECAT_WEBHOOK_HMAC_SECRET_QUITSMOKE=...
  // REVENUECAT_WEBHOOK_HMAC_SECRET_QUITVAPE=...
  // REVENUECAT_WEBHOOK_HMAC_SECRET_EVPDF=...

  if (projectKey) {
    const envKey = `REVENUECAT_WEBHOOK_HMAC_SECRET_${projectKey
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, '_')}`;

    return process.env[envKey] || process.env.REVENUECAT_WEBHOOK_HMAC_SECRET;
  }

  return process.env.REVENUECAT_WEBHOOK_HMAC_SECRET;
}

function getTelegramChatId(projectKey: string | null): string | undefined {
  // Можно отправлять разные проекты в разные чаты:
  // TELEGRAM_CHAT_ID_RC_CALORIECOUNTERAI=...
  // TELEGRAM_CHAT_ID_RC_EVSVPN=...
  // TELEGRAM_CHAT_ID_RC_QUITSMOKE=...
  // TELEGRAM_CHAT_ID_RC_QUITVAPE=...
  // TELEGRAM_CHAT_ID_RC_EVPDF=...
  //
  // Или общий чат:
  // TELEGRAM_CHAT_ID_RC=...
  // TELEGRAM_CHAT_ID=...

  if (projectKey) {
    const envKey = `TELEGRAM_CHAT_ID_RC_${projectKey
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, '_')}`;

    return process.env[envKey] || process.env.TELEGRAM_CHAT_ID_RC || process.env.TELEGRAM_CHAT_ID;
  }

  return process.env.TELEGRAM_CHAT_ID_RC || process.env.TELEGRAM_CHAT_ID;
}

function isIgnoredEventType(type: string): boolean {
  // Например:
  // REVENUECAT_WEBHOOK_IGNORE_EVENTS=PAYWALL_IMPRESSION,PAYWALL_CLOSE,RENEWAL

  const ignored = process.env.REVENUECAT_WEBHOOK_IGNORE_EVENTS;

  if (!ignored) {
    return false;
  }

  return ignored
    .split(',')
    .map((item) => item.trim().toUpperCase())
    .filter(Boolean)
    .includes(type.toUpperCase());
}

function shouldSkipSandbox(event: RevenueCatEvent): boolean {
  // По умолчанию sandbox тоже отправляется, чтобы было удобно тестировать.
  // Если хочешь скрыть sandbox из Telegram:
  // REVENUECAT_WEBHOOK_SEND_SANDBOX=false

  const sendSandbox = process.env.REVENUECAT_WEBHOOK_SEND_SANDBOX;

  if (sendSandbox === 'false' && event.environment === 'SANDBOX' && event.type !== 'TEST') {
    return true;
  }

  return false;
}

function verifyRevenueCatHmacSignature(params: {
  rawBody: string;
  signatureHeader: string | null;
  secret: string;
}): boolean {
  const { rawBody, signatureHeader, secret } = params;

  if (!signatureHeader) {
    return false;
  }

  const parts = signatureHeader.split(',').reduce<Record<string, string>>((acc, part) => {
    const [key, value] = part.split('=');
    if (key && value) {
      acc[key.trim()] = value.trim();
    }
    return acc;
  }, {});

  const timestamp = parts.t;
  const receivedSignature = parts.v1;

  if (!timestamp || !receivedSignature) {
    return false;
  }

  const timestampNumber = Number(timestamp);

  if (!Number.isFinite(timestampNumber)) {
    return false;
  }

  // Защита от replay-атак. Можно увеличить, если серверное время иногда плывёт.
  const toleranceSeconds = Number(
    process.env.REVENUECAT_WEBHOOK_HMAC_TOLERANCE_SECONDS || 300,
  );

  const nowSeconds = Math.floor(Date.now() / 1000);

  if (Math.abs(nowSeconds - timestampNumber) > toleranceSeconds) {
    return false;
  }

  const signedPayload = `${timestamp}.${rawBody}`;
  const expectedSignature = crypto
    .createHmac('sha256', secret)
    .update(signedPayload, 'utf8')
    .digest('hex');

  try {
    const receivedBuffer = Buffer.from(receivedSignature, 'hex');
    const expectedBuffer = Buffer.from(expectedSignature, 'hex');

    if (receivedBuffer.length !== expectedBuffer.length) {
      return false;
    }

    return crypto.timingSafeEqual(receivedBuffer, expectedBuffer);
  } catch {
    return false;
  }
}

function isTrialEvent(event: RevenueCatEvent): boolean {
  return event.period_type?.trim().toUpperCase() === 'TRIAL';
}

function shouldSuppressIndividualNotification(event: RevenueCatEvent): boolean {
  const type = event.type?.trim().toUpperCase();

  // Триалы учитываются в суточной сводке, но отдельное сообщение не отправляется.
  if (isTrialEvent(event)) return true;

  // Проблемы с оплатой также остаются только в суточной сводке.
  if (type === 'BILLING_ISSUE') return true;

  return false;
}

function buildTelegramMessage(event: RevenueCatEvent, projectKey: string | null): string {
  const type = event.type?.trim().toUpperCase() || 'UNKNOWN';
  const project = getProjectInfo(projectKey, event);
  const title = EVENT_TITLES[type] || `ℹ️ Событие: ${type}`;
  const priceText = getPriceText(event) || '—';
  const storeLabel = getStoreLabel(event.store) || '—';
  const productText = event.new_product_id
    ? `${event.product_id || '—'} → ${event.new_product_id}`
    : event.product_id || '—';
  const trialConversion =
    typeof event.is_trial_conversion === 'boolean'
      ? event.is_trial_conversion
        ? 'да'
        : 'нет'
      : '—';

  return [
    `<b>${escapeHtml(title)}</b>`,
    '',
    `📱 <b>Проект:</b> ${escapeHtml(`${project.emoji} ${project.name}`)}`,
    '',
    `🌍 <b>Страна:</b> ${escapeHtml(formatCountry(event.country_code))}`,
    `💵 <b>Сумма:</b> ${escapeHtml(priceText)}`,
    `📦 <b>Товар:</b> ${code(productText)}`,
    `🏪 <b>Магазин:</b> ${escapeHtml(storeLabel)}`,
    `📆 <b>Период:</b> ${code(event.period_type || '—')}`,
    `🔢 <b>Renewal #:</b> ${code(
      typeof event.renewal_number === 'number' ? event.renewal_number : '—',
    )}`,
    `🎯 <b>Trial conversion:</b> ${trialConversion}`,
    '',
    '',
    `👤 <b>User:</b> ${code(event.app_user_id || '—')}`,
  ].join('\n');
}

async function sendTelegramMessage(params: {
  projectKey: string | null;
  message: string;
}) {
  const botToken = process.env.TELEGRAM_BOT_TOKEN_RC || process.env.TELEGRAM_BOT_TOKEN;
  const chatId = getTelegramChatId(params.projectKey);

  if (!botToken) {
    throw new Error('TELEGRAM_BOT_TOKEN_RC is not configured');
  }

  if (!chatId) {
    throw new Error('TELEGRAM_CHAT_ID_RC or TELEGRAM_CHAT_ID is not configured');
  }

  const response = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      text: params.message,
      parse_mode: 'HTML',
      disable_web_page_preview: true,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Telegram sendMessage failed: ${errorText}`);
  }
}

export async function POST(request: NextRequest) {
  const projectKey = normalizeProjectKey(request.nextUrl.searchParams.get('project'));

  try {
    const authHeader = request.headers.get('authorization');
    const expectedAuth = getExpectedAuth(projectKey);

    if (!expectedAuth) {
      console.error('RevenueCat webhook auth env is not configured');

      return NextResponse.json(
        { error: 'RevenueCat webhook auth is not configured' },
        { status: 500 },
      );
    }

    // В RevenueCat Authorization header value должен полностью совпадать с env.
    // Если в RevenueCat указано "Bearer xxx", то и в env должно быть "Bearer xxx".
    if (authHeader !== expectedAuth) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const rawBody = await request.text();

    const hmacSecret = getHmacSecret(projectKey);

    // Если env для HMAC задан, требуем валидную подпись.
    // Если env не задан, работаем только по Authorization header.
    if (hmacSecret) {
      const signatureHeader = request.headers.get('x-revenuecat-webhook-signature');

      const isValidSignature = verifyRevenueCatHmacSignature({
        rawBody,
        signatureHeader,
        secret: hmacSecret,
      });

      if (!isValidSignature) {
        return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
      }
    }

    let body: RevenueCatWebhookBody;

    try {
      body = JSON.parse(rawBody) as RevenueCatWebhookBody;
    } catch {
      return NextResponse.json(
        { error: 'Invalid JSON payload' },
        { status: 400 },
      );
    }

    const event = body.event;

    if (!event?.type) {
      return NextResponse.json(
        { error: 'Invalid RevenueCat payload' },
        { status: 400 },
      );
    }

    const type = event.type.toUpperCase();

    if (shouldSkipSandbox(event)) {
      return NextResponse.json({ ok: true, skipped: 'sandbox', type });
    }

    const project = getProjectInfo(projectKey, event);

    // Записываем все реальные операции для суточной сводки до фильтрации
    // индивидуальных Telegram-уведомлений. TEST и sandbox (по умолчанию)
    // библиотека сводки отфильтрует самостоятельно.
    await appendRevenueCatSummaryEvent({
      event,
      projectKey,
      projectName: `${project.emoji} ${project.name}`,
    });

    if (shouldSuppressIndividualNotification(event)) {
      return NextResponse.json({ ok: true, ignored: true, reason: 'individual_notification_suppressed', type });
    }

    if (isIgnoredEventType(type)) {
      return NextResponse.json({ ok: true, ignored: true, type });
    }

    const message = buildTelegramMessage(event, projectKey);

    await sendTelegramMessage({
      projectKey,
      message,
    });

    return NextResponse.json({ ok: true, type });
  } catch (error) {
    console.error('RevenueCat Webhook Error:', error);

    // 500 нужен, чтобы RevenueCat попробовал повторить доставку.
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 },
    );
  }
}

export async function GET() {
  return NextResponse.json({
    ok: true,
    endpoint: 'RevenueCat webhook',
  });
}
