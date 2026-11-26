import type { Payload } from 'payload'
import { readyToRelease, type ProductAt } from './ready'
import { openRun } from './run-store'
import { questionOf, stepLabel, STEP_IDS, type ReleaseRun, type RunOption } from './run-steps'
import type { Bump } from './version'

type StepStatus = 'done' | 'doing' | 'todo' | 'failed'
export type RunStepView = { id: string; label: string; status: StepStatus; link: string | null }
export type RunView = {
  id: number
  version: string
  state: ReleaseRun['state']
  steps: RunStepView[]
  question: { text: string; options: readonly RunOption[] } | null
}
export type ReleasePanel = {
  proposal: { version: string | null; bump: Bump }
  refusal: string | null
  sha: string
  since: string | null
  changes: number
  run: RunView | null
}

export const runView = (run: ReleaseRun): RunView => {
  const firstOpen = run.steps.find((step) => step.status !== 'done')?.id
  return {
    id: run.id,
    version: run.version,
    state: run.state,
    question: questionOf(run),
    steps: STEP_IDS.map((id) => {
      const step = run.steps.find((entry) => entry.id === id)
      const status = step?.status ?? 'todo'
      return {
        id,
        label: stepLabel(id, run),
        status: status === 'todo' && run.state === 'running' && firstOpen === id ? 'doing' : status,
        link: step?.link ?? null,
      }
    }),
  }
}

export const releasePanel = async (payload: Payload, f: ProductAt, now: Date): Promise<ReleasePanel | null> => {
  const ready = await readyToRelease(payload, f, now)
  if (!ready) return null
  const open = await openRun(payload, f.product)
  return {
    proposal: ready.proposal,
    refusal: ready.refusal,
    sha: ready.sha,
    since: ready.since,
    changes: ready.tickets.length,
    run: open ? runView(open) : null,
  }
}

