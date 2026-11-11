'use client'
import { useRouter } from 'next/navigation'
import { useEffect, useMemo, useState, useTransition } from 'react'
import { describeChanges } from '../../../../lib/workflow-describe'
import { addStep, checkpointsOf, isCustom, moveStep, readDraft, removeStep, setCheckpoint, setMigrate, setStageField, stagesOf, takesRole, type NewStep } from '../../../../lib/workflow-edit'
import { CHECKPOINT, stageTitle } from '../../../../lib/workflow-labels'
import { cn } from '@/lib/utils'
import { setExpediteLane } from '../../(shell)/workflow/edit/actions'
import type { EditorData, VersionRow } from '../../lib/workflow-editor'
import { Badge } from '../ui/badge'
import { Button } from '../ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '../ui/dialog'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '../ui/dropdown-menu'
import { Switch } from '../ui/switch'
import { AddStep, type Adding } from './AddStep'
import { AMBER, checkpointId, Flow } from './Flow'
import { HistoryTab } from './HistoryTab'
import { canAddAfter, findingsByStage, rolesOf, type RoleView } from './model'
import { ReviewDialog } from './ReviewDialog'
import { StepPanel } from './StepPanel'
import { TeamTray } from './TeamTray'
import { YamlTab } from './YamlTab'

type Tab = 'design' | 'yaml' | 'history'
type Ask = { title: string; text: string; confirm: string; run: () => void }
const TABS: [Tab, string][] = [['design', 'Design'], ['yaml', 'YAML'], ['history', 'History']]
const HASH_TAB: Record<string, Tab> = { 'factory-file': 'yaml' }
const storeKey = (slug: string, v: number | null) => `bauherr:wf-draft:${slug}:${v ?? 0}`

const safe = <T,>(fn: () => T): T | undefined => {
  try {
    return fn()
  } catch {
    return undefined
  }
}

