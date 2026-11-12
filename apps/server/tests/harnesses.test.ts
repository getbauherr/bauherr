import { expect, it } from 'vitest'
import { HARNESSES, harnessOf, sessionName, type Ctx } from '../src/app/(app)/lib/harnesses'
import { modelOptions } from '../src/app/(app)/lib/models'

const ctx: Ctx = { gateway: 'http://127.0.0.1:4000', mcp: 'http://localhost:3000/mcp', workspace: 'acme', session: 'engineer-3fa9', role: 'engineer', models: { cheap: 'ws-acme/anthropic/claude-haiku-5-5', standard: 'ws-acme/anthropic/claude-sonnet-5-5', strong: 'ws-acme/anthropic/claude-opus-5-5' } }

it('every tool that can go through the gateway names the session, the role and the gateway address; none renders a key', () => {
  for (const h of HARNESSES.filter((x) => x.level !== 'none')) {
    for (const route of h.routes) {
      const text = h.blocks(ctx, route).map((b) => b.text).join('\n')
      expect(text, `${h.id}/${route}`).toContain('127.0.0.1:4000')
      expect(text, `${h.id}/${route}`).not.toMatch(/sk-bauherr|bha_[A-Za-z0-9]/)
      if (h.level === 'session') {
        expect(text, h.id).toContain('engineer-3fa9')
        expect(text, h.id).toContain('engineer')
      }
      if (!['aider', 'claude-desktop'].includes(h.id)) expect(text, h.id).toContain('localhost:3000/mcp')
    }
  }
})

it('tools that cannot send a header are measured per key only and Cursor is not measurable', () => {
  expect(HARNESSES.filter((h) => h.level === 'key').map((h) => h.id)).toEqual(['gemini-cli', 'copilot-cli', 'cline'])
  const cursor = harnessOf('cursor')
  expect(cursor.level).toBe('none')
  expect(cursor.blocks(ctx, 'api-key')).toEqual([])
})

it('Claude Code keeps the subscription login (gateway key only in a header) or uses the Workspace key with the tier models', () => {
  const claude = harnessOf('claude-code')
  const sub = claude.blocks(ctx, 'subscription').map((b) => b.text).join('\n')
  expect(sub).toContain('ANTHROPIC_CUSTOM_HEADERS')
  expect(sub).toContain('x-agw-key: %s')
  expect(sub).not.toContain('ANTHROPIC_AUTH_TOKEN')
  const key = claude.blocks(ctx, 'api-key').map((b) => b.text).join('\n')
  expect(key).toContain('ANTHROPIC_AUTH_TOKEN="$BAUHERR_GATEWAY_KEY"')
  expect(key).toContain('ANTHROPIC_DEFAULT_OPUS_MODEL=ws-acme/anthropic/claude-opus-5-5')
  expect(key).not.toContain('x-agw-key')
})

it('without a Connection the model lines are placeholders, and a session name is the role plus the roll', () => {
  expect(harnessOf('claude-code').blocks({ ...ctx, models: null }, 'api-key').map((b) => b.text).join('\n')).toContain('ws-acme/<connection>/<cheap model>')
  expect(sessionName('Reviewer', '3FA9')).toBe('reviewer-3fa9')
  expect(sessionName('a b', '1')).toBe('a-b-1')
})

it('the model list offers defaults and non-deprecated catalog models, keeps a gone model selectable and never alters the selection', () => {
  const listed = [
    { provider: 'anthropic', id: 'claude-new-1', name: 'Claude New 1', deprecated: false },
    { provider: 'anthropic', id: 'claude-old-1', name: 'Claude Old 1', deprecated: true },
    { provider: 'openai', id: 'gpt-x', name: 'GPT X', deprecated: false },
  ]
  const opts = modelOptions('anthropic', ['claude-sonnet-5-5'], listed, ['claude-old-1', 'claude-sonnet-5-5'])!
  expect(opts.map((o) => (Array.isArray(o) ? o[0] : o))).toEqual(['claude-sonnet-5-5', 'claude-new-1', 'claude-old-1'])
  expect(opts[0]).toBe('claude-sonnet-5-5')
  expect(opts[1]).toEqual(['claude-new-1', 'Claude New 1 (claude-new-1)'])
  expect(opts[2]![1]).toMatch(/no longer in the price catalog/)
  expect(modelOptions('greenpt', [], listed, [])).toBeNull()
  expect(modelOptions('openai', [], [], ['whatever'])).toEqual(null)
})
