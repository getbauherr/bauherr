import { advance, type AdvanceDeps } from '../engine'
import { createRecord } from '../record/store'
import { classify, type Candidate } from './candidates'

const sourceOf = (candidate: Candidate) => ({
  forge: candidate.forge,
  repo: candidate.repo,
  number: candidate.number,
  reporter: candidate.item.author,
  external: !candidate.item.authorTrusted,
  backlog: candidate.connectedAt !== null && Date.parse(candidate.createdAt) < Date.parse(candidate.connectedAt),
})

export const enterIssues = async (deps: AdvanceDeps): Promise<number[]> => {
  const entered: number[] = []
  for (const { candidate, selection } of await classify(deps.payload, deps.now, null)) {
    if (selection.action !== 'enter') continue
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
