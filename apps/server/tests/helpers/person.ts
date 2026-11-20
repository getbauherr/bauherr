import { z } from 'zod'
import type { Bauherr, Person } from '../../src/app/(app)/lib/session'
import { ROLES } from '../../src/lib/people'

const workspace = z.looseObject({ id: z.number(), name: z.string(), slug: z.string() })

const personSchema = z.looseObject({
  id: z.union([z.number(), z.string()]),
  collection: z.string(),
  email: z.string(),
  role: z.enum(ROLES),
  tenants: z.array(z.looseObject({ tenant: z.union([z.number(), workspace]).nullable() })).optional(),
  assignments: z.array(z.unknown()).optional(),
})

const bauherrSchema = personSchema.extend({ role: z.enum(['admin', 'bauherr']) })

const withCollection = (doc: unknown) => ({ ...z.record(z.string(), z.unknown()).parse(doc), collection: 'bauherren' })

export const personOf = (doc: unknown): Person => personSchema.parse(withCollection(doc))

export const bauherrOf = (doc: unknown): Bauherr => bauherrSchema.parse(withCollection(doc))
