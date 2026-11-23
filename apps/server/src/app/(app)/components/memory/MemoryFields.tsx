'use client'
import { useState } from 'react'
import {
  MEMORY_MAX,
  MEMORY_STAGES,
  REACH_LABEL,
  STAGE_LABEL,
  type MemoryStage,
  type Reach,
} from '../../../../core/memory'
import { Checkbox } from '../ui/checkbox'
import { Label } from '../ui/label'
import { NativeSelect } from '../ui/native-select'
import { Textarea } from '../ui/textarea'

export type Draft = { text: string; reach: Reach; area: string; stages: MemoryStage[] }

export const inputOf = (draft: Draft) => ({
  text: draft.text,
  reach: draft.reach,
  ...(draft.reach === 'area' ? { area: draft.area } : {}),
  stages: draft.stages,
})

export const useDraft = (initial: Draft) => {
  const [draft, setDraft] = useState(initial)
  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => setDraft((was) => ({ ...was, [key]: value }))
  return { draft, set, reset: () => setDraft(initial) }
}

type Props = {
  draft: Draft
  set: <K extends keyof Draft>(key: K, value: Draft[K]) => void
  reaches: Reach[]
  areas: string[]
  label: string
}

const REACH_IDS = { text: 'memory-text', reach: 'memory-reach', area: 'memory-area' } as const

function Stages({ draft, set }: Pick<Props, 'draft' | 'set'>) {
  const toggle = (stage: MemoryStage, on: boolean) =>
    set('stages', MEMORY_STAGES.filter((s) => (s === stage ? on : draft.stages.includes(s))))
  return (
    <fieldset className="m-0 grid gap-2 border-0 p-0">
      <legend className="mb-2 font-medium">Handed to</legend>
      <div className="flex flex-wrap gap-x-6 gap-y-2">
        {MEMORY_STAGES.map((stage) => (
          <Label key={stage} className="flex items-center gap-2 font-normal">
            <Checkbox checked={draft.stages.includes(stage)} onChange={(e) => toggle(stage, e.target.checked)} />
            {STAGE_LABEL[stage]}
          </Label>
        ))}
      </div>
      <p className="small m-0 text-muted-foreground">Review is the reviewer&apos;s run in Verify.</p>
    </fieldset>
  )
}

export function MemoryFields({ draft, set, reaches, areas, label }: Props) {
  return (
    <>
      <div className="grid gap-1">
        <Label htmlFor={REACH_IDS.text}>{label}</Label>
        <Textarea
          id={REACH_IDS.text}
          className="font-sans"
          value={draft.text}
          maxLength={MEMORY_MAX}
          onChange={(event) => set('text', event.target.value)}
        />
        <span className="small text-muted-foreground">
          One sentence, as you would say it to a new colleague. {draft.text.length} of {MEMORY_MAX} characters.
        </span>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="grid gap-1">
          <Label htmlFor={REACH_IDS.reach}>Applies to</Label>
          <NativeSelect
            id={REACH_IDS.reach}
            value={draft.reach}
            onChange={(event) => set('reach', reaches.find((r) => r === event.target.value) ?? 'fit')}
          >
            {reaches.map((reach) => (
              <option key={reach} value={reach} disabled={reach === 'area' && areas.length === 0}>
                {REACH_LABEL[reach]}
              </option>
            ))}
          </NativeSelect>
        </div>
        {draft.reach === 'area' && (
          <div className="grid gap-1">
            <Label htmlFor={REACH_IDS.area}>Area</Label>
            <NativeSelect id={REACH_IDS.area} value={draft.area} onChange={(event) => set('area', event.target.value)}>
              {!areas.includes(draft.area) && <option value={draft.area}>{draft.area || 'Pick an area'}</option>}
              {areas.map((area) => (
                <option key={area} value={area}>{area}</option>
              ))}
            </NativeSelect>
          </div>
        )}
      </div>
      <Stages draft={draft} set={set} />
    </>
  )
}
