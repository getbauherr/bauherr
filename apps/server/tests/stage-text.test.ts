import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { expect, it } from 'vitest'
import { runKind, runStageError, waitingForError } from '../src/lib/stage-text'
import * as w from '../src/lib/workflow'

const doc = () => w.parseFactory(readFileSync(fileURLToPath(new URL('../../../pack/factory.yaml', import.meta.url)), 'utf8')) as any
const base = w.compile(doc())
const custom = (() => {
  const d = doc()
  const i = d.workflow.stages.findIndex((s: any) => s.name === 'build')
  d.workflow.stages[i].outcomes.done = 'qa'
  d.workflow.stages.splice(i + 1, 0, { name: 'qa', kind: 'agent', role: 'engineer', skill: 'review', outcomes: { done: 'review' } })
  return w.compile(d)
})()

it('a Run stage must be a workflow stage or scan / distill', () => {
  for (const s of ['triage', 'plan', 'build', 'review', 'scan', 'distill']) expect(runStageError(base, s)).toBe(true)
  expect(runStageError(base, 'qa')).not.toBe(true)
  expect(runStageError(base, 'nope')).not.toBe(true)
  expect(runStageError(base, undefined)).not.toBe(true)
  expect(runStageError(custom, 'qa')).toBe(true)
})

it('waitingFor must be a waitable stage, checks or empty', () => {
  for (const s of [null, undefined, 'plan', 'build', 'review', 'checks']) expect(waitingForError(base, s)).toBe(true)
  expect(waitingForError(base, 'qa')).not.toBe(true)
  expect(waitingForError(base, 'triage')).not.toBe(true)
  expect(waitingForError(custom, 'qa')).toBe(true)
})

it('the Run kind is the stage kind; scan and distill are their own', () => {
  expect(runKind(custom, 'qa')).toBe('agent')
  expect(runKind(base, 'build')).toBe('build')
  expect(runKind(base, 'scan')).toBe('scan')
  expect(runKind(base, 'distill')).toBe('distill')
  expect(runKind(base, 'nope')).toBeUndefined()
})
