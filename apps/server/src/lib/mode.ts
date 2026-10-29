import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type { Payload } from 'payload'
import { parse } from 'yaml'

export type Mode = 'session' | 'autonomous'
const isMode = (v: unknown): v is Mode => v === 'session' || v === 'autonomous'

const WORKFLOW = resolve(process.env.BAUHERR_PACK_DIR ?? resolve(process.cwd(), '../../pack'), 'workflow.yaml')

/**
 * Mode a Run of `stage` starts in. Precedence: Workspace.modeByStage[stage], Workspace.defaultMode,
 * env BAUHERR_DEFAULT_MODE, `mode` of the stage in pack/workflow.yaml, else autonomous.
 */
export const modeFor = async (payload: Payload, workspace: number | string, stage: string): Promise<Mode> => {
  const ws = (await payload.findByID({ collection: 'workspaces', id: workspace, depth: 0, overrideAccess: true })) as {
    defaultMode?: string | null
    modeByStage?: Record<string, unknown> | null
  }
  const packed = (parse(readFileSync(WORKFLOW, 'utf8')) as { stages?: { name: string; mode?: unknown }[] }).stages?.find((s) => s.name === stage)?.mode
  return [ws.modeByStage?.[stage], ws.defaultMode, process.env.BAUHERR_DEFAULT_MODE, packed].find(isMode) ?? 'autonomous'
}
