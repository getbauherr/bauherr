import type { TicketView } from '../../../../core/views/ticket'
import type { Tab } from '../../lib/ticket'
import { CriteriaTable } from './CriteriaTable'
import { ProofPanel } from './ProofPanel'
import { Facts, Section } from './Section'
import { RefText } from '../RefText'

const list = 'm-0 grid gap-1 pl-5'

export const selectedProof = (view: TicketView, requested: string | undefined): string | null => {
  const ids = view.proofs.map((group) => group.criterion)
  return ids.find((id) => id === requested) ?? ids[0] ?? null
}

const decidedByFactory = (view: TicketView): string[] =>
  view.record.decisions
    .filter((decision) => decision.by === 'factory')
    .map((decision) => {
      const chosen = decision.options.find((option) => option.id === decision.answer)
      return `${decision.question} ${chosen?.label ?? ''}`.trim()
    })

export function ResultBody({ view, tab, proof }: { view: TicketView; tab: Tab; proof: string | undefined }) {
  const { record, recordId, proofs } = view
  const selected = selectedProof(view, proof)
  const group = proofs.find((entry) => entry.criterion === selected)
  const position = record.criteria.findIndex((criterion) => criterion.id === selected)
  const { result } = record
  const factory = decidedByFactory(view)
  const { repo } = record.source
  return (
    <>
      <Section title="Acceptance criteria">
        <CriteriaTable criteria={record.criteria} repo={repo} mode="result" {...{ recordId, tab, proofs, selected }} />
      </Section>
      <ProofPanel group={group} number={position + 1} />
      {result && result.changes.length > 0 && (
        <Section title="What changed">
          <ul className={list}>
            {result.changes.map((change) => (
              <li key={change.text}>
                <RefText text={change.text} repo={repo} />{' '}
                <span className="small text-muted-foreground">{change.tag}</span>
              </li>
            ))}
          </ul>
        </Section>
      )}
      {result && result.walkthrough.length > 0 && (
        <Section title="Walkthrough">
          <ol className={list}>
            {result.walkthrough.map((step) => <li key={step}><RefText text={step} repo={repo} /></li>)}
          </ol>
        </Section>
      )}
      <Facts
        rows={[
          ['Not verified', <RefText key="nv" text={result?.notVerified.join(' ') || 'Nothing listed.'} repo={repo} />],
          ['Decided without you', <RefText key="dw" text={factory.join(' ') || 'Nothing.'} repo={repo} />],
        ]}
      />
    </>
  )
}
