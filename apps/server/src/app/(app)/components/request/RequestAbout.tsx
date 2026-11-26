import type { ReactNode } from 'react'
import type { LiveVersion } from '../../../../core/releases/live'
import type { RequestStory } from '../../../../core/views/request-story'
import { Time } from '../Time'
import { Card, Facts } from '../ticket/Section'

function LiveFact({ live }: { live: LiveVersion }) {
  if (!live.notes) return live.version
  return (
    <a href={live.notes} target="_blank" rel="noreferrer" className="text-primary hover:underline">
      {live.version}
    </a>
  )
}

export function RequestAbout({ story }: { story: RequestStory }) {
  const { about, links } = story
  return (
    <aside className="grid gap-4">
      <Card>
        <h2 className="label text-muted-foreground">About</h2>
        <Facts
          rows={[
            ['Type', about.type],
            ['By', about.by],
            ['Created', <Time key="created" iso={about.created} />],
            ['Product', about.product],
            ...(story.live ? [['Version', <LiveFact key="version" live={story.live} />] as [string, ReactNode]] : []),
          ]}
        />
      </Card>
      <Card>
        <h2 className="label text-muted-foreground">Links</h2>
        {links.issue && (
          <a href={links.issue} className="text-primary hover:underline">{`Issue #${story.number}`}</a>
        )}
        {links.staging && (
          <a href={links.staging} className="text-primary hover:underline">
            Staging
          </a>
        )}
      </Card>
    </aside>
  )
}
