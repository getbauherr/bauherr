/** The existing owner actions the Send back dialog offers, with the sentence that says what happens. */
export type SendBackOption = { value: 'backToBuild' | 'backToBacklog' | 'requestChanges'; label: string; consequence: string; noteRequired: boolean }

export const SEND_BACK: Record<SendBackOption['value'], SendBackOption> = {
  backToBuild: { value: 'backToBuild', label: 'Build: fix what the review found', consequence: 'Build starts again on the open merge request.', noteRequired: false },
  backToBacklog: { value: 'backToBacklog', label: 'Backlog: plan it again', consequence: 'The Ticket goes back to Triage; its Runs stay as they are.', noteRequired: false },
  requestChanges: { value: 'requestChanges', label: 'Build: change what is on staging', consequence: 'Staging stays as it is. Build starts again with your note.', noteRequired: true },
}

/** The outcomes the dialog lists for a need (a stuck review, a cancelled Ticket) or the staging gate; none elsewhere. */
export const sendBackOptions = (need: string | null | undefined, gateKind?: string | null): SendBackOption[] =>
  need === 'Needs you' ? [SEND_BACK.backToBuild] : need === 'Cancelled' ? [SEND_BACK.backToBacklog] : gateKind === 'release' ? [SEND_BACK.requestChanges] : []
