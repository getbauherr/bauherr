import { ExternalLink } from './icons'
import { Button } from './ui/button'

export function ForgeLink({ href, label }: { href: string; label: string }) {
  return (
    <Button asChild variant="outline" data-testid="forge-link">
      <a href={href} target="_blank" rel="noopener noreferrer">
        {label}
        <ExternalLink className="size-4" />
        <span className="sr-only"> (opens in new tab)</span>
      </a>
    </Button>
  )
}
