import type { StoredCard } from '../../../../core/record/store'
import type { TicketView } from '../../../../core/views/ticket'
import { ANSWER_ACTION } from '../../lib/decision-actions'
import { questionFacts, recommendedOption } from '../../lib/question-facts'
import { CHOICE_WORDS, NOTE_PROMPTS, REASON_WORDS } from '../../lib/ticket-words'
import { DecisionForm } from './DecisionForm'
import { Card, Section } from './Section'

const OPTION = [
  'flex cursor-pointer items-baseline gap-2 rounded-md border border-border px-3 py-2',
  'has-checked:border-primary has-checked:bg-accent',
  'has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-ring',
].join(' ')

const askOf = (reason: string): string => (reason === 'production-held' ? reason : `question:${reason}`)

const textOf = (card: StoredCard): string => {
  if (card.reason === 'parked') return `${REASON_WORDS.parked}: ${card.text ?? ''}`
  if (card.reason === 'agent' && card.text) return card.text
  return REASON_WORDS[card.reason as keyof typeof REASON_WORDS] ?? ''
}

type Props = { view: TicketView; card: StoredCard; may: boolean }

export function QuestionCard({ view, card, may }: Props) {
  const ask = askOf(card.reason)
  const facts = questionFacts(view, card.reason)
  const remembered = view.answerRemembered ? 'Your answer is remembered for similar tickets.' : undefined
  const recommended = recommendedOption(view, card.reason)
  return (
    <Card bare>
      <DecisionForm
        recordId={view.recordId}
        ask={ask}
        seq={card.seq}
        pick
        sentence={may ? remembered : 'A Bauherr of this Workspace answers.'}
        actions={may ? [ANSWER_ACTION] : []}
      >
        <div className="grid gap-5 p-6">
          <p>{textOf(card)}</p>
          {facts.length > 0 && (
            <Section title="Facts">
              <ul className="m-0 grid gap-1 pl-5">{facts.map((fact) => <li key={fact}>{fact}</li>)}</ul>
            </Section>
          )}
          {view.deploy && card.reason === 'deploy-stalled' && (
            <p>
              <a href={view.deploy.url} target="_blank" rel="noreferrer" className="underline">
                See the checks of the merged change at the forge
              </a>
            </p>
          )}
          <fieldset className="m-0 grid gap-2 border-0 p-0">
            <legend className="sr-only">Answer</legend>
            {card.options.map((option) => {
              const label = CHOICE_WORDS[ask]?.[option] ?? option
              return (
                <label key={option} className={OPTION}>
                  <input
                    type="radio"
                    name="choice"
                    value={option}
                    data-label={label}
                    data-prompt={NOTE_PROMPTS[`${ask}/${option}`]}
                    className="accent-primary"
                  />
                  <span className="font-medium">{label}</span>
                  {option === recommended && <span className="small text-muted-foreground">recommended</span>}
                </label>
              )
            })}
          </fieldset>
        </div>
      </DecisionForm>
    </Card>
  )
}
