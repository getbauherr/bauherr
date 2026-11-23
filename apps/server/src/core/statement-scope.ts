export const STATEMENT_SCOPES = ['ticket', 'product'] as const

export type StatementScope = (typeof STATEMENT_SCOPES)[number]

export const SCOPE_LABEL: Record<StatementScope, string> = { ticket: 'This ticket', product: 'This product' }

export const NOTE_SCOPES = [...STATEMENT_SCOPES, 'none'] as const

export type NoteScope = (typeof NOTE_SCOPES)[number]

export const NOTE_SCOPE_LABEL: Record<NoteScope, string> = { ...SCOPE_LABEL, none: 'Do not remember' }
