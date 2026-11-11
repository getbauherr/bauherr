export const SETUP_STEPS = [
  ['forge', 'Connect your forge'],
  ['product', 'Pick a product'],
  ['team', 'Pick your team'],
  ['session', 'Connect a session'],
  ['request', 'First request'],
] as const
export type SetupStepId = (typeof SETUP_STEPS)[number][0]

/** The steps without which the factory has nothing to work on; the rest can be skipped. */
export const REQUIRED: readonly SetupStepId[] = ['forge', 'product', 'request']

/** Skipping the session step is recorded as this human touch, so Done stays computed from data. */
export const SKIP_SESSION = 'setup:skip-session'

export type SetupFacts = {
  /** A forge Connection is verified, or one that polled its ticket source successfully (in working use). */
  forgeConnected: boolean
  product: boolean
  /** The Workspace has an applied factory file version: a picked preset, or Standard applied by skipping. */
  teamApplied: boolean
  sessionEver: boolean
  llmConnection: boolean
  sessionSkipped: boolean
  ticket: boolean
}

/** Done per step, from the facts. The session step is met by a session, a Runner (an LLM Connection) or a skip. */
export const stepsOf = (f: SetupFacts) => {
  const done: Record<SetupStepId, boolean> = { forge: f.forgeConnected, product: f.product, team: f.teamApplied, session: f.sessionEver || f.llmConnection || f.sessionSkipped, request: f.ticket }
  const steps = SETUP_STEPS.map(([id, label]) => ({ id, label, done: done[id], required: REQUIRED.includes(id) }))
  return { steps, count: steps.filter((s) => s.done).length, complete: steps.filter((s) => s.required).every((s) => s.done) }
}
export type SetupSteps = ReturnType<typeof stepsOf>['steps']

/** An Admin of a Workspace without a Product lands on /setup instead of an empty Workflow. */
export const needsSetup = (admin: boolean, products: number): boolean => admin && products === 0

/** The step the page shows: a revisited one that is not beyond the first undone step, else the first undone; none once everything is done. */
export const shownStep = (steps: SetupSteps, asked: string | undefined): SetupStepId | undefined => {
  const first = steps.findIndex((s) => !s.done)
  const at = steps.findIndex((s) => s.id === asked)
  return at >= 0 && (first < 0 || at <= first) ? steps[at]!.id : steps[first]?.id
}

