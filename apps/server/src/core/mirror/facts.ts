import { sql } from '@payloadcms/db-postgres'
import type { Payload } from 'payload'
import type { ReadForge } from '../forge/reader'
import { errorText } from './map'
import type { SourceRow } from './store'

export type BranchProtection = 'yes' | 'no' | 'unknown'

export const AGENTS_FILE_MAX = 12_000

export type AgentsFile = { text: string; cut: boolean }

export const cutAgentsFile = (text: string): AgentsFile => {
  if (text.length <= AGENTS_FILE_MAX) return { text, cut: false }
  const head = text.slice(0, AGENTS_FILE_MAX)
  const lineEnd = head.lastIndexOf('\n')
  return { text: lineEnd > 0 ? head.slice(0, lineEnd) : head, cut: true }
}

export type SourceFacts = {
  defaultBranch: string
  branchProtected: BranchProtection
  requiredCheckNames: string[]
  hasAgentsFile: boolean
  agentsFile: AgentsFile | null
  issueFormCount: number
}

const protection = (value: boolean | null): BranchProtection => (value === null ? 'unknown' : value ? 'yes' : 'no')

export const readFacts = async (repo: string, forge: ReadForge): Promise<SourceFacts> => {
  const { defaultBranch } = await forge.getRepository(repo)
  const hasAgentsFile = await forge.fileExists(repo, 'AGENTS.md', defaultBranch)
  const file = hasAgentsFile ? await forge.getFile(repo, 'AGENTS.md', defaultBranch) : null
  const agentsFile = file ? cutAgentsFile(file.content) : null
  return {
    defaultBranch,
    branchProtected: protection(await forge.isBranchProtected(repo, defaultBranch)),
    requiredCheckNames: await forge.requiredChecks(repo, defaultBranch),
    hasAgentsFile,
    agentsFile,
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
      "agents_file" = ${facts.agentsFile?.text ?? null},
      "agents_file_cut" = ${facts.agentsFile?.cut ?? false},
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
