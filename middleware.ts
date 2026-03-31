import { NextRequest, NextResponse } from 'next/server';
import { hasSiteAccessCookie, isSitePasswordConfigured, SITE_AUTH_COOKIE } from './lib/site-auth';

function isPublicPath(pathname: string): boolean {
  return (
    pathname === '/login' ||
    pathname === '/favicon.ico' ||
    pathname.startsWith('/_next/') ||
    pathname.startsWith('/api/auth/login') ||
    pathname.startsWith('/api/auth/logout')
  );
}

export function middleware(request: NextRequest) {
  const { pathname, search } = request.nextUrl;

  if (isPublicPath(pathname)) {
    return NextResponse.next();
  }

  if (!isSitePasswordConfigured()) {
    if (pathname.startsWith('/api/')) {
      return NextResponse.json(
        { error: 'Site password is not configured. Set SITE_PASSWORD before using the app.' },
        { status: 503 }
      );
    }

    return NextResponse.redirect(new URL('/login?error=config', request.url));
  }

  const hasAccess = hasSiteAccessCookie(request.cookies.get(SITE_AUTH_COOKIE)?.value);
  if (hasAccess) {
    return NextResponse.next();
  }

  if (pathname.startsWith('/api/')) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const loginUrl = new URL('/login', request.url);
  loginUrl.searchParams.set('next', `${pathname}${search}`);
  return NextResponse.redirect(loginUrl);
}

export const config = {
  matcher: ['/((?!.*\\..*).*)'],
};
