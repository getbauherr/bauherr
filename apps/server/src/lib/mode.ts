import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type { Payload } from 'payload'
import { parse } from 'yaml'

export type Mode = 'session' | 'autonomous'
const isMode = (v: unknown): v is Mode => v === 'session' || v === 'autonomous'

const WORKFLOW = resolve(process.env.BAUHERR_PACK_DIR ?? resolve(process.cwd(), '../../pack'), 'workflow.yaml')

export type PackStage = { name: string; mode?: unknown; gate_before?: string; steps?: { kind: string; skill?: string }[] }
let packStages: PackStage[] | undefined

/** Stages of pack/workflow.yaml, read once; unreadable or malformed file yields []. */
const packed = (): PackStage[] => {
  try {
    return (packStages ??= (parse(readFileSync(WORKFLOW, 'utf8')) as { stages?: PackStage[] }).stages ?? [])
  } catch {
    return []
  }
}

/** Stages of pack/workflow.yaml with their steps, in order. */
export const workflowPack = (): PackStage[] => packed()

/** Stage names of pack/workflow.yaml, in order. */
export const workflowStages = (): string[] => packed().map((s) => s.name)

/**
 * Mode a Run of `stage` starts in. Precedence: Workspace.modeByStage[stage], Workspace.defaultMode,
 * env BAUHERR_DEFAULT_MODE, `mode` of the stage in pack/workflow.yaml, else autonomous.
 */
export const modeFor = async (payload: Payload, workspace: number | string, stage: string): Promise<Mode> => {
  const ws = (await payload.findByID({ collection: 'workspaces', id: workspace, depth: 0, overrideAccess: true })) as {
    defaultMode?: string | null
    modeByStage?: Record<string, unknown> | null
  }
  return [ws.modeByStage?.[stage], ws.defaultMode, process.env.BAUHERR_DEFAULT_MODE, packed().find((s) => s.name === stage)?.mode].find(isMode) ?? 'autonomous'
}
