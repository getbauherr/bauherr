'use client'
import type { Opening } from '../../../../core/retro/schema'
import { Figures } from './RetroFigures'
import { PreparingOpening } from './PreparingOpening'

export function Preparing({ retro, opening }: { retro: number; opening: Opening }) {
  return (
    <div className="grid gap-4 px-2">
      <Figures opening={opening} />
      <PreparingOpening retro={retro} />
    </div>
  )
}
