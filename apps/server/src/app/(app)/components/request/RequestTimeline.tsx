import type { RequestStory, StoryEvent } from '../../../../core/views/request-story'
import { ArtifactCard } from '../assistant-ui/elements/artifact-card'
import { ImageGallery } from '../assistant-ui/elements/image-gallery'
import { Timeline, type TimelineEvent } from '../assistant-ui/elements/timeline'
import { exactTime, shortDate } from '../../lib/format'
import { sourceOf } from '../ticket/image-ref'

const WORDS = (count: number, one: string, many: string): string => `${count} ${count === 1 ? one : many}`

function Pictures({ event }: { event: StoryEvent }) {
  const images = event.images.map((image) => ({
    id: String(image.id),
    src: sourceOf(image),
    alt: image.caption,
    caption: image.caption,
  }))
  return (
    <>
      <ImageGallery images={images} maxVisible={images.length || 1} className="max-w-2xl" />
      {images.length > 0 && (
        <ul className="small m-0 grid list-none gap-0.5 p-0 text-muted-foreground">
          {images.map((image) => (
            <li key={image.id}>{image.caption}</li>
          ))}
        </ul>
      )}
    </>
  )
}

function Lists({ event }: { event: StoryEvent }) {
  return event.lists.map((list) => (
    <div key={list.heading} className="small grid gap-1">
      <strong>{list.heading}</strong>
      <ol className="m-0 grid gap-0.5 pl-5">
        {list.items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ol>
    </div>
  ))
}

function Card({ event }: { event: StoryEvent }) {
  if (event.kind !== 'plan' && event.kind !== 'ready') return null
  const checks = event.lists[0]?.items.length ?? 0
  const pictures = WORDS(event.images.length, 'picture', 'pictures')
  return <ArtifactCard title={event.title} meta={`${WORDS(checks, 'check', 'checks')}, ${pictures}`} />
}

function Body({ event, staging }: { event: StoryEvent; staging: string | null }) {
  const rich = event.kind === 'plan' || event.kind === 'ready'
  return (
    <div className="mt-1 grid gap-2" data-event={event.kind}>
      <span className="small text-muted-foreground" title={exactTime(event.at)}>
        {exactTime(event.at).slice(11)} · {event.who}
      </span>
      {event.text && <p className="m-0 whitespace-pre-wrap">{event.text}</p>}
      {rich && <Card event={event} />}
      {rich && <Pictures event={event} />}
      {rich && <Lists event={event} />}
      {event.kind === 'ready' && staging && (
        <a href={staging} target="_blank" rel="noreferrer" className="w-fit text-primary hover:underline">
          Open on staging
        </a>
      )}
    </div>
  )
}

const timelineEvent = (event: StoryEvent, staging: string | null): TimelineEvent => ({
  id: event.id,
  when: 'past',
  time: shortDate(event.at),
  title: event.kind === 'comment' ? `Comment by ${event.who}` : event.title,
  body: <Body event={event} staging={staging} />,
})

export function RequestTimeline({ story }: { story: RequestStory }) {
  const events = story.events.map((event) => timelineEvent(event, story.links.staging))
  return (
    <section aria-label="Story">
      <Timeline events={events} visibleCount={events.length} className="max-w-none rounded-md" />
    </section>
  )
}
