'use client'
import { useState, type ComponentProps } from 'react'
import { RoleAvatar } from '../team/RoleAvatar'
import { Input } from '../ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select'
import type { RoleView } from './model'

/** A text field that edits locally and hands its value over on blur or Enter, so a half-typed value never rewrites the file. */
export function Commit({ value, onCommit, ...props }: { value: string; onCommit: (v: string) => void } & Omit<ComponentProps<'input'>, 'value' | 'onChange' | 'onBlur' | 'onKeyDown'>) {
  const [text, setText] = useState(value)
  const [seen, setSeen] = useState(value)
  if (seen !== value) (setSeen(value), setText(value))
  const done = () => text !== value && onCommit(text)
  return <Input {...props} value={text} onChange={(e) => setText(e.target.value)} onBlur={done} onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), done())} />
}

export const RoleLine = ({ role }: { role: Pick<RoleView, 'title' | 'avatar'> }) => (
  <span className="flex items-center gap-2"><RoleAvatar avatar={role.avatar} size="sm" animate={false} />{role.title}</span>
)

/** Role choice with the avatar of each role. */
export function RoleSelect({ roles, value, onChange, label }: { roles: RoleView[]; value: string | undefined; onChange: (id: string) => void; label: string }) {
  return (
    <Select value={value ?? ''} onValueChange={onChange}>
      <SelectTrigger aria-label={label} className="h-12"><SelectValue placeholder="Choose an agent" /></SelectTrigger>
      <SelectContent>
        {roles.map((r) => <SelectItem key={r.id} value={r.id}><RoleLine role={r} /></SelectItem>)}
      </SelectContent>
    </Select>
  )
}
