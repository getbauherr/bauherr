import type { Metadata } from 'next'
import localFont from 'next/font/local'
import type { ReactNode } from 'react'
import { Toaster } from './components/ui/sonner'
import './tokens.css'
import './tailwind.css'

const archivo = localFont({
  src: './fonts/Archivo-latin-wght.woff2',
  weight: '100 900',
  display: 'swap',
  variable: '--font-archivo',
})
const plexMono = localFont({
  src: [
    { path: './fonts/IBMPlexMono-Regular-latin.woff2', weight: '400', style: 'normal' },
    { path: './fonts/IBMPlexMono-Medium-latin.woff2', weight: '500', style: 'normal' },
  ],
  display: 'swap',
  variable: '--font-plex-mono',
})

export const metadata: Metadata = { title: 'Bauherr' }
export const dynamic = 'force-dynamic'

const theme =
  "try{var t=localStorage.getItem('bauherr-theme');" +
  "if(t==='light'||t==='dark')document.documentElement.dataset.theme=t}catch(e){}"

export default function Layout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${archivo.variable} ${plexMono.variable}`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: theme }} />
      </head>
      <body>
        {children}
        <Toaster />
      </body>
    </html>
  )
}
