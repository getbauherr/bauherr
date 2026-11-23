export const STATEMENT_SCOPES = ['ticket', 'product'] as const

export type StatementScope = (typeof STATEMENT_SCOPES)[number]

export const SCOPE_LABEL: Record<StatementScope, string> = { ticket: 'This ticket', product: 'This product' }
