import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { askedOf as nominalAsked, needBy } from '../src/lib/addressee'
import { gateOn, humanGates, stagingGateOn } from '../src/lib/mode'
import { canSeeProduct, decidingAs, mayDecide, ownerAssigned } from '../src/lib/people'
import { formatDecision, parseDecisions } from '../src/app/(app)/lib/plan'
import { pointsOf } from '../src/lib/refine/model'
import { describeChanges } from '../src/lib/workflow-describe'
import * as e from '../src/lib/workflow-edit'
import { lint } from '../src/lib/workflow-rules'
import { checkpointBy, compile, gates, graph, parseFactory } from '../src/lib/workflow'

const file = (p: string) => readFileSync(fileURLToPath(new URL(p, import.meta.url)), 'utf8')
const shipped = file('../../../pack/factory.yaml')
const owner = file('./fixtures/owner-pack/factory.yaml')
const gated = file('./fixtures/gated-pack/factory.yaml')
const wf = (y: string) => compile(parseFactory(y))
const doc = (y: string) => {
  const d = e.readDraft(y)
  if (!d.ok) throw new Error(d.error)
  return d.doc
}
const stage = (y: string, n: string) => e.stagesOf(doc(y)).find((s) => s.name === n)!

describe('the factory file addresses checkpoints', () => {
  it('`gate: human` and a file without `by:` ask the Bauherr everywhere; compiled files carry nothing new, so applying the same file again is no new version', () => {
    const w = wf(gated)
    expect(['refine', 'plan', 'staging', 'production'].map((k) => checkpointBy(w, k as 'plan'))).toEqual(['bauherr', 'bauherr', 'bauherr', 'bauherr'])
    expect(JSON.stringify(w)).not.toMatch(/_by|"by"|refine_by/)
    expect(wf(gated.replace('gate: human', 'gate: {by: bauherr}'))).toEqual(w)
  })

  it('`by:` names the Product owner on plan, release, production, the refinement and a human step', () => {
    const w = wf(owner.replace('production_gate: human', 'production_gate: {by: product-owner}'))
    expect(w.stages.find((s) => s.name === 'plan')).toMatchObject({ gate: 'human', gate_by: 'product-owner' })
    expect(w.stages.find((s) => s.name === 'release')).toMatchObject({ gate: 'human', gate_by: 'product-owner', production_gate: 'human', production_gate_by: 'product-owner' })
    expect([checkpointBy(w, 'refine'), checkpointBy(w, 'human', 'signoff'), checkpointBy(w, 'human', 'review'), checkpointBy(wf(owner), 'production')]).toEqual(['product-owner', 'product-owner', 'bauherr', 'bauherr'])
    expect(graph(w).nodes.filter((n) => n.checkpoint && n.id.includes(':')).map((n) => n.id)).toEqual(['triage:refine', 'plan:gate', 'release:gate', 'release:production'])
  })

  it('lint accepts exactly the documented forms', () => {
    const bad = (mut: (d: any) => void) => {
      const d = doc(owner)
      mut(d)
      return lint(d)
    }
    const at = (d: any, n: string) => d.workflow.stages.find((s: any) => s.name === n)
    expect(bad((d) => (at(d, 'plan').gate = { by: 'nobody' }))).toEqual(['stage "plan": gate must be human or {by: bauherr | product-owner}'])
    expect(bad((d) => (at(d, 'plan').gate = { by: 'bauherr', fallback: 'x' }))).toEqual(['stage "plan": gate must be human or {by: bauherr | product-owner}'])
    expect(bad((d) => (at(d, 'build').gate = { by: 'bauherr' }))).toEqual(['stage "build": gate: human is only allowed on the plan and release stages'])
    expect(bad((d) => (at(d, 'plan').production_gate = 'human'))).toEqual(['stage "plan": production_gate: human is only allowed on the release stage'])
    expect(bad((d) => (at(d, 'release').production_gate = { by: 'x' }))).toEqual(['stage "release": production_gate must be human or {by: bauherr | product-owner}'])
    expect(bad((d) => (at(d, 'plan').refine = { by: 'product-owner' }))).toHaveLength(1)
    expect(bad((d) => (at(d, 'triage').refine = { by: 'sales' }))).toHaveLength(1)
    expect(bad((d) => (at(d, 'review').by = 'product-owner'))).toHaveLength(1)
    expect(bad((d) => (at(d, 'signoff').by = 'sales'))).toHaveLength(1)
    expect(lint(doc(owner))).toEqual([])
  })

  it('the shipped default: refinement and staging acceptance ask the Product owner (staging per Product), plans and production the Bauherr', () => {
    const w = wf(shipped)
    expect(['refine', 'plan', 'staging', 'production'].map((k) => checkpointBy(w, k as 'plan'))).toEqual(['product-owner', 'bauherr', 'product-owner', 'bauherr'])
    expect(gates(w)).toEqual({ plan: true, staging: true, production: true })
    // `gateOn` and `humanGates` are the unconditional gates: without a Product owner who tests there is no acceptance checkpoint, as before
    expect(gateOn(w, 'release')).toBe(false)
    expect(humanGates(w)).toEqual(['refine', 'plan', 'production'])
  })

  it('every preset compiles; Standard asks like the default, Careful keeps its own staging acceptance for the Bauherr, Solo asks the Bauherr', () => {
    const preset = (n: string) => wf(file(`../../../pack/presets/${n}.yaml`).replace(/profile_file: .*\n|, profile_file: [^}]*/g, ''))
    expect(['refine', 'plan', 'staging'].map((k) => checkpointBy(preset('standard'), k as 'plan'))).toEqual(['product-owner', 'bauherr', 'product-owner'])
    expect(['refine', 'staging'].map((k) => checkpointBy(preset('careful'), k as 'plan'))).toEqual(['product-owner', 'bauherr'])
    expect(gateOn(preset('careful'), 'release')).toBe(true)
    expect(['refine', 'plan', 'production'].map((k) => checkpointBy(preset('solo'), k as 'plan'))).toEqual(['bauherr', 'bauherr', 'bauherr'])
  })
})

