// =================================================================
// Файл: src/app/api/ads/verify/route.ts
// =================================================================
import { NextResponse } from 'next/server';

const normalize = (s: string) => s.trim();

function readCodesFromEnv(): string[] {
  const raw = process.env.ADS_DISABLE_CODES;

  if (!raw) return [];

  // JSON массив
  if (raw.trim().startsWith('[')) {
    try {
      const arr = JSON.parse(raw);
      if (Array.isArray(arr)) {
        return arr.map((x) => normalize(String(x))).filter(Boolean);
      }
    } catch {
      return [];
    }
  }

  // CSV
  return raw
    .split(',')
    .map((x) => normalize(x))
    .filter(Boolean);
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const code = normalize(searchParams.get('code') || '');

  if (!code) {
    return NextResponse.json(
      { valid: false, message: 'Code is required' },
      { status: 400 },
    );
  }

  const validCodes = readCodesFromEnv();

  // сравнение регистронезависимое, чтобы удобнее вводить
  const set = new Set(validCodes.map((c) => c.toLowerCase()));
  const isValid = set.has(code.toLowerCase());

  return NextResponse.json(
    { valid: isValid, message: isValid ? 'OK' : 'Invalid code' },
    { status: 200 },
  );
}
