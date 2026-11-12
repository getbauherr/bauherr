'use client'
import { useState } from 'react'
import { CopyButton } from '../team/CopyButton'
import { NativeSelect } from '../ui/native-select'
import { SettingsForm } from '../SettingsForm'
import { HARNESSES, LEVEL_TEXT, ROUTE_LABEL, harnessOf, sessionName, type GatewaySetup, type Route } from '../../lib/harnesses'
import { createSessionKey } from '../../(shell)/settings/actions'

/**
 * Copy-pasteable setup per coding tool, with the session name, role and addresses filled in.
 * `role` fixed: the Agent team page (one step connects the session and routes it through the gateway); else the person picks one of `roles`.
 */
export function HarnessSetup({ setup, roles, role }: { setup: GatewaySetup; roles?: { id: string; title: string }[]; role?: string }) {
  const [picked, setPicked] = useState(roles?.[0]?.id ?? 'engineer')
  const [id, setId] = useState(HARNESSES[0]!.id)
  const [route, setRoute] = useState<Route>('subscription')
  const r = role ?? picked
  const h = harnessOf(id)
  const active: Route = h.routes.includes(route) ? route : (h.routes[0] ?? 'api-key')
  const blocks = h.blocks({ ...setup, session: sessionName(r, setup.roll), role: r }, active)
  return (
    <div className="flex flex-col gap-3" data-testid="harness-setup">
      <div className="flex flex-wrap gap-4">
        {!role && roles && (
          <label className="small flex flex-col gap-1">
            Role of the session
            <NativeSelect value={picked} onChange={(e) => setPicked(e.target.value)} aria-label="Role of the session">{roles.map((x) => <option key={x.id} value={x.id}>{x.title}</option>)}</NativeSelect>
          </label>
        )}
        <label className="small flex flex-col gap-1">
          Coding tool
          <NativeSelect value={id} onChange={(e) => setId(e.target.value)} aria-label="Coding tool">{HARNESSES.map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}</NativeSelect>
        </label>
        {h.routes.length > 1 && (
          <label className="small flex flex-col gap-1">
            Pay with
            <NativeSelect value={active} onChange={(e) => setRoute(e.target.value as Route)} aria-label="Pay with">{h.routes.map((x) => <option key={x} value={x}>{ROUTE_LABEL[x]}</option>)}</NativeSelect>
          </label>
        )}
      </div>
      <p className="small m-0" data-testid="harness-level">{LEVEL_TEXT[h.level]} {h.summary.replace(/`/g, '')}</p>
      {h.level !== 'none' && (
        <>
          {blocks.map((b) => (
            <div key={b.title} className="flex flex-col gap-2">
              <span className="small">{b.title}</span>
              <pre className="mono m-0 overflow-x-auto rounded-md bg-secondary p-3 whitespace-pre-wrap">{b.text}</pre>
              <div><CopyButton text={b.text} label="Copy" /></div>
            </div>
          ))}
          <p className="small m-0 text-muted-foreground">Check: after the first answer the session shows under Agent team, and its tokens and cost appear in Insights, Cost &amp; tokens within a few minutes. The session name is <span className="mono">{sessionName(r, setup.roll)}</span>.</p>
        </>
      )}
      {setup.admin && h.level !== 'none' && (
        <div className="flex flex-col gap-2">
          <span className="small text-muted-foreground">The session key is shown once. Creating a new one replaces the current key: sessions that use the current key stop working until they get the new one.</span>
          <SettingsForm action={createSessionKey} submit="Create a session key" copy confirm="Confirm: running sessions stop until they get the new key" />
        </div>
      )}
      <a className="small text-primary" href={h.docs} target="_blank" rel="noreferrer">{h.label}: official documentation</a>
    </div>
  )
}
