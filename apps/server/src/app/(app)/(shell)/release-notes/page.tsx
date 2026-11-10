import { Markdown } from '../../components/Markdown'
import { renderMarkdown } from '../../lib/markdown'
import { appVersion, changelog } from '../../lib/version'

export default function ReleaseNotes() {
  return (
    <>
      <h1>Release notes</h1>
      <p className="small text-muted-foreground">Current version v{appVersion()}</p>
      <Markdown html={renderMarkdown(changelog())} />
    </>
  )
}
