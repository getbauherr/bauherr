/** The chat's closing line: every recorded answer and what happens next (`planReady`: the latest Run is a succeeded plan Run, read after the last answer). */
export const ownerSummary = (answers: Record<string, string>, planReady: boolean): string =>
  `${Object.entries(answers).map(([k, v]) => `${k} ${v}`).join(' · ')}. Next: ${planReady ? 'you can approve the plan' : 'the plan is being written, then you can approve it'}.`
