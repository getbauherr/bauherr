import { publicUrl } from '../../../../lib/oidc'
import type { AlertState } from '../../../../core/alerts/store'
import { createAlertSecret, saveAlerts } from '../../(shell)/settings/products/[id]/alerts'
import { CopyField, SettingsForm } from '../SettingsForm'
import { SettingsSection, ToggleRow } from '../SettingsParts'
import { Input } from '../ui/input'
import { Editable } from './Editable'

const PURPOSE = 'Turn alerts from your monitoring into tickets. Each alert is treated as a bug report.'

type Props = { product: number; state: AlertState; admin: boolean }

export function AlertsSection({ product, state, admin }: Props) {
  return (
    <SettingsSection id="alerts" title="Production alerts" purpose={PURPOSE}>
      <Editable admin={admin}>
        <SettingsForm action={saveAlerts} submit="Save alerts">
          <Input type="hidden" name="id" value={product} />
          <ToggleRow
            name="incidentIntake"
            label="Create tickets from production alerts"
            help="An open ticket for the same alert gets a comment instead of a new ticket."
            defaultChecked={state.enabled}
          />
        </SettingsForm>
        {state.enabled && (
          <>
            <div className="flex flex-col gap-1">
              <span className="small font-medium text-foreground">Webhook URL</span>
              <CopyField text={`${publicUrl()}/api/alerts/${product}`} />
              <span className="small text-muted-foreground">
                Send the secret as <span className="mono">Authorization: Bearer</span> credentials.
              </span>
            </div>
            <SettingsForm
              action={createAlertSecret}
              submit={state.hasSecret ? 'Replace secret' : 'Create secret'}
              confirm={state.hasSecret ? 'Confirm replace' : undefined}
              primary={!state.hasSecret}
              noticeHint="Shown once. Paste it into the contact point."
              copy
            >
              <Input type="hidden" name="id" value={product} />
            </SettingsForm>
          </>
        )}
      </Editable>
    </SettingsSection>
  )
}
