// file: src/app/api/check-env/route.ts
import { NextResponse } from 'next/server';

export async function GET() {
  const secret = process.env.AUTH_SECRET;

  if (secret && secret.length > 5) {
    return NextResponse.json({ status: 'OK', message: 'AUTH_SECRET is loaded.' });
  } else {
    return NextResponse.json({ status: 'FAIL', message: 'AUTH_SECRET is missing or empty.' }, { status: 500 });
  }
}