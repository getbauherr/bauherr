import type { Decision } from '../../../../core/record/schema'
import { Section } from './Section'
import { RefText } from '../RefText'

const OPTION = [
  'flex cursor-pointer items-baseline gap-2 rounded-md border border-border px-3 py-2',
  'has-checked:border-primary has-checked:bg-accent',
  'has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-ring',
].join(' ')

export function OpenDecision({ decision, repo }: { decision: Decision; repo: string }) {
  return (
    <fieldset className="m-0 grid gap-2 border-0 p-0">
      <legend className="mb-2 p-0"><RefText text={decision.question} repo={repo} /></legend>
      {decision.options.map((option) => (
        <label key={option.id} className={OPTION}>
          <input
            type="radio"
            name={`answer:${decision.id}`}
            value={option.id}
            defaultChecked={option.id === decision.recommended}
            className="accent-primary"
          />
          <span className="font-medium"><RefText text={option.label} repo={repo} /></span>
          {option.id === decision.recommended && <span className="small text-muted-foreground">recommended</span>}
        </label>
      ))}
    </fieldset>
  )
}

export function OpenDecisions({ decisions, repo }: { decisions: Decision[]; repo: string }) {
  const open = decisions.filter((decision) => decision.answer === undefined)
  if (open.length === 0) return null
  return (
    <Section title={open.length === 1 ? 'Decision' : 'Decisions'}>
      {open.map((decision) => (
        <OpenDecision key={decision.id} decision={decision} repo={repo} />
      ))}
    </Section>
  )
}

const BY = { owner: 'by you', factory: 'by the factory' } as const

export function AnsweredDecisions({ decisions, repo }: { decisions: Decision[]; repo: string }) {
  if (decisions.length === 0) return null
  return (
    <Section title="Decisions">
      <ul className="m-0 grid gap-2 pl-5">
        {decisions.map((decision) => {
          const chosen = decision.options.find((option) => option.id === decision.answer)
          return (
            <li key={decision.id}>
              <RefText text={decision.question} repo={repo} />{' '}
              <span className="font-medium">{chosen ? <RefText text={chosen.label} repo={repo} /> : 'Open'}</span>
              {decision.by && <span className="small text-muted-foreground"> {BY[decision.by]}</span>}
            </li>
          )
        })}
      </ul>
    </Section>
  )
}
