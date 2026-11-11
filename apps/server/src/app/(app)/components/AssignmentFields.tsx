'use client'
import { useId, useState } from 'react'
import { Checkbox } from './ui/checkbox'
import { Label } from './ui/label'
import { NativeSelect } from './ui/native-select'

export type AssignableWorkspace = { id: number; name: string; products: { id: number; name: string }[] }

/** Workspace, scope and (for `products`) a checkbox list of that Workspace's Products, posted as `workspace`, `scope` and `products`. `removable` adds "Remove this assignment" for editing. */
export function AssignmentFields({ workspaces, workspace, scope = 'products', products = [], removable }: { workspaces: AssignableWorkspace[]; workspace?: number; scope?: string; products?: number[]; removable?: boolean }) {
  const uid = useId()
  const [ws, setWs] = useState(workspace ?? workspaces[0]?.id)
  const [pick, setPick] = useState(scope)
  const [checked, setChecked] = useState(() => new Set(products))
  const list = workspaces.find((w) => w.id === ws)?.products ?? []
  return (
    <>
      <div className="flex flex-col gap-1">
        <Label htmlFor={`${uid}-w`} className="small">Workspace</Label>
        <NativeSelect id={`${uid}-w`} name="workspace" value={ws} onChange={(e) => setWs(Number(e.target.value))}>
          {workspaces.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
        </NativeSelect>
      </div>
      <div className="flex flex-col gap-1">
        <Label htmlFor={`${uid}-s`} className="small">Access</Label>
        <NativeSelect id={`${uid}-s`} name="scope" value={pick} onChange={(e) => setPick(e.target.value)}>
          <option value="products">Selected Products</option>
          <option value="workspace">All Products of the Workspace</option>
          {removable && <option value="none">Remove this assignment</option>}
        </NativeSelect>
      </div>
      {pick === 'products' && (
        <fieldset className="m-0 flex flex-col gap-2 border-0 p-0">
          <legend className="small p-0 text-muted-foreground">Products</legend>
          {list.length ? list.map((p) => (
            <label key={p.id} className="flex items-center gap-2">
              <Checkbox name="products" value={p.id} checked={checked.has(p.id)} onChange={(e) => setChecked((c) => { const n = new Set(c); if (e.target.checked) n.add(p.id); else n.delete(p.id); return n })} />
              {p.name}
            </label>
          )) : <span className="small text-muted-foreground">This Workspace has no Products yet.</span>}
          {!!list.length && ![...checked].some((id) => list.some((p) => p.id === id)) && <span className="small text-muted-foreground">Nothing selected: the account sees no Product.</span>}
        </fieldset>
      )}
    </>
  )
}
