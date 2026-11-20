export function AppFooter({ version }: { version: string }) {
  return (
    <footer
      className={
        'small mt-auto flex flex-wrap items-center justify-between gap-x-4 gap-y-1 px-8 ' +
        'pt-2 pb-4 text-muted-foreground max-sm:px-4'
      }
    >
      <span>
        Made with <span aria-hidden>❤️</span>
        <span className="sr-only">love</span> in Cologne, Germany
      </span>
      <span data-testid="app-version" className="mono">
        {version}
      </span>
    </footer>
  )
}
