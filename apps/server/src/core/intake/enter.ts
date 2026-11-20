import { advance, type AdvanceDeps } from '../engine'
import { appendEvent, createRecord, readEvents } from '../record/store'
import { loadAdoptions, type AdoptionCandidate } from './adopt'
import { classify, type Candidate } from './candidates'

const sourceOf = (candidate: Candidate) => ({
  forge: candidate.forge,
  repo: candidate.repo,
  number: candidate.number,
  reporter: candidate.item.author,
  external: !candidate.item.authorTrusted,
  backlog: candidate.connectedAt !== null && Date.parse(candidate.createdAt) < Date.parse(candidate.connectedAt),
})

const adoptedSourceOf = (candidate: AdoptionCandidate) => ({
  forge: candidate.forge,
  repo: candidate.repo,
  number: candidate.issue,
  reporter: candidate.issueAuthor,
  external: !candidate.issueTrusted,
  backlog: candidate.connectedAt !== null && Date.parse(candidate.issueCreatedAt) < Date.parse(candidate.connectedAt),
  adopted: { pr: candidate.pr },
})

const adopt = async (deps: AdvanceDeps, candidate: AdoptionCandidate): Promise<number> => {
  const input = {
    workspace: candidate.workspace,
    product: candidate.product,
    source: adoptedSourceOf(candidate),
    type: 'change' as const,
  }
  const id = await deps.payload.db.drizzle.transaction(async (tx) => {
    const conn = { db: { drizzle: tx } }
    const stored = await createRecord(conn, input)
    if ((await readEvents(conn, stored.id)).length === 0) {
      const data = { pr: candidate.pr, headSha: candidate.headSha, patchId: `adopted:${candidate.headSha}` }
      await appendEvent(conn, stored.id, { type: 'pull.adopted', data, actor: 'factory' })
    }
    return stored.id
  })
  await advance(id, deps)
  return id
}

export const enterIssues = async (deps: AdvanceDeps): Promise<number[]> => {
  const entered: number[] = []
  for (const candidate of await loadAdoptions(deps.payload, null)) {
    if (candidate.imported) entered.push(await adopt(deps, candidate))
  }
  for (const { candidate, selection } of await classify(deps.payload, deps.now, null)) {
    if (selection.action !== 'enter' || !candidate.imported) continue
    const input = {
      workspace: candidate.workspace,
      product: candidate.product,
      source: sourceOf(candidate),
      type: 'change' as const,
    }
    const stored = await createRecord(deps.payload, input)
    await advance(stored.id, deps)
    entered.push(stored.id)
  }
  return entered
}
