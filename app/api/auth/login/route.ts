import { NextRequest, NextResponse } from 'next/server';
import { isSitePasswordConfigured, isSitePasswordValid, SITE_AUTH_COOKIE } from '@/lib/site-auth';

export async function POST(request: NextRequest) {
  if (!isSitePasswordConfigured()) {
    return NextResponse.json(
      { error: 'Site password is not configured. Set SITE_PASSWORD first.' },
      { status: 503 }
    );
  }

  const body = await request.json() as {
    password?: string;
  };
  const password = String(body.password || '');

  if (!isSitePasswordValid(password)) {
    return NextResponse.json({ error: 'Incorrect password.' }, { status: 401 });
  }

  const response = NextResponse.json({ ok: true });
  response.cookies.set({
    name: SITE_AUTH_COOKIE,
    value: 'granted',
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 60 * 60 * 24 * 30,
  });
  return response;
}
