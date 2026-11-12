import Link from 'next/link'

/** Last row of the content column: pushed to the bottom of a short page, padded on phones so the fixed next-step bar never covers it. */
export function AppFooter({ version, minimal }: { version: string; minimal?: boolean }) {
  return (
    <footer className="small mt-auto flex flex-wrap items-center justify-between gap-x-4 gap-y-1 px-8 pt-2 pb-4 text-muted-foreground max-sm:px-4 max-sm:group-has-[[data-testid=action-bar]]/col:pb-[calc(var(--next-step-h,132px)+var(--space-4))]">
      <span>
        Made with <span aria-hidden>❤️</span>
        <span className="sr-only">love</span> in Cologne, Germany
      </span>
      {minimal ? <span data-testid="app-version" className="mono">{version}</span> : <Link href="/release-notes" data-testid="app-version" className="mono hover:text-foreground hover:underline">{version}</Link>}
    </footer>
  )
}
