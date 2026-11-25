import type { RequestStory } from '../../../../core/views/request-story'
import { NotWhatIAsked } from './NotWhatIAsked'
import { REQUEST_WORDS, TURN_WORDS } from '../../lib/request-words'

export function NowBox({ story }: { story: RequestStory }) {
  const words = REQUEST_WORDS[story.status]
  const staging = story.status === 'result-ready' ? story.links.staging : null
  return (
    <section aria-labelledby="now" className="grid gap-2 rounded-md border border-border bg-card p-4">
      <h2 id="now" className="label text-muted-foreground">
        Now
      </h2>
      <p className="m-0">{words.now}</p>
      <p className="small m-0 text-muted-foreground">{TURN_WORDS[words.turn]}</p>
      {story.status === 'result-ready' && <NotWhatIAsked />}
      {staging && (
        <a href={staging} target="_blank" rel="noreferrer" className="w-fit text-primary hover:underline">
          Open on staging
        </a>
      )}
    </section>
  )
}