/** The workflow editor: one draft (the factory file as text) shown as a flow or as YAML; nothing is live until Review changes, Apply. */
export function WorkflowEditor({ data, initialTab }: { data: EditorData; initialTab: Tab }) {
  const router = useRouter()
  const [yaml, setYaml] = useState(data.base)
  const [note, setNote] = useState('')
  const [tab, setTab] = useState<Tab>(initialTab)
  const [selected, setSelected] = useState<string | null>(null)
  const [highlight, setHighlight] = useState<string | null>(null)
  const [dragRole, setDragRole] = useState<string | null>(null)
  const [placing, setPlacing] = useState<RoleView | null>(null)
  const [adding, setAdding] = useState<Adding | null>(null)
  const [reviewing, setReviewing] = useState(false)
  const [ask, setAsk] = useState<Ask | null>(null)
  const [notice, setNotice] = useState<{ text: string; error?: boolean } | null>(null)
  const [older, setOlder] = useState<string | null>(null)
  const [ready, setReady] = useState(false)
  const [lane, setLane] = useState(data.expediteLane)
  const [laneError, setLaneError] = useState<string | null>(null)
  const [saving, start] = useTransition()
  const [saved, setSaved] = useState(false)
  const key = storeKey(data.slug, data.baseVersion)

  useEffect(() => {
    safe(() => {
      const mine = localStorage.getItem(key)
      if (mine) {
        const d = JSON.parse(mine) as { yaml?: string; note?: string }
        if (typeof d.yaml === 'string' && d.yaml !== data.base) (setYaml(d.yaml), setNote(d.note ?? ''))
      } else setOlder(Object.keys(localStorage).find((k) => k.startsWith(`bauherr:wf-draft:${data.slug}:`) && k !== key) ?? null)
    })
    const hash = location.hash.slice(1)
    if (hash in HASH_TAB) setTab(HASH_TAB[hash]!)
    setReady(true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const changed = yaml !== data.base
  useEffect(() => {
    if (!ready) return
    safe(() => (changed ? localStorage.setItem(key, JSON.stringify({ yaml, note })) : localStorage.removeItem(key)))
  }, [ready, changed, yaml, note, key])

  const [seenVersion, setSeenVersion] = useState(data.baseVersion)
  if (seenVersion !== data.baseVersion) {
    setSeenVersion(data.baseVersion)
    setYaml(data.base)
    setNote('')
  }

  const draft = useMemo(() => readDraft(yaml), [yaml])
  const base = useMemo(() => readDraft(data.base), [data.base])
  const doc = draft.ok ? draft.doc : null
  const findings = draft.ok ? draft.findings : []
  const roles = useMemo(() => (doc ? rolesOf(doc) : []), [doc])
  const changes = useMemo(() => {
    if (!changed) return []
    const l = doc && base.ok ? describeChanges(base.doc, doc) : []
    return l.length ? l : ['Other edits to the file, such as comments or layout']
  }, [changed, doc, base])
  const byStage = useMemo(() => findingsByStage(findings), [findings])
  const stages = doc ? stagesOf(doc) : []
  const slotOk = useMemo(() => {
    if (!doc) return {}
    const role = roles[0]?.id ?? 'x'
    return Object.fromEntries(stagesOf(doc).map((s) => [s.name as string, canAddAfter(yaml, findings, s.name, role)]))
  }, [doc, yaml, findings, roles])
  const moves = useMemo(() => {
    if (!doc) return {}
    return Object.fromEntries(
      stagesOf(doc).filter(isCustom).flatMap((s) => ([1, -1] as const).map((d) => [`${s.name}:${d}`, safe(() => { const r = readDraft(moveStep(yaml, s.name, d)); return r.ok && r.findings.every((f) => findings.includes(f)) }) === true])),
    )
  }, [doc, yaml, findings])
  const checkpoints = doc ? checkpointsOf(doc).filter((c) => c.on) : []
  const pick = selected && stages.some((s) => s.name === selected) ? selected : null
  const problemCount = findings.length

  const mutate = (fn: (y: string) => string) => {
    try {
      setYaml(fn(yaml))
      setNotice(null)
    } catch (e) {
      setNotice({ text: (e as Error).message, error: true })
    }
  }
  const guarded = (a: Ask) => (changed ? setAsk(a) : a.run())
  const load = (source: string, text: string, why: string) => {
    setYaml(source)
    setNote(why)
    setSelected(null)
    setTab('design')
    setNotice({ text })
  }
  const jump = (id: string) => {
    setTab('design')
    setTimeout(() => document.getElementById(id)?.scrollIntoView({ block: 'center', behavior: 'smooth' }), 50)
  }
  const discard = () => {
    setYaml(data.base)
    setNote('')
    setSelected(null)
    setNotice(null)
  }
  const REPLACE = 'This replaces your draft. Nothing is live until you apply it.'
  const restore = (v: VersionRow & { source: string }) => guarded({ title: `Restore version ${v.version}?`, text: REPLACE, confirm: 'Restore', run: () => load(v.source, `Version ${v.version} is loaded into the draft. Review it, then apply.`, `Restore of version ${v.version}`) })
  const restoreShipped = () => guarded({ title: 'Restore the shipped default?', text: REPLACE, confirm: 'Restore', run: () => load(data.shipped, 'The shipped default is loaded into the draft. Review it, then apply.', 'Restore of the shipped default') })
  const preset = (p: EditorData['presets'][number]) => guarded({ title: `Start from ${p.title}?`, text: REPLACE, confirm: 'Replace draft', run: () => load(p.source, `The ${p.title} preset is loaded into the draft. Review it, then apply.`, `Preset ${p.title}`) })

  const onAdd = (step: NewStep) => {
    try {
      const r = addStep(yaml, step)
      setYaml(r.yaml)
      setSelected(r.name)
      setNotice({ text: `Added ${step.title}.` })
      setAdding(null)
      setPlacing(null)
      setTab('design')
      setTimeout(() => document.getElementById(`step-${r.name}`)?.scrollIntoView({ block: 'center', behavior: 'smooth' }), 50)
    } catch (e) {
      setNotice({ text: (e as Error).message, error: true })
      setAdding(null)
    }
  }
  const seat = (stage: string, roleId: string) => {
    setDragRole(null)
    const s = stages.find((x) => x.name === stage)
    if (!s) return
    if (!takesRole(s.kind)) return setNotice({ text: `${stageTitle(s)} takes no agent: the factory does this itself.`, error: true })
    mutate((y) => setStageField(y, stage, 'role', roleId))
    setNotice({ text: `${roles.find((r) => r.id === roleId)?.title ?? roleId} now works in ${stageTitle(s)}.` })
  }
  const remove = (name: string) => {
    const s = stages.find((x) => x.name === name)
    setAsk({ title: `Remove ${s ? stageTitle(s) : name}?`, text: 'Paths that led here lead to the next step instead. Nothing is live until you apply it.', confirm: 'Remove step', run: () => (mutate((y) => removeStep(y, name)), setSelected(null)) })
  }
  const applied = (version: number | undefined) => {
    setReviewing(false)
    safe(() => localStorage.removeItem(key))
    setNote('')
    setSelected(null)
    setNotice({ text: `Version ${version} is live.` })
    router.refresh()
  }
  const flipLane = (on: boolean) => {
    setLane(on)
    setLaneError(null)
    setSaved(false)
    start(async () => {
      const r = await setExpediteLane(on)
      if (r.error) (setLane(!on), setLaneError(r.error))
      else setSaved(true)
    })
  }

  const a = data.active
  const status = a ? `Version ${a.version}${a.shipped ? ' (the shipped default)' : ''}, applied ${a.at.slice(0, 10)}${a.via === 'boot' ? ' from the boot file' : a.via === 'seed' ? ' by the seed' : a.by ? ` by ${a.by}` : ''}` : 'Shipped default'
  const panelFor = pick && doc ? <StepPanel key={pick} yaml={yaml} doc={doc} findings={findings} name={pick} roles={roles} skills={data.skills} mutate={mutate} onBack={() => setSelected(null)} /> : null

  return (
    <div className="@container flex min-w-0 flex-col gap-4">
      <header className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
          <div className="flex min-w-0 flex-col gap-0.5">
            <h1 className="title">Workflow</h1>
            <p className="small text-muted-foreground" data-testid="status">{status}</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {changed && (
              <>
                <Badge variant="warn" data-testid="draft-badge">Draft · {changes.length} {changes.length === 1 ? 'change' : 'changes'}</Badge>
                <Button variant="outline" onClick={() => setAsk({ title: 'Discard your changes?', text: 'The draft goes back to the live version.', confirm: 'Discard', run: discard })}>Discard</Button>
                <Button disabled={!draft.ok} onClick={() => setReviewing(true)}>Review changes</Button>
              </>
            )}
          </div>
        </div>
        {older && (
          <div role="status" data-testid="older-draft" className={cn('flex flex-wrap items-center justify-between gap-2 rounded-md border px-3 py-2', AMBER)}>
            <span className="small">The workflow changed since you started this draft.</span>
            <span className="flex gap-2">
              <Button variant="outline" size="sm" onClick={() => (safe(() => localStorage.removeItem(older)), setOlder(null))}>Discard</Button>
              <Button variant="outline" size="sm" onClick={() => { const d = safe(() => JSON.parse(localStorage.getItem(older) ?? '{}') as { yaml?: string; note?: string }); if (d?.yaml) (setYaml(d.yaml), setNote(d.note ?? '')); safe(() => localStorage.removeItem(older)); setOlder(null) }}>Keep editing</Button>
            </span>
          </div>
        )}
        {doc && (
          <div className="flex flex-wrap items-center gap-2" data-testid="checkpoint-strip">
            <span className="small font-medium">You are asked at {checkpoints.length} {checkpoints.length === 1 ? 'point' : 'points'}:</span>
            {checkpoints.map((c) => {
              const s = stages.find((x) => x.name === c.stage)
              const label = c.key === 'human' ? stageTitle(s ?? {}) : CHECKPOINT[c.key].chip
              return (
                <button key={`${c.stage}-${c.key}`} type="button" onClick={() => jump(c.key === 'human' ? `step-${c.stage}` : checkpointId(c))} className={cn('small rounded-full border px-3 py-1 font-[inherit] font-medium text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring', AMBER)}>{label}</button>
              )
            })}
            {problemCount > 0 && <span role="status" className="small ml-auto font-medium text-destructive" data-testid="problem-count">{problemCount} {problemCount === 1 ? 'problem' : 'problems'}</span>}
          </div>
        )}
        <div role="tablist" aria-label="Views" className="flex gap-4 border-b border-border">
          {TABS.map(([t, label]) => (
            <button key={t} type="button" role="tab" id={`tab-${t}`} aria-selected={tab === t} aria-controls={`panel-${t}`} onClick={() => setTab(t)} className="-mb-px flex h-10 items-center border-0 border-b border-transparent bg-transparent p-0 font-[inherit] text-[15px] text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring aria-selected:border-primary aria-selected:text-foreground">{label}</button>
          ))}
        </div>
      </header>
      {notice && <p role={notice.error ? 'alert' : 'status'} className={cn('small', notice.error ? 'text-destructive' : 'text-muted-foreground')} data-testid="notice">{notice.text}</p>}

      {tab === 'design' && (
        <div role="tabpanel" id="panel-design" aria-labelledby="tab-design" className="flex flex-col gap-6">
          {!doc || !draft.ok ? (
            <p role="alert" className="rounded-md border border-destructive p-4 text-destructive">Fix the YAML first. <button type="button" className="text-primary underline" onClick={() => setTab('yaml')}>Open the YAML</button></p>
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-2">
                <DropdownMenu modal={false}>
                  <DropdownMenuTrigger asChild><Button variant="outline" size="sm">Start from a preset</Button></DropdownMenuTrigger>
                  <DropdownMenuContent align="start">
                    {data.presets.map((p) => (
                      <DropdownMenuItem key={p.id} className="flex-col items-start" onSelect={() => preset(p)}><span className="font-medium">{p.title}</span><span className="small text-muted-foreground">{p.blurb}</span></DropdownMenuItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
                {placing && (
                  <span role="status" className={cn('small flex items-center gap-2 rounded-md border px-3 py-1', AMBER)}>
                    Click a + where {placing.title} should work.
                    <button type="button" className="text-primary underline" onClick={() => setPlacing(null)}>Cancel</button>
                  </span>
                )}
              </div>
              <div className="grid grid-cols-1 items-start gap-6 @3xl:grid-cols-[minmax(0,1fr)_20rem]">
                <Flow
                  doc={doc}
                  roles={roles}
                  counts={data.counts}
                  findings={byStage}
                  selected={pick}
                  onSelect={setSelected}
                  highlightRole={highlight}
                  dragRole={dragRole}
                  placing={placing}
                  slotOk={slotOk}
                  moveOk={(n, d) => moves[`${n}:${d}`] === true}
                  onToggle={(which, on) => mutate((y) => setCheckpoint(y, which, on))}
                  onAdd={(after, kind) => setAdding({ after, afterTitle: stageTitle(stages.find((s) => s.name === after) ?? { name: after }), kind, role: kind === 'agent' ? placing?.id : undefined })}
                  onSeat={seat}
                  onMove={(n, d) => mutate((y) => moveStep(y, n, d))}
                  onRemove={remove}
                />
                <aside aria-label="Details" className="flex flex-col gap-4 rounded-md border border-border bg-card p-4 @3xl:sticky @3xl:top-4 @3xl:max-h-[calc(100vh-6rem)] @3xl:overflow-y-auto">
                  {panelFor ?? <TeamTray doc={doc} roles={roles} highlight={highlight} onHighlight={setHighlight} onPlace={setPlacing} onDrag={setDragRole} />}
                </aside>
              </div>
              <label className="flex items-start justify-between gap-4 rounded-md border border-border bg-card p-4">
                <span className="flex min-w-0 flex-col gap-1">
                  <span className="font-medium text-foreground">Fast lane for urgent tickets</span>
                  <span className="small text-muted-foreground">A ticket labelled bauherr:expedite skips triage, ignores the limits and needs no plan approval; one at a time. Saved right away.</span>
                  {laneError && <span role="alert" className="small text-destructive">{laneError}</span>}
                </span>
                <span className="flex flex-none items-center gap-3">
                  <span role="status" className="small text-muted-foreground">{saving ? 'Saving…' : saved ? 'Saved' : ''}</span>
                  <Switch checked={lane} onChange={(e) => flipLane(e.target.checked)} aria-label="Fast lane for urgent tickets" />
                </span>
              </label>
            </>
          )}
        </div>
      )}
      {tab === 'yaml' && (
        <div role="tabpanel" id="panel-yaml" aria-labelledby="tab-yaml">
          <YamlTab yaml={yaml} setYaml={setYaml} draft={draft} slug={data.slug} />
        </div>
      )}
      {tab === 'history' && (
        <div role="tabpanel" id="panel-history" aria-labelledby="tab-history">
          <HistoryTab versions={data.versions} active={data.baseVersion} onRestore={(v) => v.source !== null && restore({ ...v, source: v.source })} onRestoreShipped={restoreShipped} />
        </div>
      )}

      <AddStep adding={adding} roles={roles} skills={data.skills} onClose={() => setAdding(null)} onAdd={onAdd} />
      {doc && base.ok && (
        <ReviewDialog
          open={reviewing}
          onClose={() => setReviewing(false)}
          yaml={yaml}
          baseDoc={base.doc}
          doc={doc}
          baseVersion={data.baseVersion}
          changes={changes}
          problems={findings}
          note={note}
          onNote={setNote}
          onMigrate={(from, to) => mutate((y) => setMigrate(y, from, to))}
          onApplied={applied}
          onLoadCurrent={() => { setReviewing(false); discard(); router.refresh() }}
          onContinueInYaml={() => { setReviewing(false); setTab('yaml') }}
        />
      )}
      <Dialog open={!!ask} onOpenChange={(o) => !o && setAsk(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{ask?.title}</DialogTitle>
            <DialogDescription>{ask?.text}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAsk(null)}>Cancel</Button>
            <Button onClick={() => { const run = ask?.run; setAsk(null); run?.() }}>{ask?.confirm}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
