import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type { Payload, PayloadRequest } from 'payload'
import { parse } from 'yaml'
import { DEFAULT, gates, order } from './workflow'

export type Mode = 'session' | 'autonomous'
const isMode = (v: unknown): v is Mode => v === 'session' || v === 'autonomous'

const packDir = () => process.env.BAUHERR_PACK_DIR ?? resolve(process.cwd(), '../../pack')

export type PackStage = { name: string; kind?: string; mode?: unknown; gate?: string; production_gate?: string; exclude_labels?: string[]; steps?: { kind: string; skill?: string }[] }
let packStages: { path: string; stages: PackStage[] } | undefined

/** Non-container stages of pack/factory.yaml, then those of the optional pack/workflow-security.yaml (not Board columns), read once per path; a bad security file adds nothing. */
export const packed = (): PackStage[] => {
  const path = resolve(packDir(), 'factory.yaml')
  if (packStages?.path !== path) {
    const security = (() => {
      try {
        return (parse(readFileSync(resolve(packDir(), 'workflow-security.yaml'), 'utf8')) as { stages?: PackStage[] }).stages ?? []
      } catch {
        return []
      }
    })()
    const core = DEFAULT()
      .stages.filter((s) => s.kind !== 'container')
      .map(({ name, kind, mode, gate, production_gate, exclude_labels, skill }) => ({ name, kind, mode, gate, production_gate, exclude_labels, ...(skill && { steps: [{ kind: 'agent-run', skill }] }) }))
    packStages = { path, stages: [...core, ...security] }
  }
  return packStages.stages
}

export type HumanGate = 'refine' | 'plan' | 'staging' | 'production'

/** Whether `gate: human` is set on the optional `plan` or `release` stage of the workflow. */
export const gateOn = (stage: 'plan' | 'release'): boolean => gates(DEFAULT())[stage === 'plan' ? 'plan' : 'staging']

/** Production gate: on by default (`production_gate: human` on `release`); a Product can also turn it on itself. Without `productionChecks` it is not skipped but shown as a "Configure production checks" gate. */
export const productionGateOn = (product: { productionGate?: boolean | null } = {}): boolean => gates(DEFAULT()).production || !!product.productionGate

/** Whether the Product can observe a production deploy (`beginProduction` needs it). */
export const hasProductionChecks = (product: { productionChecks?: string | null }): boolean => !!product.productionChecks?.trim()

/** Human gates the workflow enables, in flow order. `refine` is always on (Triage's questions); `plan` and `staging` are optional; `production` is on unless `production_gate` is removed from `release`. */
export const humanGates = (): HumanGate[] => [
  'refine',
  ...(gateOn('plan') ? (['plan'] as const) : []),
  ...(gateOn('release') ? (['staging'] as const) : []),
  ...(productionGateOn() ? (['production'] as const) : []),
]

/** Stage names of pack/factory.yaml, in order. */
export const workflowStages = (): string[] => order(DEFAULT())

type WorkspaceModes = { defaultMode?: string | null; modeByStage?: Record<string, unknown> | null }

/** `modeFor` for an already loaded Workspace. A `scan` Run is always autonomous: only the Runner gives it read-only tools, the fence and the findings path. */
export const resolveMode = (ws: WorkspaceModes, stage: string): Mode =>
  stage === 'scan' ? 'autonomous' : [ws.modeByStage?.[stage], ws.defaultMode, process.env.BAUHERR_DEFAULT_MODE, packed().find((s) => s.name === stage)?.mode].find(isMode) ?? 'autonomous'

/**
 * Mode a Run of `stage` starts in. Precedence: Workspace.modeByStage[stage], Workspace.defaultMode,
 * env BAUHERR_DEFAULT_MODE, `mode` of the stage in pack/factory.yaml, else autonomous.
 */
export const modeFor = async (payload: Payload, workspace: number | string, stage: string, req?: Partial<PayloadRequest>): Promise<Mode> =>
  resolveMode((await payload.findByID({ collection: 'workspaces', id: workspace, depth: 0, overrideAccess: true, req })) as WorkspaceModes, stage)
