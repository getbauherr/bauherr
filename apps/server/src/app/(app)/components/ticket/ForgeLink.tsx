import { ExternalLink } from '../icons'

export function ForgeLink({ href, label }: { href: string; label: string }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center gap-1 text-primary hover:underline"
    >
      {label}
      <ExternalLink className="size-4" />
      <span className="sr-only">(opens in new tab)</span>
    </a>
  )
}
