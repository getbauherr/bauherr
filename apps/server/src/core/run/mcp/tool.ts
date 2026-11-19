import { sql } from '@payloadcms/db-postgres'
import { z } from 'zod'
import type { Person } from '../../decide'
import type { AdvanceDeps } from '../../engine'
import type { SubmitDeps } from '../../submit'
import { RunNotFound, WrongKeyKind } from '../errors'

export type AgentContext = { deps: SubmitDeps; workspace: number; keyId: number }
export type PersonContext = { deps: AdvanceDeps; person: Person }
export type Contexts = { agent: AgentContext; person: PersonContext }
export type Access = keyof Contexts

export type Tool = {
  name: string
  description: string
  access: Access
  input: z.ZodType
  call: (raw: unknown, contexts: Partial<Contexts>) => Promise<unknown>
}

type Definition<A extends Access, S extends z.ZodType> = {
  name: string
  description: string
  access: A
  input: S
  run: (input: z.infer<S>, context: Contexts[A]) => Promise<unknown>
}

export const defineTool = <A extends Access, S extends z.ZodType>(definition: Definition<A, S>): Tool => ({
  name: definition.name,
  description: definition.description,
  access: definition.access,
  input: definition.input,
  call: async (raw, contexts) => {
    const context = contexts[definition.access]
    if (!context) {
      const key = definition.access === 'agent' ? 'an agent key' : 'the personal API key of a person'
      throw new WrongKeyKind(`${definition.name} needs ${key}: use the right key.`)
    }
    return definition.run(definition.input.parse(raw), context)
  },
})

export const runId = z.number().int().positive()
export const leaseToken = z.string().min(1).max(200)

export const ownRun = async (context: AgentContext, id: number): Promise<void> => {
  const found = await context.deps.payload.db.drizzle.execute(sql`
    SELECT r."workspace_id" FROM "stage_runs" s JOIN "records" r ON r."id" = s."record_id" WHERE s."id" = ${id}`)
  if (Number(found.rows[0]?.workspace_id) !== context.workspace) {
    throw new RunNotFound(`Run ${id} does not exist: check the id.`)
  }
}
