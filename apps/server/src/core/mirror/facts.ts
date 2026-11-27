import { sql } from '@payloadcms/db-postgres'
import type { Payload } from 'payload'
import type { ReadForge } from '../forge/reader'
import { saveSuggestions, suggestRiskAreas, type RiskSuggestion } from '../readiness/suggest'
import { readInstructionFiles, saveInstructionFiles, type InstructionFiles } from './instruction-files'
import { errorText } from './map'
import type { SourceRow } from './source-store'

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
  instructionFiles: InstructionFiles | null
  riskSuggestions: RiskSuggestion[] | null
}

const protection = (value: boolean | null): BranchProtection => (value === null ? 'unknown' : value ? 'yes' : 'no')

type Listing = { commit: string; paths: string[] }

const listingOf = async (repo: string, defaultBranch: string, forge: ReadForge): Promise<Listing | null> => {
  try {
    return await forge.listFiles(repo, defaultBranch)
  } catch {
    return null
  }
}

const instructionFilesOf = async (
  repo: string,
  defaultBranch: string,
  forge: ReadForge,
  listing: Listing | null,
): Promise<InstructionFiles | null> => {
  try {
    return listing ? await readInstructionFiles(repo, forge, listing, defaultBranch) : null
  } catch {
    return null
  }
}

export const readFacts = async (repo: string, forge: ReadForge): Promise<SourceFacts> => {
  const { defaultBranch } = await forge.getRepository(repo)
  const hasAgentsFile = await forge.fileExists(repo, 'AGENTS.md', defaultBranch)
  const file = hasAgentsFile ? await forge.getFile(repo, 'AGENTS.md', defaultBranch) : null
  const agentsFile = file ? cutAgentsFile(file.content) : null
  const listing = await listingOf(repo, defaultBranch, forge)
  return {
    defaultBranch,
    branchProtected: protection(await forge.isBranchProtected(repo, defaultBranch)),
    requiredCheckNames: await forge.requiredChecks(repo, defaultBranch),
    hasAgentsFile,
    agentsFile,
    issueFormCount: await forge.countIssueForms(repo, defaultBranch),
    instructionFiles: await instructionFilesOf(repo, defaultBranch, forge, listing),
    riskSuggestions: listing ? suggestRiskAreas(listing.paths) : null,
  }
}

const saveFacts = async (payload: Payload, source: SourceRow, facts: SourceFacts, now: Date): Promise<void> => {
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
    WHERE "id" = ${source.id}`)
  await saveSuggestions(payload, source.id, facts.riskSuggestions)
  if (facts.instructionFiles) await saveInstructionFiles(payload, source, facts.instructionFiles, now)
}

export const refreshFacts = async (
  payload: Payload,
  source: SourceRow,
  forge: ReadForge,
  now: Date,
): Promise<string | null> => {
  try {
    await saveFacts(payload, source, await readFacts(source.repo, forge), now)
    return null
  } catch (error) {
    return errorText(error)
  }
}
