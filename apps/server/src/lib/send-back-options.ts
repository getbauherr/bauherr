export type SendBackValue = 'backToBuild' | 'backToBacklog' | 'requestChanges' | `to:${string}`
/** What the Send back dialog offers, with the sentence that says what happens. */
export type SendBackOption = { value: SendBackValue; label: string; consequence: string; noteRequired: boolean }
/** One backward target of the workflow (`sendBackTargets`), titled; `kind` is the stage's kind, absent for the backlog. */
export type SendBackTarget = { to: string; title: string; kind?: string }

export const SEND_BACK: Record<'backToBuild' | 'backToBacklog' | 'requestChanges', SendBackOption> = {
  backToBuild: { value: 'backToBuild', label: 'Build: fix what the review found', consequence: 'Build starts again on the open merge request.', noteRequired: false },
  backToBacklog: { value: 'backToBacklog', label: 'Backlog: plan it again', consequence: 'The Ticket goes back to Triage; its Runs stay as they are.', noteRequired: false },
  requestChanges: { value: 'requestChanges', label: 'Build: change what is on staging', consequence: 'Staging stays as it is. Build starts again with your note.', noteRequired: true },
}

/** The target a need option leads to: a stage kind, or `backlog`. */
const DESTINATION = { backToBuild: 'build', requestChanges: 'build', backToBacklog: 'backlog' } as const

const AGAIN: Record<string, { what: string; consequence: string }> = {
  plan: { what: 'plan again', consequence: 'Plan starts again; the plan approval is dropped.' },
  triage: { what: 'ask the questions again', consequence: 'Triage asks its questions again.' },
  build: { what: 'build again', consequence: 'Build starts again with your note.' },
  backlog: { what: 'plan it again from the start', consequence: 'The Ticket goes back to Triage; its Runs stay as they are.' },
}

const optionOf = (t: SendBackTarget): SendBackOption => {
  const a = AGAIN[t.to === 'backlog' ? 'backlog' : (t.kind ?? '')]
  return { value: `to:${t.to}`, label: `${t.title}: ${a?.what ?? 'send it back'}`, consequence: a?.consequence ?? `${t.title} starts again.`, noteRequired: false }
}

/**
 * The outcomes the dialog lists: the need's own action (a stuck review, a cancelled Ticket, the staging gate), then, for a Bauherr or Admin, every backward `targets` of the stage
 * except the destination a need option already leads to. A Product owner gets no `targets` and keeps the need options.
 */
export const sendBackOptions = (need: string | null | undefined, gateKind?: string | null, targets: SendBackTarget[] = []): SendBackOption[] => {
  const own = need === 'Needs you' ? [SEND_BACK.backToBuild] : need === 'Cancelled' ? [SEND_BACK.backToBacklog] : gateKind === 'release' ? [SEND_BACK.requestChanges] : []
  const taken = new Set<string>(own.map((o) => DESTINATION[o.value as keyof typeof DESTINATION]))
  return [...own, ...targets.filter((t) => !taken.has(t.to === 'backlog' ? 'backlog' : (t.kind ?? t.to))).map(optionOf)]
}
