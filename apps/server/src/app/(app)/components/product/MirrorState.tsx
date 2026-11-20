import type { SourceState } from '../../../../core/views/product-settings'
import { Time } from '../Time'

export const formatCount = (n: number): string => n.toLocaleString('en')

export function MirrorState({ source }: { source: SourceState }) {
  if (source.lastError) {
    return (
      <>
        The last sync failed: {source.lastError} Bauherr tries again on its next round.
        {source.lastPolledAt && <> Tried <Time iso={source.lastPolledAt} />.</>}
      </>
    )
  }
  if (!source.lastPolledAt) return <>Not synced yet. The first sync starts within a minute.</>
  const counts = (
    <>
      <span className="mono">{formatCount(source.issuesMirrored)}</span> issues and{' '}
      <span className="mono">{formatCount(source.pullRequestsMirrored)}</span> pull requests mirrored
    </>
  )
  if (!source.importedAt) return <>Importing: {counts} so far.</>
  return <>Synced <Time iso={source.lastPolledAt} />: {counts}.</>
}
