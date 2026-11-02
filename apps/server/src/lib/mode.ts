import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type { Payload } from 'payload'
import { parse } from 'yaml'

export type Mode = 'session' | 'autonomous'
const isMode = (v: unknown): v is Mode => v === 'session' || v === 'autonomous'

const workflowPath = () => resolve(process.env.BAUHERR_PACK_DIR ?? resolve(process.cwd(), '../../pack'), 'workflow.yaml')

export type PackStage = { name: string; mode?: unknown; gate?: string; production_gate?: string; exclude_labels?: string[]; steps?: { kind: string; skill?: string }[] }
let packStages: { path: string; stages: PackStage[] } | undefined

/** Stages of pack/workflow.yaml, read once per path; unreadable or malformed file yields []. */
export const packed = (): PackStage[] => {
  const path = workflowPath()
  if (packStages?.path !== path) {
    try {
      packStages = { path, stages: (parse(readFileSync(path, 'utf8')) as { stages?: PackStage[] }).stages ?? [] }
    } catch {
      return []
    }
  }
  return packStages.stages
}

export type HumanGate = 'refine' | 'plan' | 'staging' | 'production'

/** Whether `gate: human` is set on the optional `plan` or `release` stage of the workflow. */
export const gateOn = (stage: 'plan' | 'release'): boolean => packed().find((s) => s.name === stage)?.gate === 'human'

/** The workflow's production gate (`production_gate: human` on `release`); a Product's own `productionGate` adds to it. */
export const productionGateOn = (product: { productionGate?: boolean | null }): boolean => !!product.productionGate || packed().find((s) => s.name === 'release')?.production_gate === 'human'

/** Human gates the workflow enables, in flow order. `refine` is always on (Triage's questions); `plan` and `staging` are optional. */
export const humanGates = (): HumanGate[] => [
  'refine',
  ...(gateOn('plan') ? (['plan'] as const) : []),
  ...(gateOn('release') ? (['staging'] as const) : []),
  ...(packed().find((s) => s.name === 'release')?.production_gate === 'human' ? (['production'] as const) : []),
]

/** Stage names of pack/workflow.yaml, in order. */
export const workflowStages = (): string[] => packed().map((s) => s.name)

type WorkspaceModes = { defaultMode?: string | null; modeByStage?: Record<string, unknown> | null }

/** `modeFor` for an already loaded Workspace. */
export const resolveMode = (ws: WorkspaceModes, stage: string): Mode =>
  [ws.modeByStage?.[stage], ws.defaultMode, process.env.BAUHERR_DEFAULT_MODE, packed().find((s) => s.name === stage)?.mode].find(isMode) ?? 'autonomous'

/**
 * Mode a Run of `stage` starts in. Precedence: Workspace.modeByStage[stage], Workspace.defaultMode,
 * env BAUHERR_DEFAULT_MODE, `mode` of the stage in pack/workflow.yaml, else autonomous.
 */
export const modeFor = async (payload: Payload, workspace: number | string, stage: string): Promise<Mode> =>
  resolveMode((await payload.findByID({ collection: 'workspaces', id: workspace, depth: 0, overrideAccess: true })) as WorkspaceModes, stage)
