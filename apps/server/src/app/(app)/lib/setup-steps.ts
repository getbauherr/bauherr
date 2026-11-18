export const SETUP_STEPS = [
  ['forge', 'Connect your forge'],
  ['product', 'Pick a product'],
  ['team', 'Pick your team'],
  ['session', 'Connect a session'],
  ['request', 'First request'],
] as const
export type SetupStepId = (typeof SETUP_STEPS)[number][0]

export const REQUIRED: readonly SetupStepId[] = ['forge', 'product', 'request']

export const SKIP_SESSION = 'setup:skip-session'

export type SetupFacts = {
  forgeConnected: boolean
  product: boolean
  teamApplied: boolean
  sessionEver: boolean
  llmConnection: boolean
  sessionSkipped: boolean
  ticket: boolean
}

export const stepsOf = (f: SetupFacts) => {
  const done: Record<SetupStepId, boolean> = { forge: f.forgeConnected, product: f.product, team: f.teamApplied, session: f.sessionEver || f.llmConnection || f.sessionSkipped, request: f.ticket }
  const steps = SETUP_STEPS.map(([id, label]) => ({ id, label, done: done[id], required: REQUIRED.includes(id) }))
  return { steps, count: steps.filter((s) => s.done).length, complete: steps.filter((s) => s.required).every((s) => s.done) }
}
export type SetupSteps = ReturnType<typeof stepsOf>['steps']

export const needsSetup = (admin: boolean, products: number): boolean => admin && products === 0

export const shownStep = (steps: SetupSteps, asked: string | undefined): SetupStepId | undefined => {
  const first = steps.findIndex((s) => !s.done)
  const at = steps.findIndex((s) => s.id === asked)
  return at >= 0 && (first < 0 || at <= first) ? steps[at]!.id : steps[first]?.id
}