describe('staging acceptance by the Product owner is decided per Product', () => {
  const w = wf(shipped)
  it('only with an assigned Product owner and the Product switch on', () => {
    expect([[true, true], [true, false], [false, true], [false, false]].map(([sw, assigned]) => stagingGateOn(w, { productOwnerTestsStaging: sw }, assigned!))).toEqual([true, false, false, false])
    expect(humanGates(w, true)).toEqual(['refine', 'plan', 'staging', 'production'])
  })
  it('asking the Bauherr is for every Product, whatever the switch says; no release gate asks nobody', () => {
    expect(stagingGateOn(wf(gated), { productOwnerTestsStaging: false }, false)).toBe(true)
    expect(stagingGateOn(wf(file('./fixtures/bare-pack/factory.yaml')), { productOwnerTestsStaging: true }, true)).toBe(false)
  })
  it('a Product has an owner when one of the accounts reaches it', () => {
    const owners = [{ role: 'product-owner', assignments: [{ workspace: 1, scope: 'products', products: [7] }] }]
    expect([7, 8].map((id) => ownerAssigned(owners, { id, workspace: 1 }))).toEqual([true, false])
  })
})

describe('whom a need asks', () => {
  const w = wf(owner)
  it('maps each checkpoint need to the checkpoint of the file, every other need to the Bauherr', () => {
    expect(['Answer questions', 'Approve plan', 'Answer decisions', 'Accept on staging', 'Staging not confirmed', 'Approve production', 'Production deploy failed', 'Configure production checks', 'Run failed', 'Needs you', 'Expedite?'].map((n) => needBy(w, n))).toEqual(['product-owner', 'product-owner', 'product-owner', 'product-owner', 'product-owner', 'bauherr', 'bauherr', 'bauherr', 'bauherr', 'bauherr', 'bauherr'])
    expect([needBy(w, 'Decision needed', 'signoff'), needBy(w, 'Decision needed', 'review')]).toEqual(['product-owner', 'bauherr'])
  })
  it('falls back to the Bauherr when the Product has no Product owner', () => {
    expect([nominalAsked('product-owner', false), nominalAsked('product-owner', true), nominalAsked('bauherr', false)]).toEqual(['bauherr', 'product-owner', 'bauherr'])
  })
})

