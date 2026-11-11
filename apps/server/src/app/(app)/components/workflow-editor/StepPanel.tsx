'use client'
import { useMemo } from 'react'
import { checkpointOn, forwardTarget, hasLimit, isCustom, kindStage, removePath, renamePath, setCheckpoint, setPath, setSplit, setStageField, setTitle, slugOf, stagesOf, takesRole, type Doc } from '../../../../lib/workflow-edit'
import { humanize, pathLabel, stageTitle } from '../../../../lib/workflow-labels'
import type { Kind } from '../../../../lib/workflow-rules'
import { Lock } from '../icons'
import { Button } from '../ui/button'
import { Label } from '../ui/label'
import { NativeSelect } from '../ui/native-select'
import { Switch } from '../ui/switch'
import { Commit, RoleSelect } from './Fields'
import { allowedTargets, targetTitle, type RoleView } from './model'

type Props = { yaml: string; doc: Doc; findings: string[]; name: string; roles: RoleView[]; skills: string[]; mutate: (fn: (y: string) => string) => void; onBack: () => void }

const Row = ({ title, children, id }: { title: string; children: React.ReactNode; id?: string }) => (
  <div className="flex flex-col gap-1.5">
    <Label htmlFor={id} className="small">{title}</Label>
    {children}
  </div>
)

const Ask = ({ label, on, onChange, disabled }: { label: string; on: boolean; onChange: (on: boolean) => void; disabled?: boolean }) => (
  <label className="flex items-center justify-between gap-3">
    <span className="small">{label}</span>
    <Switch checked={on} disabled={disabled} onChange={(e) => onChange(e.target.checked)} aria-label={label} />
  </label>
)

