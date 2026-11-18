import { kindOf, stage, wipStages, type Workflow } from './workflow'

const SYSTEM_RUN_STAGES = ['scan', 'docs', 'distill']

const NAME = /^[a-z][a-z0-9-]*$/

export const runStageError = (wf: Workflow | undefined, v: unknown): true | string =>
  typeof v === 'string' && ((wf ? stage(wf, v) : NAME.test(v)) || SYSTEM_RUN_STAGES.includes(v)) ? true : `"${String(v)}" is not a stage of the workflow`

export const waitingForError = (wf: Workflow | undefined, v: unknown): true | string =>
  v == null || (typeof v === 'string' && (v === 'checks' || (wf ? wipStages(wf).includes(v) : NAME.test(v)))) ? true : `"${String(v)}" is not a waitable stage of the workflow`

export const runKind = (wf: Workflow, v: string): string | undefined => (SYSTEM_RUN_STAGES.includes(v) ? v : kindOf(wf, v))

export const kindOfRun = (wf: Workflow, run: Record<string, any>): string | undefined => (run.kind as string | null | undefined) ?? runKind(wf, String(run.stage))

export const ACTIVITY: Record<string, string> = { triage: 'triaging', plan: 'planning', build: 'building', review: 'reviewing', release: 'deploying', agent: 'working' }
export const activityOf = (kind: string | undefined): string => (kind && ACTIVITY[kind]) || 'running a step'
