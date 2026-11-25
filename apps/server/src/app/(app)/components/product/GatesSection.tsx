import type { ProductSettings } from '../../../../core/views/product-settings'
import { formatPathSets } from '../../../../lib/path-sets'
import { savePathSets } from '../../(shell)/settings/actions'
import { saveGates } from '../../(shell)/settings/products/[id]/actions'
import { LIMIT } from '../../lib/product-sections'
import { Field, SettingsForm } from '../SettingsForm'
import { SettingsSection } from '../SettingsParts'
import { Editable } from './Editable'
import { RiskAreaPicks } from './RiskAreaPicks'

const PURPOSE =
  'A Brief card goes to you when it has an open decision, a change that cannot be undone, ' +
  'a change in a risk area, a change a user will see on a screen, a request from an outside author, ' +
  'when it comes from the backlog, or when it is a check asked for from a memory.'
const PATH_SET_HINT =
  'One set per line: its name, a colon, then paths separated by commas. A path may use * and **.'

type Props = { product: ProductSettings; admin: boolean }

export function GatesSection({ product, admin }: Props) {
  return (
    <SettingsSection id="gates" title="Gates" purpose={PURPOSE}>
      <Editable admin={admin}>
        <SettingsForm action={saveGates} submit="Save gates">
          <input type="hidden" name="id" value={product.id} />
          <RiskAreaPicks sets={product.pathSets} chosen={product.riskAreas} />
          <Field
            name="backlogBriefLimit"
            label="Briefs waiting on you at a time"
            type="number"
            min={LIMIT.min}
            max={LIMIT.max}
            inputMode="numeric"
            defaultValue={product.backlogBriefLimit}
          />
        </SettingsForm>
        <SettingsForm action={savePathSets} submit="Save path sets">
          <input type="hidden" name="id" value={product.id} />
          <Field
            name="sets"
            label="Path sets"
            hint={PATH_SET_HINT}
            rows={5}
            defaultValue={formatPathSets(product.pathSets)}
            example="security: src/auth/**, src/api/**"
          />
        </SettingsForm>
      </Editable>
    </SettingsSection>
  )
}
