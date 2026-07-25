import { appendFile, mkdir, readFile, readdir, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';

const MADRID_TIME_ZONE = 'Europe/Madrid';
const DEFAULT_RETENTION_DAYS = 60;

type RevenueCatSummaryEvent = {
  [key: string]: unknown;
  id?: string;
  type?: string;
  app_id?: string | null;
  app_user_id?: string | null;
  product_id?: string | null;
  new_product_id?: string | null;
  store?: string | null;
  environment?: string | null;
  country_code?: string | null;
  currency?: string | null;
  price?: number | null;
  price_in_purchased_currency?: number | null;
  period_type?: string | null;
  renewal_number?: number | null;
  is_trial_conversion?: boolean | null;
  event_timestamp_ms?: number | null;
};

export type RevenueCatSummaryRecord = {
  recordedAt: string;
  projectKey: string | null;
  projectName: string;
  event: RevenueCatSummaryEvent;
};

const SUMMARY_EVENT_TYPES = new Set([
  'INITIAL_PURCHASE',
  'RENEWAL',
  'CANCELLATION',
  'UNCANCELLATION',
  'EXPIRATION',
  'BILLING_ISSUE',
  'PRODUCT_CHANGE',
  'NON_RENEWING_PURCHASE',
  'SUBSCRIPTION_PAUSED',
  'SUBSCRIPTION_EXTENDED',
  'REFUND_REVERSED',
  'INVOICE_ISSUANCE',
  'TRANSFER',
  'TEMPORARY_ENTITLEMENT_GRANT',
  'PURCHASE_REDEEMED',
  'PRICE_INCREASE_CONSENT_REQUIRED',
  'PRICE_INCREASE_CONSENT_APPROVED',
]);

const EVENT_LABELS: Record<string, string> = {
  INITIAL_PURCHASE: '💰 Новые покупки',
  RENEWAL: '🔄 Продления',
  CANCELLATION: '❌ Отмены / возвраты',
  UNCANCELLATION: '✅ Возобновления',
  EXPIRATION: '⌛ Истечения',
  BILLING_ISSUE: '⚠️ Проблемы с оплатой',
  PRODUCT_CHANGE: '🔁 Смены продукта',
  NON_RENEWING_PURCHASE: '💳 Разовые покупки',
  SUBSCRIPTION_PAUSED: '⏸️ Паузы',
  SUBSCRIPTION_EXTENDED: '➕ Продления срока',
  REFUND_REVERSED: '↩️ Отмены возврата',
  INVOICE_ISSUANCE: '🧾 Выпущенные счета',
  TRANSFER: '🔀 Переносы подписки',
  TEMPORARY_ENTITLEMENT_GRANT: '⏳ Временные доступы',
  PURCHASE_REDEEMED: '🎟️ Привязанные покупки',
  PRICE_INCREASE_CONSENT_REQUIRED: '📈 Запросы согласия на цену',
  PRICE_INCREASE_CONSENT_APPROVED: '✅ Согласия на новую цену',
};

function escapeHtml(value: unknown): string {
  return String(value ?? '—')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function getSummaryDirectory(): string {
  const configured = process.env.REVENUECAT_SUMMARY_DIR?.trim();
  return configured || path.join(process.cwd(), 'data', 'revenuecat-summary');
}

function datePartsInMadrid(date: Date): { year: number; month: number; day: number } {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: MADRID_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);

  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));

  return {
    year: Number(values.year),
    month: Number(values.month),
    day: Number(values.day),
  };
}

export function getMadridDateKey(date = new Date()): string {
  const { year, month, day } = datePartsInMadrid(date);
  return `${year.toString().padStart(4, '0')}-${month.toString().padStart(2, '0')}-${day
    .toString()
    .padStart(2, '0')}`;
}

export function getPreviousMadridDateKey(date = new Date()): string {
  const { year, month, day } = datePartsInMadrid(date);
  const previousUtc = new Date(Date.UTC(year, month - 1, day) - 86_400_000);
  return previousUtc.toISOString().slice(0, 10);
}

