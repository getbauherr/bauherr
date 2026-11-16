import { Markdown } from './Markdown'
import { Card } from './ui/card'

type ReleaseGateProps = { ticket: number; timedOut: boolean; summaryHtml: string | null }

/** The staging summary; Request changes is the Send back dialog of the action bar. */
export function ReleaseGate({ timedOut, summaryHtml }: ReleaseGateProps) {
  return (
    <>
      {(timedOut || summaryHtml) && (
        <Card asChild className="max-w-[640px] gap-4 p-6">
          <section aria-label="Staging">
            {timedOut && <p className="body">The deploy was not observed on staging within 60 minutes. Check staging yourself; you can still accept.</p>}
            {summaryHtml && <Markdown html={summaryHtml} />}
          </section>
        </Card>
      )}
    </>
  )
}
