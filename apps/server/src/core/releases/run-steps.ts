import { z } from 'zod'

export const STEP_IDS = ['tag', 'deploy', 'wait', 'check', 'publish', 'tell'] as const
export type StepId = (typeof STEP_IDS)[number]

export const stepSchema = z.object({
  id: z.enum(STEP_IDS),
  status: z.enum(['todo', 'done', 'failed']),
  link: z.string().nullable(),
  detail: z.string().nullable(),
  at: z.string().nullable(),
})
export type Step = z.infer<typeof stepSchema>

export const ticketRefSchema = z.object({ recordId: z.number(), number: z.number() })
export type TicketRef = z.infer<typeof ticketRefSchema>

export const RUN_STATES = ['running', 'failed', 'done', 'abandoned'] as const
export type RunState = (typeof RUN_STATES)[number]

export type ReleaseRun = {
  id: number
  workspace: number
  product: number
  version: string
  sha: string
  state: RunState
  steps: Step[]
  body: string
  tickets: TicketRef[]
  forgeRelease: string | null
  failure: string | null
}

export const newSteps = (): Step[] =>
  STEP_IDS.map((id) => ({ id, status: 'todo', link: null, detail: null, at: null }))

export const OPTIONS = ['check-again', 'release-fixed-later'] as const
export type RunOption = (typeof OPTIONS)[number]

export const questionOf = (run: ReleaseRun): { text: string; options: readonly RunOption[] } | null => {
  if (run.state !== 'failed') return null
  return { text: `Releasing ${run.version} stopped: ${run.failure ?? 'a step failed'}`, options: OPTIONS }
}

export const stepLabel = (id: StepId, run: Pick<ReleaseRun, 'version' | 'sha'>): string => {
  const commit = run.sha.slice(0, 7)
  const labels: Record<StepId, string> = {
    tag: `Tag ${run.version} and a draft release created`,
    deploy: `Production deploy started with build ${commit}`,
    wait: 'Waiting for the production deploy to finish',
    check: `Production reports ${commit}`,
    publish: 'Release notes published',
    tell: 'Requesters told their change is live',
  }
  return labels[id]
}