/** Everything about the selected step, in the order an owner thinks about it. */
export function StepPanel({ yaml, doc, findings, name, roles, skills, mutate, onBack }: Props) {
  const stages = stagesOf(doc)
  const s = stages.find((x) => x.name === name)
  const kind = s?.kind as Kind | undefined
  const custom = !!s && isCustom(s)
  const rows = useMemo(
    () => (s ? Object.entries((s.outcomes ?? {}) as Record<string, string>).map(([key, to]) => ({ key, to, allowed: allowedTargets(yaml, findings, doc, s.name, key) })) : []),
    [yaml, findings, doc, s],
  )
  if (!s || !kind) return null
  const plan = kindStage(doc, 'plan')
  const split = stages.some((x) => x.kind === 'container')
  const paths = (
    <div className="flex flex-col gap-3" data-testid="paths">
      {rows.map(({ key, to, allowed }) => {
        const locked = allowed.length <= 1
        const label = custom ? null : pathLabel(kind, key)
        return (
          <div key={key} className="flex flex-col gap-1">
            {custom ? <span className="small text-muted-foreground">{kind === 'human' ? 'Choice' : 'When'}</span> : null}
            {custom ? <Commit aria-label={`Name of the path ${humanize(key)}`} value={humanize(key)} onCommit={(v) => mutate((y) => renamePath(y, s.name, key, slugOf(v, Object.keys(s.outcomes).filter((k) => k !== key), 'choice')))} /> : <span className="small text-muted-foreground">When: {label}</span>}
            <div className="flex items-center gap-2">
              {locked ? (
                <span className="small flex items-center gap-1.5" title="The workflow rules fix this path"><Lock className="size-3.5" /> {targetTitle(doc, to)}<span className="text-muted-foreground">(fixed: the factory relies on it)</span></span>
              ) : (
                <NativeSelect className="min-w-0 flex-1" aria-label={`Where ${custom ? humanize(key) : label} leads`} value={to} onChange={(e) => mutate((y) => setPath(y, s.name, key, e.target.value))}>
                  {allowed.map((t) => <option key={t} value={t}>{targetTitle(doc, t)}</option>)}
                </NativeSelect>
              )}
              {custom && rows.length > 1 && <Button variant="ghost" size="sm" onClick={() => mutate((y) => removePath(y, s.name, key))}>Remove</Button>}
            </div>
          </div>
        )
      })}
      {custom && (kind === 'agent' || rows.length < 4) && (
        <Button variant="outline" size="sm" className="self-start" onClick={() => mutate((y) => setPath(y, s.name, slugOf('Choice', Object.keys(s.outcomes), 'choice'), forwardTarget(s) ?? 'backlog'))}>Add a path</Button>
      )}
    </div>
  )
  return (
    <section aria-label={stageTitle(s)} data-testid="step-panel" className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-2">
        <h2 className="heading">{stageTitle(s)}</h2>
        <Button variant="ghost" size="sm" onClick={onBack}>Agent team</Button>
      </div>
      {!custom && <p className="small text-muted-foreground">Part of every workflow: it cannot be removed or moved.</p>}
      <Row title="Title"><Commit aria-label="Title" value={stageTitle(s)} onCommit={(v) => mutate((y) => setTitle(y, s.name, v))} /></Row>
      {takesRole(kind) && (
        <Row title="Who works here">
          <RoleSelect label="Who works here" roles={roles} value={s.role} onChange={(id) => mutate((y) => setStageField(y, s.name, 'role', id))} />
        </Row>
      )}
      {kind === 'agent' && (
        <Row title="Skill" id="panel-skill">
          <NativeSelect id="panel-skill" value={s.skill ?? ''} onChange={(e) => mutate((y) => setStageField(y, s.name, 'skill', e.target.value))}>
            {!skills.includes(s.skill) && <option value={s.skill ?? ''}>{s.skill ?? 'Choose a skill'}</option>}
            {skills.map((k) => <option key={k} value={k}>{k}</option>)}
          </NativeSelect>
        </Row>
      )}
      {hasLimit(kind) && (
        <Row title="At most … tickets here at a time" id="panel-wip">
          <Commit id="panel-wip" type="number" min={1} step={1} placeholder="No limit" aria-label="At most how many tickets here at a time" value={s.wip === undefined ? '' : String(s.wip)} onCommit={(v) => mutate((y) => setStageField(y, s.name, 'wip', /^[1-9]\d*$/.test(v.trim()) ? Number(v) : undefined))} />
        </Row>
      )}
      {(kind === 'plan' || kind === 'release' || kind === 'triage') && (
        <div className="flex flex-col gap-2">
          <span className="small font-medium">You are asked</span>
          {kind === 'triage' && <span className="small flex items-center gap-1.5 text-muted-foreground"><Lock className="size-3.5" /> You answer open questions: always on</span>}
          {kind === 'plan' && <Ask label="You approve the plan" on={checkpointOn(s, 'plan')} onChange={(on) => mutate((y) => setCheckpoint(y, 'plan', on))} />}
          {kind === 'release' && (
            <>
              <Ask label="You accept the result on staging" on={checkpointOn(s, 'staging')} onChange={(on) => mutate((y) => setCheckpoint(y, 'staging', on))} />
              <Ask label="You approve production" on={checkpointOn(s, 'production')} onChange={(on) => mutate((y) => setCheckpoint(y, 'production', on))} />
              <span className="small text-muted-foreground">A Product can also require approval for production on its own.</span>
            </>
          )}
        </div>
      )}
      {kind === 'plan' && plan && <Ask label="Large tickets can be split into sub-tickets" on={split} onChange={(on) => mutate((y) => setSplit(y, on))} />}
      {kind !== 'done' && (
        <div className="flex flex-col gap-2">
          <span className="small font-medium">What happens next</span>
          {custom ? paths : <details><summary className="small cursor-pointer text-primary">Change paths</summary><div className="mt-3">{paths}</div></details>}
        </div>
      )}
      <details data-slot="advanced">
        <summary className="small cursor-pointer text-primary">Advanced</summary>
        <div className="mt-3 flex flex-col gap-3">
          <Row title="Step id (cannot change)"><code className="mono small">{s.name}</code></Row>
          {kind === 'triage' && (
            <Row title="Labels that keep a ticket out of the factory">
              <Commit aria-label="Labels that keep a ticket out of the factory" value={((s.exclude_labels ?? []) as string[]).join(', ')} onCommit={(v) => mutate((y) => { const l = v.split(',').map((x) => x.trim()).filter(Boolean); return setStageField(y, s.name, 'exclude_labels', l.length ? l : undefined) })} />
            </Row>
          )}
        </div>
      </details>
    </section>
  )
}
