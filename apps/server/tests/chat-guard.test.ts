import { beforeAll, expect, it } from 'vitest'

let chatTools: typeof import('../src/lib/chat/tools').chatTools
let kindOf: typeof import('../src/lib/chat/tools').kindOf
let tools: typeof import('../src/lib/mcp-tools').tools
beforeAll(async () => {
  process.env.PAYLOAD_SECRET ??= 'test-secret'
  process.env.ENCRYPTION_KEY ??= 'test-key'
  chatTools = (await import('../src/lib/chat/tools')).chatTools
  kindOf = (await import('../src/lib/chat/tools')).kindOf
  tools = (await import('../src/lib/mcp-tools')).tools
})

const READS = ['list_frontier', 'get_ticket', 'read_worklog', 'read_knowledge', 'search_knowledge']

it('exposes no session-run tool: of the agent MCP tools only the five read tools', () => {
  const exposed = chatTools({ role: 'admin' }).map((t) => t.name)
  const agent = tools.filter((t) => t.access === 'agent').map((t) => t.name)
  expect(exposed.filter((n) => agent.includes(n)).sort()).toEqual([...READS].sort())
  for (const run of ['claim_run', 'claim_next', 'heartbeat', 'report_step', 'attach_evidence', 'submit_plan', 'submit_investigation', 'submit_review', 'submit_triage', 'request_review', 'run_checks', 'finish_run', 'relink_mr', 'release_run', 'post_staging_summary', 'return_to_build', 'update_worklog', 'load_skill']) expect(exposed).not.toContain(run)
})

it('every human MCP tool that is exposed needs a confirmation, every agent read tool is a read, and each tool has a schema', () => {
  const human = tools.filter((t) => t.access === 'human').map((t) => t.name)
  const chat = chatTools({ role: 'admin' })
  expect(chat.filter((t) => human.includes(t.name)).every((t) => t.kind === 'confirm')).toBe(true)
  expect(chat.filter((t) => human.includes(t.name)).length).toBe(human.length)
  expect(chat.filter((t) => READS.includes(t.name)).every((t) => t.kind === 'read')).toBe(true)
  expect(chat.filter((t) => t.kind === 'confirm' && t.name !== 'post_comment').map((t) => t.name).sort()).toEqual([...human].sort())
  for (const t of chat) expect(t.input_schema).toMatchObject({ type: 'object' })
})

it('offers a member no Admin-only tool, and nobody the server-issued submit_request', () => {
  const member = chatTools({ role: 'bauherr' }).map((t) => t.name)
  expect(member).not.toContain('approve_skill_proposal')
  expect(member).not.toContain('reject_skill_proposal')
  expect(member).toContain('approve')
  expect(chatTools({ role: 'admin' }).map((t) => t.name)).toContain('approve_skill_proposal')
  for (const user of [{ role: 'admin' }, { role: 'bauherr' }]) {
    expect(chatTools(user).map((t) => t.name)).not.toContain('submit_request')
    expect(kindOf('submit_request', user)).toBeUndefined()
  }
  expect(kindOf('approve_skill_proposal', { role: 'bauherr' })).toBeUndefined()
  expect(kindOf('approve_skill_proposal', { role: 'admin' })).toBe('confirm')
})
