import { Markdown } from '../../components/Markdown'
import { renderMarkdown } from '../../lib/markdown'
import { requireBauherr } from '../../lib/session'
import { appVersion, changelog } from '../../lib/version'

export default async function ReleaseNotes() {
  await requireBauherr()
  return (
    <>
      <h1>Release notes</h1>
      <p className="small text-muted-foreground">Current version {appVersion()}</p>
      <Markdown html={renderMarkdown(changelog())} />
    </>
  )
}
