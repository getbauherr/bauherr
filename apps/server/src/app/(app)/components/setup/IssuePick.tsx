import { Suspense } from 'react'
import { ticketsOf } from '../../../../lib/actions'
import { importIssue } from '../../(shell)/setup/actions'
import { within, FORGE_TIMEOUT_MS } from '../../lib/overview'
import { payloadClient } from '../../lib/session'
import { Field, SettingsForm } from '../SettingsForm'

const SHOWN = 20

/** Streamed: the Product's open issues as radio rows. The manual field is always there, so a slow or failing forge never blocks the step. */
async function Issues({ product }: { product: number }) {
  const issues = await within(ticketsOf(await payloadClient(), product).then((ts) => ts.list({ state: 'open' })), FORGE_TIMEOUT_MS).catch(() => null)
  if (!issues) return <p className="small text-muted-foreground" role="status">Could not read the open issues from the forge right now. Type the issue number below.</p>
  if (!issues.length) return <p className="small text-muted-foreground" role="status">No open issues in this repository. Describe something new instead.</p>
  return (
    <fieldset className="m-0 flex flex-col gap-2 border-0 p-0">
      <legend className="small mb-2 p-0 font-medium text-foreground">Open issues</legend>
      {issues.slice(0, SHOWN).map((i) => (
        <label key={i.id} className="flex cursor-pointer items-start gap-3 rounded-md border border-border bg-card p-3 has-checked:bg-accent has-checked:outline-2 has-checked:-outline-offset-1 has-checked:outline-primary has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-ring">
          <input type="radio" name="number" value={i.number} className="mt-1 accent-primary" />
          <span className="flex min-w-0 flex-col"><span className="font-medium text-foreground">{i.title}</span><span className="small mono text-muted-foreground">#{i.number}</span></span>
        </label>
      ))}
    </fieldset>
  )
}

/** Step 5, first tab: pick an open issue (or type its number) and send it to Triage. */
export const IssuePick = ({ product }: { product: number }) => (
  <SettingsForm action={importIssue} submit="Send to Triage" primary>
    <Suspense fallback={<p className="small text-muted-foreground" role="status">Loading open issues…</p>}>
      <Issues product={product} />
    </Suspense>
    <Field name="manual" label="Or type an issue number" example="12" inputMode="numeric" autoComplete="off" />
  </SettingsForm>
)