describe('mayDecide', () => {
  const ticket = { product: 7, workspace: 1 }
  const po = { role: 'product-owner', assignments: [{ workspace: 1, scope: 'products', products: [7] }] }
  const bauherr = { role: 'bauherr', tenants: [{ tenant: 1 }] }
  it('a Product owner decides only what is addressed to them on a Product of their assignment', () => {
    expect(mayDecide(po, { ticket, addressee: 'product-owner' })).toBe(true)
    expect(mayDecide(po, { ticket, addressee: 'bauherr' })).toBe(false)
    expect(mayDecide(po, { ticket: { product: 8, workspace: 1 }, addressee: 'product-owner' })).toBe(false)
    expect(mayDecide(po, { ticket: { product: 7, workspace: 2 }, addressee: 'product-owner' })).toBe(false)
    expect(mayDecide({ ...po, assignments: [{ workspace: 1, scope: 'products', products: [] }] }, { ticket, addressee: 'product-owner' })).toBe(false)
    expect(mayDecide({ ...po, assignments: [{ workspace: 1, scope: 'workspace', products: [] }] }, { ticket: { product: 99, workspace: 1 }, addressee: 'product-owner' })).toBe(true)
  })
  it('a Bauherr decides everything of their Workspaces, an Admin everything; a stranger nothing', () => {
    for (const addressee of ['bauherr', 'product-owner'] as const) {
      expect(mayDecide(bauherr, { ticket, addressee })).toBe(true)
      expect(mayDecide({ role: 'admin' }, { ticket, addressee })).toBe(true)
      expect(mayDecide(bauherr, { ticket: { product: 7, workspace: 2 }, addressee })).toBe(false)
      expect(mayDecide({ role: 'nobody' }, { ticket, addressee })).toBe(false)
      expect(mayDecide(null as never, { ticket, addressee })).toBe(false)
    }
    expect(canSeeProduct(po, { id: 7, workspace: 1 })).toBe(true)
  })
  it('records a Bauherr or Admin as bauherr, also where they step in for the Product owner', () => {
    expect([decidingAs(bauherr), decidingAs({ role: 'admin' }), decidingAs(po)]).toEqual(['bauherr', 'bauherr', 'product-owner'])
  })
})

describe('decision rows carry `for:`', () => {
  const row = { id: 'D1', title: 'Which label?', critical: true, default: 'Short', options: ['Short', 'Long'] }
  it('round-trips through the canonical row; a row without it stays without it', () => {
    expect(parseDecisions(`## Decisions\n${formatDecision({ ...row, for: 'bauherr' })}`)).toEqual([{ ...row, for: 'bauherr' }])
    expect(parseDecisions(`## Decisions\n${formatDecision({ ...row, for: 'product-owner' })}`)[0]).toMatchObject({ for: 'product-owner', critical: true, default: 'Short' })
    expect(parseDecisions(`## Decisions\n${formatDecision(row)}`)[0]).not.toHaveProperty('for')
  })
  it('reads `for` in the bullet form and as the sixth column of a table row', () => {
    const rows = parseDecisions('## Decisions\n- **D1 Storage, critical**. Default: postgres. Alternative: files. for: bauherr.\n- **D2** Copy? Alternatives: terse. Default: friendly. Why: tone. critical: false. for: product-owner.\n| D3 | Which icon? | a / b | a | because | yes | product-owner |\n| D4 | Plain | a / b | a | because | no |')
    expect(rows.map((r) => [r.id, r.for ?? null, r.critical])).toEqual([['D1', 'bauherr', true], ['D2', 'product-owner', false], ['D3', 'product-owner', true], ['D4', null, false]])
    expect(rows[1]).toMatchObject({ title: 'Copy?', default: 'friendly', why: 'tone' })
  })
  it('points default to whom the checkpoint asks, and `for:` wins', () => {
    const sheet = [{ ...row, id: 'D1', for: 'bauherr' as const }, { ...row, id: 'D2' }]
    expect(pointsOf(sheet, [], {}, null, 'product-owner').map((p) => [p.id, p.for])).toEqual([['D1', 'bauherr'], ['D2', 'product-owner']])
    expect(pointsOf(sheet, [], {}, null).map((p) => p.for)).toEqual(['bauherr', 'bauherr'])
  })
})

