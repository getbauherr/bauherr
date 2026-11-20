'use client'
import { useState } from 'react'
import { CopyField, Field } from '../SettingsForm'

const PLACEHOLDER_KEY = '<agent key>'
const ROLES = ['builder', 'verifier', 'reviewer']

export function ConnectSession({ url, token }: { url: string; token?: string }) {
  const [role, setRole] = useState(ROLES[0])
  const header = `Authorization: Bearer ${token ?? PLACEHOLDER_KEY}`
  const command = `claude mcp add --transport http bauherr ${url}/mcp --header "${header}"`
  return (
    <section aria-labelledby="connect-session" className="flex flex-col gap-4">
      <h2 id="connect-session" className="heading">
        Connect a Claude Code session
      </h2>
      <CopyField text={command} block />
      <p className="small">Then start Claude Code in a clone of the repository and say:</p>
      <Field name="role" label="Role" options={ROLES} onChange={(e) => setRole(e.target.value)} />
      <CopyField text={`Connect to bauherr as ${role} and work the queue.`} />
      <p className="small text-muted-foreground">
        The session works with your git and forge login. It cannot approve a Brief or accept a Result.
      </p>
    </section>
  )
}
