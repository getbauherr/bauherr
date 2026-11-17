import Link from 'next/link'
import { changelogView } from '../../../../lib/changelog'
import { Badge } from '../../components/ui/badge'
import { Markdown } from '../../components/Markdown'
import { renderMarkdown } from '../../lib/markdown'
import { requireBauherr } from '../../lib/session'
import { appVersion, changelog } from '../../lib/version'

export default async function ReleaseNotes({ searchParams }: { searchParams: Promise<{ area?: string }> }) {
  await requireBauherr()
  const { area } = await searchParams
  const { areas, versions } = changelogView(changelog(), area)
  const chip = (label: string, active: boolean, to: string) => <Link key={label} href={to} aria-current={active ? 'page' : undefined}><Badge variant={active ? 'accent' : 'neutral'}>{label}</Badge></Link>
  return (
    <>
      <h1>Release notes</h1>
      <p className="small text-muted-foreground">Current version {appVersion()}</p>
      {areas.length > 0 && <nav aria-label="Area" className="flex flex-wrap gap-2">{[undefined, ...areas].map((a) => chip(a ?? 'All areas', area === a, a ? `/release-notes?area=${encodeURIComponent(a)}` : '/release-notes'))}</nav>}
      {versions.map((v) => (
        <section key={v.heading}>
          <Markdown html={renderMarkdown(v.md)} />
          {v.internal && (
            <details data-testid="release-internal">
              <summary>{v.internal.summary}</summary>
              <Markdown html={renderMarkdown(v.internal.links)} />
            </details>
          )}
        </section>
      ))}
    </>
  )
}
