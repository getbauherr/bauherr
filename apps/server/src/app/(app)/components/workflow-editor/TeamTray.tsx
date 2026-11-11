'use client'
import Link from 'next/link'
import { stagesOf, type Doc } from '../../../../lib/workflow-edit'
import { stageTitle } from '../../../../lib/workflow-labels'
import { cn } from '@/lib/utils'
import { RoleAvatar } from '../team/RoleAvatar'
import { Button } from '../ui/button'
import type { RoleView } from './model'

type Props = { doc: Doc; roles: RoleView[]; highlight: string | null; onHighlight: (id: string | null) => void; onPlace: (role: RoleView) => void; onDrag: (id: string | null) => void }

/** The agents of the draft: who they are, where they work, and the ones not in the workflow yet (drag one onto a step to seat it). */
export function TeamTray({ doc, roles, highlight, onHighlight, onPlace, onDrag }: Props) {
  const stages = stagesOf(doc)
  return (
    <section aria-label="Agent team" data-testid="team-tray" className="flex flex-col gap-3">
      <h2 className="heading">Agent team</h2>
      <p className="small text-muted-foreground">Drag an agent onto a step to seat it there.</p>
      <ul className="m-0 flex list-none flex-col gap-2 p-0">
        {roles.map((r) => {
          const where = stages.filter((s) => s.role === r.id).map(stageTitle)
          return (
            <li
              key={r.id}
              data-testid="role"
              data-role={r.id}
              draggable
              onDragStart={(e) => (e.dataTransfer.setData('text/plain', r.id), (e.dataTransfer.effectAllowed = 'move'), onDrag(r.id))}
              onDragEnd={() => onDrag(null)}
              className={cn('flex cursor-grab flex-col gap-2 rounded-md border border-border bg-card p-2', highlight === r.id && 'bg-accent outline-2 -outline-offset-1 outline-primary')}
            >
              <button type="button" aria-pressed={highlight === r.id} onClick={() => onHighlight(highlight === r.id ? null : r.id)} className="flex min-w-0 items-center gap-3 border-0 bg-transparent p-0 text-left font-[inherit]">
                <RoleAvatar avatar={r.avatar} size="sm" animate={false} />
                <span className="flex min-w-0 flex-col">
                  <span className="font-medium text-foreground">{r.title}</span>
                  <span className="small text-muted-foreground">{[r.model, r.agents ? `up to ${r.agents} at once` : 'any number at once'].filter(Boolean).join(' · ')}</span>
                </span>
              </button>
              {where.length ? (
                <span className="small text-muted-foreground">Works in {where.join(', ')}</span>
              ) : (
                <span className="flex flex-wrap items-center justify-between gap-2">
                  <span className="small font-medium text-warn">Not placed in the workflow</span>
                  <Button variant="outline" size="sm" onClick={() => onPlace(r)}>Place</Button>
                </span>
              )}
            </li>
          )
        })}
      </ul>
      <Link className="small text-primary" href="/team">Manage the agent team</Link>
    </section>
  )
}
