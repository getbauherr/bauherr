/** The chat's closing line: every recorded answer and what happens next (`held`: Triage held the Ticket before the last answer). */
export const ownerSummary = (answers: Record<string, string>, held: boolean): string =>
  `${Object.entries(answers).map(([k, v]) => `${k} ${v}`).join(' · ')}. Next: ${held ? 'the Ticket moves to Plan and the plan is written' : 'you can approve the plan'}.`
