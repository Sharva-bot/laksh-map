import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { verifySession, COOKIE_NAME } from '@/lib/auth';

function publicPath(pathname: string) {
  return pathname === '/login' || pathname.startsWith('/api/auth') || pathname.startsWith('/_next') || pathname.startsWith('/api/_next') || pathname === '/favicon.ico' || /\.(png|jpg|jpeg|gif|svg|ico|css|js|woff2?|map)$/i.test(pathname);
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  if (publicPath(pathname)) return NextResponse.next();

  const cookie = request.cookies.get(COOKIE_NAME)?.value;
  if (!(await verifySession(cookie))) {
    const url = request.nextUrl.clone();
    url.pathname = '/login';
    url.searchParams.set('from', pathname);
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!_next|api/auth|login|favicon.ico|.*\\..*$).*)'],
};
