export type { TeamRole, TeamSession } from '../../../../lib/sessions'

export type ModelOption = { value: string; label: string; group: 'Tier' | string }

/** What the role form saves. `model` is `tier:<tier>` or `<provider>/<model>`; `agents` absent means no limit. */
export type RoleSettings = { model?: string; agents?: number }

/** An error text to show under the form, or nothing on success. */
export type SaveResult = { error?: string } | void
