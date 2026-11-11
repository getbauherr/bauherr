import { beforeAll, expect, it } from 'vitest'

let chatTools: typeof import('../src/lib/chat/tools').chatTools
let tools: typeof import('../src/lib/mcp-tools').tools
beforeAll(async () => {
  process.env.PAYLOAD_SECRET ??= 'test-secret'
  process.env.ENCRYPTION_KEY ??= 'test-key'
  chatTools = (await import('../src/lib/chat/tools')).chatTools
  tools = (await import('../src/lib/mcp-tools')).tools
})

const READS = ['list_frontier', 'get_ticket', 'read_worklog', 'read_knowledge', 'search_knowledge']

it('exposes no session-run tool: of the agent MCP tools only the five read tools', () => {
  const exposed = chatTools().map((t) => t.name)
  const agent = tools.filter((t) => t.access === 'agent').map((t) => t.name)
  expect(exposed.filter((n) => agent.includes(n)).sort()).toEqual([...READS].sort())
  for (const run of ['claim_run', 'claim_next', 'heartbeat', 'report_step', 'attach_evidence', 'submit_plan', 'submit_investigation', 'submit_review', 'submit_triage', 'request_review', 'run_checks', 'finish_run', 'relink_mr', 'release_run', 'post_staging_summary', 'return_to_build', 'update_worklog', 'load_skill']) expect(exposed).not.toContain(run)
})

it('every human MCP tool that is exposed needs a confirmation, every agent read tool is a read, and each tool has a schema', () => {
  const human = tools.filter((t) => t.access === 'human').map((t) => t.name)
  const chat = chatTools()
  expect(chat.filter((t) => human.includes(t.name)).every((t) => t.kind === 'confirm')).toBe(true)
  expect(chat.filter((t) => human.includes(t.name)).length).toBe(human.length)
  expect(chat.filter((t) => READS.includes(t.name)).every((t) => t.kind === 'read')).toBe(true)
  expect(chat.filter((t) => t.kind === 'confirm' && t.name !== 'post_comment').map((t) => t.name).sort()).toEqual([...human].sort())
  for (const t of chat) expect(t.input_schema).toMatchObject({ type: 'object' })
})
