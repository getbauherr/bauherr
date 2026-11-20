import { sql } from '@payloadcms/db-postgres'
import type { Payload } from 'payload'
import type { ReadForge } from '../forge/reader'
import { errorText } from './map'
import type { SourceRow } from './store'

export type BranchProtection = 'yes' | 'no' | 'unknown'

export type SourceFacts = {
  defaultBranch: string
  branchProtected: BranchProtection
  requiredCheckNames: string[]
  hasAgentsFile: boolean
  issueFormCount: number
}

const protection = (value: boolean | null): BranchProtection => (value === null ? 'unknown' : value ? 'yes' : 'no')

export const readFacts = async (repo: string, forge: ReadForge): Promise<SourceFacts> => {
  const { defaultBranch } = await forge.getRepository(repo)
  return {
    defaultBranch,
    branchProtected: protection(await forge.isBranchProtected(repo, defaultBranch)),
    requiredCheckNames: await forge.requiredChecks(repo, defaultBranch),
    hasAgentsFile: await forge.fileExists(repo, 'AGENTS.md', defaultBranch),
    issueFormCount: await forge.countIssueForms(repo, defaultBranch),
  }
}

const saveFacts = async (payload: Payload, id: number, facts: SourceFacts, now: Date): Promise<void> => {
  await payload.db.drizzle.execute(sql`
    UPDATE "ticket_sources" SET
      "default_branch" = ${facts.defaultBranch},
      "branch_protected" = ${facts.branchProtected},
      "required_check_names" = ${JSON.stringify(facts.requiredCheckNames)}::jsonb,
      "has_agents_file" = ${facts.hasAgentsFile},
      "issue_form_count" = ${facts.issueFormCount},
      "facts_at" = ${now.toISOString()}::timestamptz,
      "updated_at" = now()
    WHERE "id" = ${id}`)
}

export const refreshFacts = async (
  payload: Payload,
  source: SourceRow,
  forge: ReadForge,
  now: Date,
): Promise<string | null> => {
  try {
    await saveFacts(payload, source.id, await readFacts(source.repo, forge), now)
    return null
  } catch (error) {
    return errorText(error)
  }
}
