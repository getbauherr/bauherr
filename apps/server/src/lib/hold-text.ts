import type { NextStep } from './next-step'

export const fastLaneText = (holder: number): string => `Waiting for the fast lane: #${holder} holds it.`
export const overlapText = (stageTitle: string, holder: number): string => `Queued for ${stageTitle}: waits for #${holder}, which changes the same files.`

export const fastLaneStep = (next: NextStep, holder: number): NextStep => ({ ...next, label: 'Queued', enabled: false, reason: fastLaneText(holder), links: [] })
