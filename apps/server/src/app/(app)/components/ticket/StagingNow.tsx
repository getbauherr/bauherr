import type { StagingView } from '../../../../core/views/ticket'
import { exactTime } from '../../lib/format'
import { ForgeLink } from './ForgeLink'
import { Section } from './Section'

export function StagingNow({ staging }: { staging: StagingView }) {
  return (
    <Section title={`On staging since ${exactTime(staging.since)}`}>
      <p className="m-0">
        Commit <span className="mono">{staging.sha.slice(0, 7)}</span> runs on staging.
        {staging.url !== null && (
          <>
            {' '}
            <ForgeLink href={staging.url} label="Try it on staging" />
          </>
        )}
      </p>
    </Section>
  )
}
