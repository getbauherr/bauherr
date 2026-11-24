import { sql } from '@payloadcms/db-postgres'
import type { Payload } from 'payload'
import { z } from 'zod'

export const riskSuggestionsSchema = z.array(z.object({ name: z.string(), paths: z.array(z.string()) }))
export type RiskSuggestion = z.infer<typeof riskSuggestionsSchema>[number]

const AREA = /^(auth(?!or)|security|permission|payment|billing|migration|infra|deploy)/i
const MAX_SUGGESTIONS = 8

const directoriesOf = (paths: string[]): string[] => {
  const found = new Set<string>()
  for (const path of paths) {
    const parts = path.split('/').slice(0, -1)
    if (parts[0] !== undefined) found.add(parts[0])
    if (parts[1] !== undefined) found.add(`${parts[0]}/${parts[1]}`)
  }
  return [...found].filter((dir) => !/\s/.test(dir)).sort()
}

const nameOf = (directory: string): string =>
  directory
    .slice(directory.lastIndexOf('/') + 1)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')

export const suggestRiskAreas = (paths: string[]): RiskSuggestion[] => {
  const sets = new Map<string, string[]>()
  for (const directory of directoriesOf(paths)) {
    const name = nameOf(directory)
    if (!AREA.test(directory.slice(directory.lastIndexOf('/') + 1)) || !/^[a-z]/.test(name)) continue
    sets.set(name, [...(sets.get(name) ?? []), `${directory}/**`])
  }
  return [...sets]
    .map(([name, globs]) => ({ name, paths: globs }))
    .sort((a, b) => a.name.localeCompare(b.name))
    .slice(0, MAX_SUGGESTIONS)
}

export const SUGGESTIONS_KEY = 'risk-suggestions:'

export const saveSuggestions = async (payload: Payload, source: number, sets: RiskSuggestion[] | null) => {
  const key = `${SUGGESTIONS_KEY}${source}`
  if (sets === null) {
    await payload.db.drizzle.execute(sql`DELETE FROM "instance_state" WHERE "key" = ${key}`)
    return
  }
  await payload.db.drizzle.execute(sql`
    INSERT INTO "instance_state" ("key", "value") VALUES (${key}, ${JSON.stringify(sets)}::jsonb)
    ON CONFLICT ("key") DO UPDATE SET "value" = EXCLUDED."value", "updated_at" = now()`)
}
