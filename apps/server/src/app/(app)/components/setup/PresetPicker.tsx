'use client'
import { useState } from 'react'
import { cn } from '@/lib/utils'
import { applyPreset } from '../../(shell)/setup/actions'
import { SettingsForm } from '../SettingsForm'
import { RoleAvatar } from '../team/RoleAvatar'
import { TeamSelect } from '../team/TeamSelect'
import type { TeamRole } from '../team/types'

export type PresetCard = { id: string; title: string; blurb: string; roles: { id: string; title: string; avatar: string }[]; asks: string[]; team: TeamRole[] }

/** Three preset cards, the read-only roster of the chosen one and the two ways forward: "Use this team" or skip (Standard). Edits of models and agents happen on /team. */
export function PresetPicker({ presets }: { presets: PresetCard[] }) {
  const [id, setId] = useState('standard')
  const chosen = presets.find((p) => p.id === id)!
  return (
    <div className="flex flex-col gap-4">
      <div role="radiogroup" aria-label="Team" className="grid grid-cols-3 gap-3 max-md:grid-cols-1">
        {presets.map((p) => (
          <button
            key={p.id}
            type="button"
            role="radio"
            aria-checked={p.id === id}
            data-preset={p.id}
            onClick={() => setId(p.id)}
            className={cn('flex cursor-pointer flex-col gap-3 rounded-md border bg-card p-4 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring', p.id === id ? 'border-primary bg-accent ring-2 ring-primary' : 'border-border hover:bg-secondary')}
          >
            <span className="heading">{p.title}{p.id === 'standard' && <span className="small ml-2 font-normal text-muted-foreground">Default</span>}</span>
            <span className="small text-muted-foreground">{p.blurb}</span>
            <span className="flex flex-wrap gap-1" aria-label="Roles">{p.roles.map((r) => <span key={r.id} title={r.title}><RoleAvatar avatar={r.avatar} size="sm" animate={p.id === id} /></span>)}</span>
            <span className="small"><span className="label text-muted-foreground">Roles </span>{p.roles.map((r) => r.title).join(', ')}</span>
            <span className="small"><span className="label text-muted-foreground">You are asked </span>{p.asks.join('; ')}</span>
          </button>
        ))}
      </div>
      <TeamSelect key={id} preview roles={chosen.team} modelOptions={[]} canEdit={false} onSave={() => {}} docsHref="" mcpLine="" />
      <div className="flex flex-wrap items-center gap-3">
        <SettingsForm action={applyPreset} submit="Use this team" primary>
          <input type="hidden" name="preset" value={id} />
        </SettingsForm>
        <SettingsForm action={applyPreset} submit="Skip, use Standard">
          <input type="hidden" name="preset" value="standard" />
        </SettingsForm>
      </div>
    </div>
  )
}
