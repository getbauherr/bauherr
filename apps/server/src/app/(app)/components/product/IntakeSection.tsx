import { CAPS } from '../../../../core/caps'
import { INTAKE_LABEL } from '../../../../core/intake/select'
import type { ProductSettings } from '../../../../core/views/product-settings'
import { saveIntake } from '../../(shell)/settings/products/[id]/actions'
import { DAYS, LIMIT } from '../../lib/product-sections'
import { Field, MultiPick, SettingsForm } from '../SettingsForm'
import { SettingsSection, ToggleRow } from '../SettingsParts'
import { Editable } from './Editable'
import { Input } from '../ui/input'

const PURPOSE = 'Which issues enter, how many an outsider may add and when a reporter is chased.'

const numeric = (range: { min: number; max: number }) =>
  ({ type: 'number', min: range.min, max: range.max, inputMode: 'numeric' }) as const

const HINT =
  'An issue with one of these labels never enters. bauherr:someday is on by default and parks an idea as ' +
  'Someday: label the issue to park it, remove the label to bring it back. A Ticket that has entered stays.'

type Props = { product: ProductSettings; admin: boolean }

export function IntakeSection({ product, admin }: Props) {
  return (
    <SettingsSection id="intake" title="Intake" purpose={PURPOSE}>
      <p className="small text-muted-foreground">
        Issues from authors outside the team wait for the label <span className="mono">{INTAKE_LABEL}</span>.
      </p>
      <Editable admin={admin}>
        <SettingsForm action={saveIntake} submit="Save intake">
          <Input type="hidden" name="id" value={product.id} />
          <MultiPick
            name="excludedLabels"
            legend="Excluded labels"
            hint={HINT}
            options={[]}
            value={product.excludedLabels}
            addLabel="Add an excluded label"
            example="wontfix"
            missingMeta="excluded"
          />
          <Field
            name="outsideIssuesPerDay"
            label="Outside issues per author and day"
            defaultValue={product.outsideIssuesPerDay}
            {...numeric(LIMIT)}
          />
          <Field
            name="reporterRemindDays"
            label="Remind a reporter after (days)"
            defaultValue={product.reporterRemindDays}
            {...numeric(DAYS)}
          />
          <Field
            name="reporterSilentDays"
            label="Count a reporter as silent after (days)"
            defaultValue={product.reporterSilentDays}
            {...numeric(DAYS)}
          />
          <p className="small text-muted-foreground">
            Questions to a reporter: at most <span className="mono">{CAPS.reporterRounds}</span> rounds,
            then you decide.
          </p>
          <ToggleRow
            name="autoClose"
            label="Close automatically"
            help="Close duplicates and issues declined as not planned on the forge."
            defaultChecked={product.autoClose}
          />
        </SettingsForm>
      </Editable>
    </SettingsSection>
  )
}