describe('the editor sets whom a checkpoint asks', () => {
  it('writes `{by: product-owner}` and goes back to the plain forms for the Bauherr', () => {
    let y = e.setAsked(shipped, 'plan', 'plan', 'product-owner')
    expect(stage(y, 'plan').gate).toEqual({ by: 'product-owner' })
    expect(e.askedOf(stage(y, 'plan'), 'plan')).toBe('product-owner')
    expect(e.checkpointOn(stage(y, 'plan'), 'plan')).toBe(true)
    expect(y).toContain('# The factory: the team and the workflow')
    expect(lint(doc(y))).toEqual([])
    y = e.setAsked(y, 'plan', 'plan', 'bauherr')
    expect(stage(y, 'plan').gate).toBe('human')
    y = e.setAsked(y, 'refine', 'triage', 'bauherr')
    expect(stage(y, 'triage').refine).toBeUndefined()
    y = e.setAsked(e.setAsked(y, 'production', 'release', 'product-owner'), 'staging', 'release', 'bauherr')
    expect([stage(y, 'release').production_gate, stage(y, 'release').gate]).toEqual([{ by: 'product-owner' }, 'human'])
    expect(lint(doc(y))).toEqual([])
    const withHuman = e.setAsked(owner, 'human', 'signoff', 'bauherr')
    expect(stage(withHuman, 'signoff').by).toBeUndefined()
    expect(stage(e.setAsked(withHuman, 'human', 'signoff', 'product-owner'), 'signoff').by).toBe('product-owner')
  })
  it('lists every checkpoint with whom it asks, and switching one off drops its `by`', () => {
    expect(e.checkpointsOf(doc(owner)).map((c) => [c.key, c.on, c.by])).toEqual([['refine', true, 'product-owner'], ['plan', true, 'product-owner'], ['human', true, 'product-owner'], ['staging', true, 'product-owner'], ['production', true, 'bauherr']])
    const off = e.setCheckpoint(owner, 'plan', false)
    expect(stage(off, 'plan').gate).toBeUndefined()
    expect(e.checkpointsOf(doc(off)).find((c) => c.key === 'plan')).toMatchObject({ on: false, by: 'bauherr' })
  })
  it('the change list says who is asked now, and does not report an unchanged `{by}` gate as a new one', () => {
    const asks = e.setAsked(shipped, 'plan', 'plan', 'product-owner')
    expect(describeChanges(doc(shipped), doc(asks))).toEqual(['Plan: approving the plan is now asked of the Product owner instead of the Bauherr'])
    expect(describeChanges(doc(asks), doc(asks))).toEqual([])
    expect(describeChanges(doc(shipped), doc(e.setAsked(shipped, 'refine', 'triage', 'bauherr')))).toEqual(['Triage: answering open questions is now asked of the Bauherr instead of the Product owner'])
    expect(describeChanges(doc(owner), doc(e.setAsked(owner, 'human', 'signoff', 'bauherr')))).toEqual(['Sign-off: the decision is now asked of the Bauherr instead of the Product owner'])
  })
})

describe('stored workflow versions keep working', () => {
  it('a compiled version of before this change (no `by`, `gate: human`) decides every checkpoint for the Bauherr', () => {
    const stored = JSON.parse(JSON.stringify(wf(gated))) as ReturnType<typeof wf>
    expect(['refine', 'plan', 'staging', 'production'].map((k) => checkpointBy(stored, k as 'plan'))).toEqual(['bauherr', 'bauherr', 'bauherr', 'bauherr'])
    expect(gateOn(stored, 'release')).toBe(true)
    expect(humanGates(stored)).toEqual(['refine', 'plan', 'staging'])
  })
  it('the hash of a file that does not use `by:` is the one it had before', () => {
    const hash = (v: unknown) => createHash('sha256').update(JSON.stringify(v)).digest('hex')
    expect(hash(wf(gated))).toBe(hash(wf(gated.replace('gate: human', 'gate: {by: bauherr}'))))
  })
})
