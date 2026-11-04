import { REPAIR_STAGES } from '../../../lib/actions'
import { relinkRunAction, repairTicketAction } from '../lib/actions'
import { stageLabel } from '../../../lib/needs-you'
import { Reveal } from './Reveal'
import { Field, SettingsForm } from './SettingsForm'

const REPAIRS: [kind: string, label: string, hint: string][] = [
  ['clear-waiting', 'Clear waiting', 'Drops the wait for a full column; the next sweep decides again.'],
  ['reset-counters', 'Reset counters', 'Zeroes gate polls, merge failures, release attempts, review rounds and conflict returns.'],
  ['rank-top', 'Move to top', 'Puts the Ticket first on the Board.'],
]

/** Admin-only repair disclosure on the Ticket page; every action is recorded as a `repair:*` human touch (Audit). */
export function FixState({ ticket, stage }: { ticket: number; stage: string }) {
  const action = repairTicketAction.bind(null, ticket)
  return (
    <Reveal label="Repair">
      <p className="small text-muted-foreground">Admin only. Fixes a Ticket the factory left in a wrong state.</p>
      <SettingsForm action={action} submit="Set stage" confirm="Confirm set stage" inline>
        <input type="hidden" name="kind" value="stage" />
        <Field name="stage" label="Stage" hint="Moves the forge label and the stage." options={REPAIR_STAGES.map((s) => [s, stageLabel(s)] as [string, string])} defaultValue={stage} />
      </SettingsForm>
      {REPAIRS.map(([kind, label, hint]) => (
        <SettingsForm key={kind} action={action} submit={label} confirm={`Confirm ${label.toLowerCase()}`} inline>
          <input type="hidden" name="kind" value={kind} />
          <p className="small text-muted-foreground">{hint}</p>
        </SettingsForm>
      ))}
    </Reveal>
  )
}

/** Admin-only: link a Build Run to the replacement MR that took over from a closed one. */
export function RelinkMr({ run }: { run: number }) {
  return (
    <Reveal label="Relink MR">
      <SettingsForm action={relinkRunAction.bind(null, run)} submit="Relink" inline>
        <Field name="prUrl" label="Replacement MR URL" hint="An open MR of this Ticket from a bauherr/<number>-... branch." type="url" required />
      </SettingsForm>
    </Reveal>
  )
}
