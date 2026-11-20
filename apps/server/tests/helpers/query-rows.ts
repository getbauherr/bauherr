import type { sql } from '@payloadcms/db-postgres'
import type { Payload } from 'payload'
import { z } from 'zod'

export const queryRows = async <S extends z.ZodType>(
  payload: Payload,
  schema: S,
  q: ReturnType<typeof sql>,
): Promise<z.infer<S>[]> => z.array(schema).parse((await payload.db.drizzle.execute(q)).rows)

export const anyRow = z.record(z.string(), z.unknown())
export const countRow = z.object({ n: z.number() })
