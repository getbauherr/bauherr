'use client'
import { useState } from 'react'
import type { NewStep } from '../../../../lib/workflow-edit'
import { Button } from '../ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '../ui/dialog'
import { Input } from '../ui/input'
import { Label } from '../ui/label'
import { NativeSelect } from '../ui/native-select'
import { RoleSelect } from './Fields'
import type { RoleView } from './model'

export type Adding = { after: string; afterTitle: string; kind: 'agent' | 'human'; role?: string }
type Props = { adding: Adding | null; roles: RoleView[]; skills: string[]; onClose: () => void; onAdd: (s: NewStep) => void }

function Form({ adding, roles, skills, onClose, onAdd }: Props & { adding: Adding }) {
  const [title, setTitle] = useState('')
  const [role, setRole] = useState(adding.role ?? '')
  const [skill, setSkill] = useState(skills[0] ?? '')
  const [choices, setChoices] = useState(['Approve', 'Reject'])
  const agent = adding.kind === 'agent'
  const picked = choices.map((c) => c.trim()).filter(Boolean)
  const ready = title.trim() && (agent ? role && skill : picked.length >= 1)
  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault()
        if (ready) onAdd({ after: adding.after, kind: adding.kind, title, ...(agent ? { role, skill } : { choices: picked }) })
      }}
    >
      <DialogHeader>
        <DialogTitle>{agent ? 'Add an agent step' : 'Add a decision for you'}</DialogTitle>
        <DialogDescription>It goes right after {adding.afterTitle}.</DialogDescription>
      </DialogHeader>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="add-title" className="small">Title</Label>
        <Input id="add-title" autoFocus value={title} onChange={(e) => setTitle(e.target.value)} placeholder={agent ? 'Security review' : 'Sign-off'} />
      </div>
      {agent ? (
        <>
          <div className="flex flex-col gap-1.5">
            <span className="small font-medium">Who works here</span>
            <RoleSelect label="Who works here" roles={roles} value={role} onChange={setRole} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="add-skill" className="small">Skill</Label>
            <NativeSelect id="add-skill" value={skill} onChange={(e) => setSkill(e.target.value)}>
              {skills.map((k) => <option key={k} value={k}>{k}</option>)}
            </NativeSelect>
          </div>
        </>
      ) : (
        <fieldset className="m-0 flex flex-col gap-2 border-0 p-0">
          <legend className="small mb-1 p-0 font-medium">Your choices (1 to 4)</legend>
          {choices.map((c, i) => (
            <div key={i} className="flex items-center gap-2">
              <Input aria-label={`Choice ${i + 1}`} className="min-w-0 flex-1" value={c} onChange={(e) => setChoices(choices.map((x, j) => (j === i ? e.target.value : x)))} />
              {choices.length > 1 && <Button type="button" variant="ghost" size="sm" onClick={() => setChoices(choices.filter((_, j) => j !== i))}>Remove</Button>}
            </div>
          ))}
          {choices.length < 4 && <Button type="button" variant="outline" size="sm" className="self-start" onClick={() => setChoices([...choices, ''])}>Add a choice</Button>}
          <span className="small text-muted-foreground">The first choice moves the ticket on. The others send it back.</span>
        </fieldset>
      )}
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
        <Button type="submit" disabled={!ready}>Add step</Button>
      </DialogFooter>
    </form>
  )
}

export function AddStep(p: Props) {
  return (
    <Dialog open={!!p.adding} onOpenChange={(o) => !o && p.onClose()}>
      <DialogContent>{p.adding && <Form key={`${p.adding.after}:${p.adding.kind}:${p.adding.role ?? ''}`} {...p} adding={p.adding} />}</DialogContent>
    </Dialog>
  )
}
