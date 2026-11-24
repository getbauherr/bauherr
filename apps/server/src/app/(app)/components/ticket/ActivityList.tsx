import type { TicketView } from '../../../../core/views/ticket'
import { Time } from '../Time'
import { Card } from './Section'
import { RefText } from '../RefText'
import { fileUrl } from '../conversation/conversation-api'

type Props = { events: TicketView['events']; repo: string; files?: TicketView['commentFiles'] }

export function ActivityList({ events, repo, files = [] }: Props) {
  return (
    <Card bare>
      {files.length > 0 && (
        <ul aria-label="Files attached to comments" className="m-0 flex list-none flex-wrap gap-3 p-4 pb-2">
          {files.map((file) => (
            <li key={file.id}>
              <a href={fileUrl(file.conversationId, file.id)} className="underline">
                {file.name}
              </a>
            </li>
          ))}
        </ul>
      )}
      <ol className="m-0 grid list-none p-0">
        {events.map((event) => (
          <li
            key={event.id}
            className="grid grid-cols-[96px_minmax(0,1fr)] gap-3 border-t border-border px-4 py-2 first:border-t-0"
          >
            <Time iso={event.at} className="mono text-muted-foreground" />
            <span>
              <RefText text={event.label} repo={repo} />
            </span>
          </li>
        ))}
      </ol>
    </Card>
  )
}
