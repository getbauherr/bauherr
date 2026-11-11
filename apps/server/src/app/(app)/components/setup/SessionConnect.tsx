'use client'
import { useState, type ReactNode } from 'react'
import { ConnectBlock } from '../team/ConnectBlock'
import { connectPrompt } from '../team/helpers'
import { NativeSelect } from '../ui/native-select'

/** Step 4: the connect block of the Team page for the chosen role. `children` is the agent key form, shown inside step 1. */
export function SessionConnect({ roles, mcpLine, docsHref, children }: { roles: { id: string; title: string }[]; mcpLine: string; docsHref: string; children: ReactNode }) {
  const [role, setRole] = useState(roles[0]!.id)
  return (
    <div className="flex flex-col gap-3">
      <label className="small flex flex-col gap-1">
        Role for this session
        <NativeSelect value={role} onChange={(e) => setRole(e.target.value)}>
          {roles.map((r) => <option key={r.id} value={r.id}>{r.title}</option>)}
        </NativeSelect>
      </label>
      <ConnectBlock mcpLine={mcpLine} prompt={connectPrompt({ id: role })} docsHref={docsHref} keyStep={children} />
    </div>
  )
}