function getEventDateKey(event: RevenueCatSummaryEvent): string {
  const timestamp =
    typeof event.event_timestamp_ms === 'number' && Number.isFinite(event.event_timestamp_ms)
      ? event.event_timestamp_ms
      : Date.now();

  return getMadridDateKey(new Date(timestamp));
}

function shouldStoreSandbox(event: RevenueCatSummaryEvent): boolean {
  if (event.environment !== 'SANDBOX') return true;
  return process.env.REVENUECAT_DAILY_SUMMARY_INCLUDE_SANDBOX === 'true';
}

export async function appendRevenueCatSummaryEvent(params: {
  event: RevenueCatSummaryEvent;
  projectKey: string | null;
  projectName: string;
}): Promise<{ stored: boolean; dateKey: string | null }> {
  const type = params.event.type?.toUpperCase();

  if (!type || !SUMMARY_EVENT_TYPES.has(type) || !shouldStoreSandbox(params.event)) {
    return { stored: false, dateKey: null };
  }

  const directory = getSummaryDirectory();
  const dateKey = getEventDateKey(params.event);
  const filePath = path.join(directory, `${dateKey}.jsonl`);

  await mkdir(directory, { recursive: true });

  // Храним только поля, нужные для агрегации. Полный webhook и пользовательские
  // идентификаторы в JSONL не записываются.
  const summaryEvent: RevenueCatSummaryEvent = {
    id: params.event.id,
    type,
    app_id: params.event.app_id,
    product_id: params.event.product_id,
    new_product_id: params.event.new_product_id,
    store: params.event.store,
    environment: params.event.environment,
    country_code: params.event.country_code,
    currency: params.event.currency,
    price: params.event.price,
    price_in_purchased_currency: params.event.price_in_purchased_currency,
    period_type: params.event.period_type,
    renewal_number: params.event.renewal_number,
    is_trial_conversion: params.event.is_trial_conversion,
    event_timestamp_ms: params.event.event_timestamp_ms,
  };

  const record: RevenueCatSummaryRecord = {
    recordedAt: new Date().toISOString(),
    projectKey: params.projectKey,
    projectName: params.projectName,
    event: summaryEvent,
  };

  await appendFile(filePath, `${JSON.stringify(record)}\n`, 'utf8');

  return { stored: true, dateKey };
}

function recordDedupeKey(record: RevenueCatSummaryRecord): string {
  if (record.event.id) return `id:${record.event.id}`;

  return JSON.stringify([
    record.projectKey,
    record.event.type,
    record.event.product_id,
    record.event.event_timestamp_ms,
    record.event.renewal_number,
  ]);
}

export async function readRevenueCatSummaryRecords(
  dateKey: string,
): Promise<RevenueCatSummaryRecord[]> {
  const filePath = path.join(getSummaryDirectory(), `${dateKey}.jsonl`);
  let raw = '';

  try {
    raw = await readFile(filePath, 'utf8');
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') return [];
    throw error;
  }

  const records: RevenueCatSummaryRecord[] = [];
  const seen = new Set<string>();

  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;

    try {
      const parsed = JSON.parse(line) as RevenueCatSummaryRecord;
      const key = recordDedupeKey(parsed);

      if (!seen.has(key)) {
        seen.add(key);
        records.push(parsed);
      }
    } catch (error) {
      console.error('Failed to parse RevenueCat summary line:', error);
    }
  }

  return records;
}

function formatDateRu(dateKey: string): string {
  const [year, month, day] = dateKey.split('-').map(Number);

  return new Intl.DateTimeFormat('ru-RU', {
    timeZone: 'UTC',
    dateStyle: 'long',
  }).format(new Date(Date.UTC(year, month - 1, day, 12)));
}

function isTrialStart(record: RevenueCatSummaryRecord): boolean {
  return (
    record.event.type?.toUpperCase() === 'INITIAL_PURCHASE' &&
    record.event.period_type?.toUpperCase() === 'TRIAL'
  );
}

