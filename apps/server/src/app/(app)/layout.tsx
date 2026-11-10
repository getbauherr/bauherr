import type { Metadata } from 'next'
import localFont from 'next/font/local'
import type { ReactNode } from 'react'
import './tokens.css'
import './tailwind.css'
import './app.css'

/** Vendored (SIL OFL, licences in `fonts/`), Latin subset: the build needs no network. Archivo is one variable file for 400-600. */
const archivo = localFont({ src: './fonts/Archivo-latin-wght.woff2', weight: '100 900', display: 'swap', variable: '--font-archivo' })
const plexMono = localFont({ src: './fonts/IBMPlexMono-Regular-latin.woff2', weight: '400', display: 'swap', variable: '--font-plex-mono' })

export const metadata: Metadata = { title: 'Bauherr' }
// Every page reads the session cookie; never prerender at build time (no DB there).
export const dynamic = 'force-dynamic'

const theme = `try{var t=localStorage.getItem('bauherr-theme');if(t==='light'||t==='dark')document.documentElement.dataset.theme=t}catch(e){}`

export default function Layout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${archivo.variable} ${plexMono.variable}`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: theme }} />
      </head>
      <body>{children}</body>
    </html>
  )
}
