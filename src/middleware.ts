import { NextRequest, NextResponse } from 'next/server'

const ALLOWED_PATHS = ['/feedback', '/api/feedback', '/api/cron']

export function middleware(req: NextRequest) {
  if (process.env.NODE_ENV !== 'production') return NextResponse.next()

  const { pathname } = req.nextUrl
  const isAllowed = ALLOWED_PATHS.some(
    (p) => pathname === p || pathname.startsWith(p + '/')
  )

  if (isAllowed) return NextResponse.next()

  return new NextResponse('Not Found', { status: 404 })
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|robots.txt).*)'],
}
