import { notFound } from 'next/navigation'
import { RecordNotFound } from '../../../../../core/record/errors'
import { mayOpenRequest, requestScope } from '../../../../../core/views/request-access'
import { requestStory } from '../../../../../core/views/request-story'
import { AutoRefresh } from '../../../components/AutoRefresh'
import { PageTitle } from '../../../components/PageTitle'
import { WordBadge } from '../../../components/WordBadge'
import { NowBox } from '../../../components/request/NowBox'
import { RequestAbout } from '../../../components/request/RequestAbout'
import { RequestComposer } from '../../../components/request/RequestComposer'
import { RequestTimeline } from '../../../components/request/RequestTimeline'
import { REQUEST_WORDS } from '../../../lib/request-words'
import { payloadClient, requirePerson } from '../../../lib/session'

export const dynamic = 'force-dynamic'

type Props = { params: Promise<{ id: string }> }

export default async function RequestPage({ params }: Props) {
  const person = await requirePerson()
  const recordId = Number((await params).id)
  if (!Number.isInteger(recordId) || recordId <= 0) notFound()
  const payload = await payloadClient()
  const scope = await requestScope(payload, recordId)
  if (scope === null || !mayOpenRequest(person, scope)) notFound()
  const story = await requestStory(payload, { workspace: scope.workspace, recordId }).catch((error: unknown) => {
    if (error instanceof RecordNotFound) return notFound()
    throw error
  })
  return (
    <>
      <PageTitle>{`Request #${story.number}`}</PageTitle>
      <header className="flex flex-wrap items-center gap-3">
        <span className="small text-muted-foreground">{`#${story.number}`}</span>
        <h1 className="m-0">{story.title}</h1>
        <WordBadge word={REQUEST_WORDS[story.status].chip} />
      </header>
      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="grid min-w-0 gap-4">
          <NowBox story={story} />
          <RequestTimeline story={story} />
          <RequestComposer />
        </div>
        <RequestAbout story={story} />
      </div>
      <AutoRefresh />
    </>
  )
}
