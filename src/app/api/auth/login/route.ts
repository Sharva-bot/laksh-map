import { NextResponse } from 'next/server';
import { signTimestamp, COOKIE_NAME, MAX_AGE_MS } from '@/lib/auth';

export async function POST(request: Request) {
  if (!process.env.AUTH_SECRET || !process.env.AUTH_PASSWORD) {
    return NextResponse.json({ error: 'Auth not configured' }, { status: 500 });
  }
  let body: { password?: string };
  try { body = (await request.json()) as { password?: string }; } catch { return NextResponse.json({ error: 'Invalid body' }, { status: 400 }); }
  if (body.password !== process.env.AUTH_PASSWORD) {
    return NextResponse.json({ error: 'Incorrect passkey' }, { status: 401 });
  }
  const timestamp = String(Date.now());
  const sig = await signTimestamp(timestamp);
  const response = NextResponse.json({ ok: true });
  response.cookies.set(COOKIE_NAME, `${timestamp}.${sig}`, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: Math.floor(MAX_AGE_MS / 1000),
  });
  return response;
}

export async function DELETE() {
  const response = NextResponse.json({ ok: true });
  response.cookies.set(COOKIE_NAME, '', { httpOnly: true, path: '/', maxAge: 0 });
  return response;
}
