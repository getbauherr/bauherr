'use client'
import Link from 'next/link'
import { useEffect, useRef, useState } from 'react'
import { Button } from '../ui/button'
import { NativeSelect } from '../ui/native-select'
import { HarnessSetup } from '../gateway/HarnessSetup'
import { sessionName, type GatewaySetup } from '../../lib/harnesses'
import { CopyButton } from './CopyButton'
import { connectPrompt, defaultRole } from './helpers'
import type { TeamRole } from './types'

const PICK = 'team:pick-role'
const PICKED = 'Chosen by you'
const storageKey = (workspaceId: number | string) => `bauherr-team-role:${workspaceId}`

/** "Connect" of a needs-an-agent row: selects the role in the Connect panel and focuses its select. */
export function ConnectRoleButton({ role }: { role: string }) {
  return <Button type="button" variant="outline" size="sm" onClick={() => window.dispatchEvent(new CustomEvent(PICK, { detail: role }))}>Connect</Button>
}

type Props = {
  workspaceId: number | string
  roles: TeamRole[]
  /** The role chosen on load (`/team?role=`). */
  initialRole?: string
  presence: { key: boolean; anySession: boolean }
  docsHref: string
  mcpLine: string
  gateway?: GatewaySetup
}

/** "Connect a session": the role, the prompt to paste and the one primary action, Copy prompt. */
export function ConnectPanel({ workspaceId, roles, initialRole, presence, docsHref, mcpLine, gateway }: Props) {
  const fromLink = roles.find((r) => r.id === initialRole)?.id
  const start = defaultRole(roles)
  const [choice, setChoice] = useState<{ id?: string; hint: string }>(fromLink ? { id: fromLink, hint: 'Chosen by the link' } : (start ?? { hint: '' }))
  const [setup, setSetup] = useState(!presence.key || !presence.anySession)
  const [roll] = useState(gateway?.roll ?? '') // one session name per visit, not per 5 s refresh
  const select = useRef<HTMLSelectElement>(null)

  useEffect(() => {
    if (fromLink) return
    try {
      const last = localStorage.getItem(storageKey(workspaceId)) ?? undefined
      const next = defaultRole(roles, last)
      if (next) setChoice((c) => (c.hint === PICKED ? c : next))
    } catch {}
    // once on load: the 5 s refresh must not move the choice
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  useEffect(() => {
    const on = (e: Event) => {
      setChoice({ id: (e as CustomEvent<string>).detail, hint: PICKED })
      select.current?.scrollIntoView({ block: 'center' })
      select.current?.focus()
    }
    window.addEventListener(PICK, on)
    return () => window.removeEventListener(PICK, on)
  }, [])

  const role = roles.find((r) => r.id === choice.id)
  if (!role) return null
  const prompt = connectPrompt(role, gateway ? sessionName(role.id, roll) : undefined)
  const remember = () => {
    try {
      localStorage.setItem(storageKey(workspaceId), role.id)
    } catch {}
  }

  return (
    <section aria-labelledby="connect-heading" className="flex flex-col gap-4 rounded-md border border-border bg-card p-6" data-testid="connect-panel">
      <h2 id="connect-heading" className="heading">Connect a session</h2>
      <div className="flex flex-col gap-2">
        <label htmlFor="connect-role" className="label text-muted-foreground">Role</label>
        <div className="flex flex-wrap items-center gap-3">
          <NativeSelect id="connect-role" ref={select} className="min-w-64 max-sm:w-full" value={role.id} onChange={(e) => setChoice({ id: e.target.value, hint: PICKED })}>
            {roles.map((r) => <option key={r.id} value={r.id}>{r.title}</option>)}
          </NativeSelect>
          <CopyButton primary className="max-sm:w-full" text={prompt} label="Copy prompt" disabled={!presence.key} onCopy={remember} />
          {!presence.key && <span className="small text-muted-foreground" id="no-key">Create an agent key first.</span>}
        </div>
        <span className="small text-muted-foreground" data-testid="connect-hint">{choice.hint}</span>
      </div>
      <div aria-live="polite">
        <span className="sr-only">Prompt for {role.title}</span>
        <pre className="mono m-0 overflow-x-auto rounded-md bg-secondary p-3 whitespace-pre-wrap" data-testid="connect-prompt">{prompt}</pre>
      </div>
      <details open={setup} onToggle={(e) => setSetup(e.currentTarget.open)} className="flex flex-col gap-3">
        <summary className="small cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-ring">First-time setup</summary>
        <div className="mt-3 flex flex-col gap-3">
          <span className="small">1. Add the factory to Claude Code once. <Link className="text-primary" href="/settings/api-key">Create an agent key</Link> and put it in place of the placeholder.</span>
          {gateway ? (
            <div className="flex flex-col gap-2" data-testid="connect-gateway">
              <span className="small text-muted-foreground">One setup does both: it adds the factory and sends every model call of the session through the gateway, so its cost is measured under the session name in the prompt.</span>
              <HarnessSetup setup={{ ...gateway, roll }} role={role.id} />
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              <pre className="mono m-0 overflow-x-auto rounded-md bg-secondary p-3 whitespace-pre-wrap">{mcpLine}</pre>
              <div><CopyButton text={mcpLine} label="Copy command" /></div>
            </div>
          )}
          <a className="small text-primary" href={docsHref}>How sessions connect</a>
        </div>
      </details>
    </section>
  )
}
