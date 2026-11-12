/** The request types and urgencies; plain constants, so client components can import them without the interview engine. */
export const KINDS = ['bug', 'feature', 'change', 'question'] as const
export type Kind = (typeof KINDS)[number]
export const URGENCIES = ['normal', 'urgent'] as const

export const KIND_LABEL: Record<Kind, string> = { bug: 'Bug', feature: 'Feature', change: 'Change', question: 'Question' }
/** What the Type select says about itself. */
export const KIND_HELP: Record<Kind, string> = { bug: 'Something that worked is broken', feature: 'Something new', change: 'Something should work differently', question: 'You only want an answer' }


/** What the request card calls its problem and "where" fields, by type. */
export const PROBLEM: Record<Kind, string> = { bug: 'What is wrong', feature: 'What is wanted, for whom and why', change: 'What should work differently, for whom and why', question: 'Your question' }
export const WHERE: Record<Kind, string> = { bug: 'Where it happens', feature: 'More to know', change: 'More to know', question: '' }
