import type { Metadata } from 'next'
import { Archivo, IBM_Plex_Mono } from 'next/font/google'
import type { ReactNode } from 'react'
import './tokens.css'
import './tailwind.css'
import './app.css'

const archivo = Archivo({ subsets: ['latin'], weight: ['400', '500', '600'], display: 'swap', variable: '--font-archivo' })
const plexMono = IBM_Plex_Mono({ subsets: ['latin'], weight: '400', display: 'swap', variable: '--font-plex-mono' })

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
