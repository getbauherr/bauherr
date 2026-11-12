/** The request types and urgencies; plain constants, so client components can import them without the interview engine. */
export const KINDS = ['bug', 'feature', 'change', 'question'] as const
export type Kind = (typeof KINDS)[number]
export const URGENCIES = ['normal', 'urgent'] as const

/** The message of the card's "Send to the factory": it makes the confirmation card from the card as it stands, without a model call. */
export const SEND_TEXT = 'Send this request to the factory.'

export const KIND_LABEL: Record<Kind, string> = { bug: 'Bug', feature: 'Feature', change: 'Change', question: 'Question' }
/** What the Type select says about itself. */
export const KIND_HELP: Record<Kind, string> = { bug: 'Something that worked is broken', feature: 'Something new', change: 'Something should work differently', question: 'You only want an answer' }

