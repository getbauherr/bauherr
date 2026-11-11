import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { test } from 'node:test'
import { avoidTerms, formatFindings, lintPack } from '../src/lint.js'

const factory = (tier: string) => `version: 1\nteam:\n  roles:\n    engineer: {title: Engineer, skills: [Small diffs], tier: ${tier}}\n`
const SPEC = '| Role | Tier |\n|---|---|\n| engineer | cheap |\n'
const CONTEXT = '**Bauherr**:\nA person.\n_Avoid_: Project owner, owner (bare), Operator\n'

/** A small clean pack plus the glossary and the spec; `files` adds or replaces pack files. */
const fixture = (files: Record<string, string> = {}, spec = SPEC) => {
  const root = mkdtempSync(join(tmpdir(), 'bauherr-lint-'))
  const all: Record<string, string> = { 'factory.yaml': factory('cheap'), 'rules/a.md': '# A\nSee `skills/s/SKILL.md`.\n', 'skills/s/SKILL.md': '# S\n', ...files }
  for (const [f, text] of Object.entries(all)) {
    mkdirSync(dirname(join(root, 'pack', f)), { recursive: true })
    writeFileSync(join(root, 'pack', f), text)
  }
  writeFileSync(join(root, 'CONTEXT.md'), CONTEXT)
  writeFileSync(join(root, 'spec.md'), spec)
  return { packDir: join(root, 'pack'), contextFile: join(root, 'CONTEXT.md'), specFile: join(root, 'spec.md') }
}
const msgs = (o: ReturnType<typeof fixture>) => lintPack(o).map((f) => `${f.file.replace(/^.*\/pack\//, '')}:${f.line}: ${f.msg}`)

test('a clean pack has no findings, and an empty stacks folder is fine', () => {
  const o = fixture({ 'stacks/.gitkeep.md': '' })
  assert.deepEqual(msgs(o), [])
})

test('size caps: too many lines and too many bytes', () => {
  const o = fixture({ 'roles/big.md': 'x\n'.repeat(41), 'rules/fat.md': `${'y'.repeat(4001)}\n` })
  assert.deepEqual(msgs(o), [
    'roles/big.md:41: The role profile has 41 lines; the cap for a role profile is 40. Split it or cut it.',
    'rules/fat.md:1: The rule is 4002 bytes; the cap for a rule is 4000. Split it or cut it.',
  ])
})

test('cited paths: a missing pack path and a broken relative link are found, Product paths are not', () => {
  const o = fixture({ 'rules/b.md': 'Read `rules/nope.md`, [x](../skills/gone/SKILL.md), `docs/ui.md`, `.bauherr/plan.md`, [spec](../../docs/spec.md).\n' })
  assert.deepEqual(msgs(o), [
    'rules/b.md:1: It cites rules/nope.md, which does not exist in the pack.',
    'rules/b.md:1: It links ../skills/gone/SKILL.md, which does not exist in the pack.',
  ])
})

test('Avoid terms: only unqualified multi-word terms are checked', () => {
  assert.deepEqual(avoidTerms('_Avoid_: Project owner, owner (bare), Operator, Depends on, Screen state (x, y)\n'), ['Project owner', 'Depends on'])
  const o = fixture({ 'rules/b.md': 'Ask the project  owner. The owner of a lane. An operator.\n' })
  assert.deepEqual(msgs(o), ['rules/b.md:1: It uses "Project owner", which ' + o.contextFile + ' lists under Avoid.'])
})

test('tiers: a factory file or preset that differs from the spec table is found', () => {
  const o = fixture({ 'presets/p.yaml': factory('strong') })
  assert.deepEqual(msgs(o), ['presets/p.yaml:4: Role engineer has tier strong, but the tier table of ' + o.specFile + ' says cheap.'])
})

test('tiers: a missing table is one finding on the spec, an unknown role is found', () => {
  const none = fixture({}, 'no table')
  assert.deepEqual(lintPack(none).map((f) => [f.file === none.specFile, f.line]), [[true, 1]])
  const o = fixture({ 'presets/q.yaml': 'version: 1\nteam:\n  roles:\n    tester: {title: T, tier: cheap}\n' })
  assert.deepEqual(msgs(o), ['presets/q.yaml:4: Role tester is not in the tier table of ' + o.specFile + '.'])
})

test('stack names are found in the core and allowed under stacks/', () => {
  const o = fixture({ 'roles/x.md': 'Write TypeScript or Next.js, not JavaScripty things.\n', 'stacks/laravel/rules/l.md': 'Use PHP and Laravel.\n' })
  assert.deepEqual(msgs(o), ['roles/x.md:1: It names TypeScript; stack names belong under stacks/, not in the core pack.', 'roles/x.md:1: It names Next.js; stack names belong under stacks/, not in the core pack.'])
})

test('hook citations: a stub or missing hook cited as enforcement is found, a "not active" mention is not', () => {
  const o = fixture({
    'hooks/guard.ts': '// TODO real check\n',
    'hooks/real.ts': '// done\n',
    'rules/b.md': 'Enforced by `hooks/guard.ts`.\nSee hooks/real.ts.\nSee hooks/ghost.sh.\nhooks/guard.ts is not active.\n',
  })
  assert.deepEqual(msgs(o), [
    'rules/b.md:3: It cites hooks/ghost.sh, which does not exist in the pack.',
    'rules/b.md:1: It cites hooks/guard.ts as enforcement, but that hook is a stub (TODO or not active). Say what enforces it today.',
  ])
})

test('formatFindings prints file:line: sentence', () => {
  assert.equal(formatFindings([{ file: 'pack/a.md', line: 3, msg: 'Bad.' }]), 'pack/a.md:3: Bad.')
})
