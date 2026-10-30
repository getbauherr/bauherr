import type { Metadata } from 'next'
import type { ReactNode } from 'react'
import './tokens.css'
import './app.css'

export const metadata: Metadata = { title: 'Bauherr' }
// Every page reads the session cookie; never prerender at build time (no DB there).
export const dynamic = 'force-dynamic'

const theme = `try{var t=localStorage.getItem('bauherr-theme');if(t==='light'||t==='dark')document.documentElement.dataset.theme=t}catch(e){}`

export default function Layout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Archivo:wght@400;500;600&family=IBM+Plex+Mono&display=swap" />
        <script dangerouslySetInnerHTML={{ __html: theme }} />
      </head>
      <body>{children}</body>
    </html>
  )
}
