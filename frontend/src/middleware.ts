import { NextRequest, NextResponse } from 'next/server';

export function middleware(request: NextRequest) {
  const token = request.cookies.get('access_token')?.value;
  const { pathname } = request.nextUrl;

  // Se não tem token e tenta acessar rota protegida
  if (!token && (pathname.startsWith('/backoffice') || pathname.startsWith('/dashboard'))) {
    return NextResponse.redirect(new URL('/auth/login', request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/backoffice/:path*', '/dashboard/:path*'],
};
