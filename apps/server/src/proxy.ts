import { NextResponse, type NextRequest } from 'next/server'

export const proxy = (req: NextRequest) =>
  process.env.BAUHERR_ENABLE_ADMIN === '1' ? NextResponse.next() : NextResponse.redirect(new URL('/settings', req.url), 307)

export const config = { matcher: ['/admin', '/admin/:path*'] }
