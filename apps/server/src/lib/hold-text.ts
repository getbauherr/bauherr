/** The sentences a Ticket waiting on a shared hold shows on its card and in its bar; the one place they are written. */
export const fastLaneText = (holder: number): string => `Waiting for the fast lane: #${holder} holds it.`
export const overlapText = (stageTitle: string, holder: number): string => `Queued for ${stageTitle}: waits for #${holder}, which changes the same files.`