function isRevenueEvent(record: RevenueCatSummaryRecord): boolean {
  const type = record.event.type?.toUpperCase();

  if (isTrialStart(record)) return false;

  return type === 'INITIAL_PURCHASE' || type === 'RENEWAL' || type === 'NON_RENEWING_PURCHASE';
}

function formatCurrency(amount: number, currency: string): string {
  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(amount);
  } catch {
    return `${amount.toFixed(2)} ${currency}`;
  }
}

function buildRevenueText(records: RevenueCatSummaryRecord[]): string | null {
  const revenueRecords = records.filter(isRevenueEvent);
  if (!revenueRecords.length) return null;

  const localTotals = new Map<string, number>();
  let usdTotal = 0;
  let hasUsd = false;

  for (const record of revenueRecords) {
    const { currency, price_in_purchased_currency: localPrice, price } = record.event;
    const normalizedCurrency = currency?.trim().toUpperCase();

    if (
      normalizedCurrency &&
      /^[A-Z]{3}$/.test(normalizedCurrency) &&
      typeof localPrice === 'number' &&
      Number.isFinite(localPrice)
    ) {
      localTotals.set(normalizedCurrency, (localTotals.get(normalizedCurrency) || 0) + localPrice);
    }

    if (typeof price === 'number' && Number.isFinite(price)) {
      usdTotal += price;
      hasUsd = true;
    }
  }

  const localParts = [...localTotals.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([currency, total]) => formatCurrency(total, currency));

  const onlyUsdLocal = localTotals.size === 1 && localTotals.has('USD');
  const usdPart = hasUsd ? `$${usdTotal.toFixed(2)}` : null;

  if (onlyUsdLocal && usdPart) return usdPart;
  if (localParts.length && usdPart) return `${localParts.join(' + ')} / ${usdPart}`;
  if (localParts.length) return localParts.join(' + ');
  return usdPart;
}

function pluralOperations(count: number): string {
  const mod10 = count % 10;
  const mod100 = count % 100;

  if (mod10 === 1 && mod100 !== 11) return 'операция';
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return 'операции';
  return 'операций';
}

function buildProjectLine(projectName: string, records: RevenueCatSummaryRecord[]): string {
  const trials = records.filter(isTrialStart).length;
  const purchases = records.filter(
    (record) => record.event.type?.toUpperCase() === 'INITIAL_PURCHASE' && !isTrialStart(record),
  ).length;
  const renewals = records.filter((record) => record.event.type?.toUpperCase() === 'RENEWAL').length;
  const cancellations = records.filter(
    (record) => record.event.type?.toUpperCase() === 'CANCELLATION',
  ).length;
  const revenue = buildRevenueText(records);

  const details: string[] = [];
  if (purchases) details.push(`продажи: ${purchases}`);
  if (trials) details.push(`триалы: ${trials}`);
  if (renewals) details.push(`продления: ${renewals}`);
  if (cancellations) details.push(`отмены: ${cancellations}`);
  if (revenue) details.push(`сумма: ${revenue}`);

  return `• <b>${escapeHtml(projectName)}</b> — ${records.length} ${pluralOperations(
    records.length,
  )}${details.length ? ` (${escapeHtml(details.join(', '))})` : ''}`;
}

