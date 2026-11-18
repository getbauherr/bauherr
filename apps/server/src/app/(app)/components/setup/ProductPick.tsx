'use client'
import { useState, type ReactNode } from 'react'
import { createProductWithRepo } from '../../(shell)/settings/actions'
import { Field, SettingsForm } from '../SettingsForm'

export function ProductPick({ connections, children }: { connections: { id: number; name: string }[]; children?: ReactNode }) {
  const [repo, setRepo] = useState('')
  const [name, setName] = useState<string>()
  return (
    <SettingsForm action={createProductWithRepo} submit="Create product" primary>
      <Field name="fullName" label="Repository" hint="Type to search the repositories this account can see, or type owner/name." example="acme/shop" list="setup-repos" value={repo} onChange={(e) => setRepo(e.target.value)} autoComplete="off" required />
      {children}
      <Field name="name" label="Product name" hint="Defaults to the repository name." value={name ?? repo.split('/').pop() ?? ''} onChange={(e) => setName(e.target.value)} required />
      {connections.length > 1 ? <Field name="connection" label="Account" options={connections.map((c) => [String(c.id), c.name])} /> : <input type="hidden" name="connection" value={connections[0]?.id} />}
      <details className="small">
        <summary className="cursor-pointer text-primary">Advanced</summary>
        <div className="mt-3"><Field name="slug" label="Short name" hint="Lowercase letters, digits and dashes; derived from the name when empty." /></div>
      </details>
    </SettingsForm>
  )
}
