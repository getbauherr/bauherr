import { OWN_ANSWER } from '../../../../core/decisions'
import type { StoredCard } from '../../../../core/record/store'
import type { TicketView } from '../../../../core/views/ticket'
import { ANSWER_ACTION, BACK_ACTION } from '../../lib/decision-actions'
import { questionFacts, recommendedOption } from '../../lib/question-facts'
import { CHOICE_WORDS, NOTE_PROMPTS, NOTE_SAYS, REASON_WORDS } from '../../lib/ticket-words'
import { DecisionForm } from './DecisionForm'
import { Positions } from './Positions'
import { Card, Section } from './Section'
import { RefText } from '../RefText'
import { Radio } from '../ui/radio'

const OPTION = [
  'flex cursor-pointer items-baseline gap-2 rounded-md border border-border px-3',
  'has-checked:border-primary has-checked:bg-accent',
  'has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-ring',
].join(' ')

const askOf = (reason: string): string => `question:${reason}`

const textOf = (card: StoredCard): string => {
  if (card.reason === 'parked') return `${REASON_WORDS.parked}: ${card.text ?? ''}`
  if (card.reason === 'agent' && card.text) return card.text
  return REASON_WORDS[card.reason as keyof typeof REASON_WORDS] ?? ''
}

const optionsOf = (card: StoredCard, ask: string, canGoBack: boolean) => {
  const agent = card.reason === 'agent'
  const options = [...card.options, ...(agent ? [OWN_ANSWER] : [])]
  return {
    choices: options.map((option) => ({ option, label: CHOICE_WORDS[ask]?.[option] ?? option })),
    actions: canGoBack && agent ? [BACK_ACTION, ANSWER_ACTION] : [ANSWER_ACTION],
  }
}

type Props = { view: TicketView; card: StoredCard; may: boolean }

export function QuestionCard({ view, card, may }: Props) {
  const ask = askOf(card.reason)
  const facts = questionFacts(view, card.reason)
  const recommended = recommendedOption(view, card.reason)
  const compact = view.positions !== null
  const { choices, actions } = optionsOf(card, ask, view.canGoBack)
  return (
    <Card bare>
      <DecisionForm
        recordId={view.recordId}
        ask={ask}
        seq={card.seq}
        pick
        sentence={may ? undefined : 'A Bauherr of this Workspace answers.'}
        actions={may ? actions : []}
      >
        <div className={compact ? 'grid gap-3 p-4' : 'grid gap-5 p-6'}>
          <p><RefText text={textOf(card)} repo={view.record.source.repo} /></p>
          {facts.length > 0 && (
            <Section title="Facts">
              <ul className="m-0 grid gap-1 pl-5">{facts.map((fact) => <li key={fact}>{fact}</li>)}</ul>
            </Section>
          )}
          {view.positions && <Positions view={view} positions={view.positions} />}
          {view.deploy && card.reason === 'deploy-stalled' && (
            <p>
              <a href={view.deploy.url} target="_blank" rel="noreferrer" className="underline">
                See the checks of the merged change at the forge
              </a>
            </p>
          )}
          <fieldset className="m-0 grid gap-2 border-0 p-0">
            <legend className="sr-only">Answer</legend>
            {choices.map(({ option, label }) => (
              <label key={option} className={`${OPTION} ${compact ? 'py-1.5' : 'py-2'}`}>
                <Radio
                  name="choice"
                  value={option}
                  data-label={label}
                  data-prompt={NOTE_PROMPTS[`${ask}/${option}`]}
                  data-say={NOTE_SAYS[`${ask}/${option}`]}
                />
                <span className="font-medium">{label}</span>
                {option === recommended && <span className="small text-muted-foreground">recommended</span>}
              </label>
            ))}
          </fieldset>
        </div>
      </DecisionForm>
    </Card>
  )
}
