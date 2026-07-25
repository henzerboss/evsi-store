import { NextRequest, NextResponse } from 'next/server';
import {
  buildRevenueCatDailySummaryMessage,
  cleanupOldRevenueCatSummaryFiles,
  getPreviousMadridDateKey,
  isRevenueCatSummarySent,
  markRevenueCatSummarySent,
  readRevenueCatSummaryRecords,
} from '@/lib/revenuecatDailySummary';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function getTelegramChatId(): string | undefined {
  return (
    process.env.TELEGRAM_CHAT_ID_RC_DAILY_SUMMARY ||
    process.env.TELEGRAM_CHAT_ID_RC ||
    process.env.TELEGRAM_CHAT_ID
  );
}

async function sendTelegramMessage(message: string): Promise<void> {
  const botToken = process.env.TELEGRAM_BOT_TOKEN_RC || process.env.TELEGRAM_BOT_TOKEN;
  const chatId = getTelegramChatId();

  if (!botToken) throw new Error('TELEGRAM_BOT_TOKEN_RC is not configured');
  if (!chatId) throw new Error('TELEGRAM_CHAT_ID_RC_DAILY_SUMMARY is not configured');

  const response = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      text: message,
      parse_mode: 'HTML',
      disable_web_page_preview: true,
    }),
  });

  if (!response.ok) {
    throw new Error(`Telegram sendMessage failed: ${await response.text()}`);
  }
}

function isValidDateKey(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(`${value}T12:00:00Z`));
}

async function handleSummary(request: NextRequest) {
  const expectedSecret =
    process.env.REVENUECAT_DAILY_SUMMARY_SECRET || process.env.CRON_SECRET;
  const receivedSecret = request.nextUrl.searchParams.get('secret');

  if (!expectedSecret) {
    return NextResponse.json(
      { error: 'REVENUECAT_DAILY_SUMMARY_SECRET or CRON_SECRET is not configured' },
      { status: 500 },
    );
  }

  if (receivedSecret !== expectedSecret) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const requestedDate = request.nextUrl.searchParams.get('date');
  const dateKey = requestedDate || getPreviousMadridDateKey();
  const force = request.nextUrl.searchParams.get('force') === '1';

  if (!isValidDateKey(dateKey)) {
    return NextResponse.json({ error: 'Invalid date. Use YYYY-MM-DD.' }, { status: 400 });
  }

  if (!force && (await isRevenueCatSummarySent(dateKey))) {
    return NextResponse.json({ ok: true, date: dateKey, alreadySent: true });
  }

  const records = await readRevenueCatSummaryRecords(dateKey);
  const message = buildRevenueCatDailySummaryMessage({ dateKey, records });

  await sendTelegramMessage(message);
  await markRevenueCatSummarySent(dateKey);
  await cleanupOldRevenueCatSummaryFiles();

  return NextResponse.json({
    ok: true,
    date: dateKey,
    records: records.length,
    forced: force,
  });
}

export async function GET(request: NextRequest) {
  try {
    return await handleSummary(request);
  } catch (error) {
    console.error('RevenueCat daily summary error:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  return GET(request);
}
