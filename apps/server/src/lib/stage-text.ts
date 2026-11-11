import { kindOf, stage, wipStages, type Workflow } from './workflow'

const SYSTEM_RUN_STAGES = ['scan', 'distill']

const NAME = /^[a-z][a-z0-9-]*$/

/** `true`, or the finding: a Run's stage is a stage of the workflow or a system Run stage. Without a workflow (the Workspace is not known) any syntactically valid stage name passes, so an apply-time rewrite is never blocked by a stale validator. */
export const runStageError = (wf: Workflow | undefined, v: unknown): true | string =>
  typeof v === 'string' && ((wf ? stage(wf, v) : NAME.test(v)) || SYSTEM_RUN_STAGES.includes(v)) ? true : `"${String(v)}" is not a stage of the workflow`

/** `true`, or the finding: a Ticket waits for a column with a WIP limit or for checks. Without a workflow any valid stage name passes. */
export const waitingForError = (wf: Workflow | undefined, v: unknown): true | string =>
  v == null || (typeof v === 'string' && (v === 'checks' || (wf ? wipStages(wf).includes(v) : NAME.test(v)))) ? true : `"${String(v)}" is not a waitable stage of the workflow`

/** The stage kind of a Run's stage; the system Run stages are their own kind. */
export const runKind = (wf: Workflow, v: string): string | undefined => (SYSTEM_RUN_STAGES.includes(v) ? v : kindOf(wf, v))

/** The kind of a Run: its recorded kind, or the stage's kind for Runs created before `kind` existed. */
export const kindOfRun = (wf: Workflow, run: Record<string, any>): string | undefined => (run.kind as string | null | undefined) ?? runKind(wf, String(run.stage))