export function buildRevenueCatDailySummaryMessage(params: {
  dateKey: string;
  records: RevenueCatSummaryRecord[];
}): string {
  const { dateKey, records } = params;
  const trialStarts = records.filter(isTrialStart).length;
  const paidInitialPurchases = records.filter(
    (record) => record.event.type?.toUpperCase() === 'INITIAL_PURCHASE' && !isTrialStart(record),
  ).length;
  const trialConversions = records.filter(
    (record) =>
      record.event.type?.toUpperCase() === 'RENEWAL' && record.event.is_trial_conversion === true,
  ).length;

  const counts = new Map<string, number>();

  for (const record of records) {
    const type = record.event.type?.toUpperCase() || 'UNKNOWN';
    counts.set(type, (counts.get(type) || 0) + 1);
  }

  const lines: string[] = [
    `<b>📊 СВОДКА REVENUECAT ЗА ${escapeHtml(formatDateRu(dateKey).toUpperCase())}</b>`,
    '',
    `Всего: <b>${records.length}</b> ${pluralOperations(records.length)}`,
  ];

  const revenue = buildRevenueText(records);
  if (revenue) lines.push(`💵 <b>Сумма:</b> ${escapeHtml(revenue)}`);

  lines.push('');
  lines.push(`💰 <b>Новые продажи:</b> ${paidInitialPurchases}`);
  lines.push(`🎁 <b>Новые триалы:</b> ${trialStarts}`);

  const renewalCount = counts.get('RENEWAL') || 0;
  lines.push(
    `🔄 <b>Продления:</b> ${renewalCount}${
      trialConversions ? ` (из них после триала: ${trialConversions})` : ''
    }`,
  );
  lines.push(`❌ <b>Отмены / возвраты:</b> ${counts.get('CANCELLATION') || 0}`);
  lines.push(`⚠️ <b>Проблемы с оплатой:</b> ${counts.get('BILLING_ISSUE') || 0}`);

  const alreadyShown = new Set([
    'INITIAL_PURCHASE',
    'RENEWAL',
    'CANCELLATION',
    'BILLING_ISSUE',
  ]);

  const additional = [...counts.entries()]
    .filter(([type, count]) => !alreadyShown.has(type) && count > 0)
    .sort(([a], [b]) => a.localeCompare(b));

  for (const [type, count] of additional) {
    lines.push(`${EVENT_LABELS[type] || `ℹ️ ${escapeHtml(type)}`}: <b>${count}</b>`);
  }

  if (records.length) {
    const byProject = new Map<string, RevenueCatSummaryRecord[]>();

    for (const record of records) {
      const projectName = record.projectName || record.projectKey || 'Unknown project';
      const existing = byProject.get(projectName) || [];
      existing.push(record);
      byProject.set(projectName, existing);
    }

    lines.push('');
    lines.push('<b>По приложениям:</b>');

    for (const [projectName, projectRecords] of [...byProject.entries()].sort(([a], [b]) =>
      a.localeCompare(b, 'ru'),
    )) {
      lines.push(buildProjectLine(projectName, projectRecords));
    }
  }

  return lines.join('\n');
}

export async function isRevenueCatSummarySent(dateKey: string): Promise<boolean> {
  const markerPath = path.join(getSummaryDirectory(), `${dateKey}.sent`);

  try {
    await readFile(markerPath, 'utf8');
    return true;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') return false;
    throw error;
  }
}

export async function markRevenueCatSummarySent(dateKey: string): Promise<void> {
  const directory = getSummaryDirectory();
  await mkdir(directory, { recursive: true });
  await writeFile(path.join(directory, `${dateKey}.sent`), new Date().toISOString(), 'utf8');
}

export async function cleanupOldRevenueCatSummaryFiles(now = new Date()): Promise<void> {
  const directory = getSummaryDirectory();
  const retentionDays = Number(
    process.env.REVENUECAT_DAILY_SUMMARY_RETENTION_DAYS || DEFAULT_RETENTION_DAYS,
  );
  const safeRetentionDays = Number.isFinite(retentionDays) && retentionDays > 0
    ? retentionDays
    : DEFAULT_RETENTION_DAYS;
  const cutoff = now.getTime() - safeRetentionDays * 86_400_000;

  let files: string[];

  try {
    files = await readdir(directory);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') return;
    throw error;
  }

  await Promise.all(
    files.map(async (filename) => {
      const match = /^(\d{4}-\d{2}-\d{2})\.(jsonl|sent)$/.exec(filename);
      if (!match) return;

      const fileDate = new Date(`${match[1]}T12:00:00Z`).getTime();
      if (Number.isFinite(fileDate) && fileDate < cutoff) {
        await unlink(path.join(directory, filename));
      }
    }),
  );
}
