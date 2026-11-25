import type { ReleasePanel, RunView } from '../../../../core/releases/panel'
import type { Bump } from '../../../../core/releases/version'
import { Check, CircleHelp, ExternalLink, TriangleAlert, X } from '../icons'
import { Button } from '../ui/button'
import { Input } from '../ui/input'

const BUMPS: Record<Bump, string> = {
  major: 'major: something changes for the people who use it',
  minor: 'minor: new capabilities, nothing breaks',
  patch: 'patch: fixes only',
}

const QUESTION_BUTTONS = {
  'check-again': 'Check again',
  'release-fixed-later': 'Release a fixed version later',
} as const

const STEP =
  'grid grid-cols-[1.75rem_minmax(0,1fr)_auto] items-center gap-3 border-t border-border py-2 first:border-t-0'

const MARKS = {
  done: { Icon: Check, tone: 'text-ok' },
  doing: { Icon: CircleHelp, tone: 'text-primary' },
  todo: { Icon: CircleHelp, tone: 'text-muted-foreground' },
  failed: { Icon: X, tone: 'text-destructive' },
} as const

function Step({ step }: { step: RunView['steps'][number] }) {
  const { Icon, tone } = MARKS[step.status]
  return (
    <li className={STEP}>
      <Icon className={`size-4 justify-self-center ${tone}`} />
      <span className={step.status === 'todo' ? 'text-muted-foreground' : ''}>{step.label}</span>
      {step.link && (
        <a href={step.link} className="small inline-flex items-center gap-1 text-primary underline underline-offset-2">
          On the forge <ExternalLink className="size-3" />
        </a>
      )}
    </li>
  )
}

type Action = (form: FormData) => Promise<void>
export type Actions = { release: Action; answer: Action }

function Question({ run, product, answer }: { run: RunView; product: number; answer: Action }) {
  if (run.question === null) return null
  return (
    <form action={answer} className="grid gap-2 rounded-md border border-border bg-secondary p-3">
      <input type="hidden" name="product" value={product} />
      <input type="hidden" name="run" value={run.id} />
      <p className="m-0 flex items-start gap-2 font-medium">
        <TriangleAlert className="mt-0.5 size-4 shrink-0 text-warn" />
        {run.question.text}
      </p>
      <p className="small m-0 text-muted-foreground">The release stays a draft until it is fixed.</p>
      <div className="flex flex-wrap gap-2">
        {run.question.options.map((option) => (
          <Button key={option} type="submit" name="option" value={option} size="sm" variant="outline">
            {QUESTION_BUTTONS[option]}
          </Button>
        ))}
      </div>
    </form>
  )
}

function Running({ run, product, answer }: { run: RunView; product: number; answer: Action }) {
  return (
    <section aria-labelledby="releasing" className="grid gap-3 rounded-md border border-border bg-card p-4">
      <h2 id="releasing" className="heading">
        {run.state === 'failed' ? `Release ${run.version} stopped` : `Releasing ${run.version}`}
      </h2>
      <ol className="m-0 list-none p-0">
        {run.steps.map((step) => <Step key={step.id} step={step} />)}
      </ol>
      <Question run={run} product={product} answer={answer} />
    </section>
  )
}

type StartProps = { panel: ReleasePanel; product: number; refused: string | null; release: Action }

function Start({ panel, product, refused, release }: StartProps) {
  const { proposal, refusal } = panel
  const version = proposal.version ?? ''
  return (
    <section aria-labelledby="release" className="grid gap-3 rounded-md border border-border bg-card p-4">
      <h2 id="release" className="heading">Release {version}</h2>
      {(refused ?? refusal) !== null && <p className="small m-0 text-destructive">{refused ?? refusal}</p>}
      <form action={release} className="grid max-w-sm gap-2">
        <input type="hidden" name="product" value={product} />
        <label className="small grid gap-1">
          Version
          <Input name="version" defaultValue={version} maxLength={40} className="mono" />
        </label>
        <span className="small text-muted-foreground">{BUMPS[proposal.bump]}</span>
        <p className="small m-0">
          Deploys <span className="mono">{panel.sha.slice(0, 7)}</span> to production and publishes the notes.
        </p>
        <div>
          <Button type="submit" disabled={refusal !== null}>Release {version}</Button>
        </div>
      </form>
    </section>
  )
}

type Props = { panel: ReleasePanel; product: number; refused: string | null; actions: Actions }

export function ReleaseControl({ panel, product, refused, actions }: Props) {
  if (panel.run) return <Running run={panel.run} product={product} answer={actions.answer} />
  return <Start panel={panel} product={product} refused={refused} release={actions.release} />
}
