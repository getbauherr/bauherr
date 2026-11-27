import type { ProductSettings } from '../../../../core/views/product-settings'
import { copyForgeChecks, saveProof } from '../../(shell)/settings/products/[id]/actions'
import { DEPLOY_MINUTES, namesIn } from '../../lib/product-sections'
import { Field, MultiPick, SettingsForm } from '../SettingsForm'
import { SettingsSection } from '../SettingsParts'
import { Editable } from './Editable'
import { Input } from '../ui/input'

type Props = { product: ProductSettings; forgeChecks: string[]; admin: boolean }

const optionsOf = (forgeChecks: string[]) => forgeChecks.map((value) => ({ value, meta: 'required by the forge' }))

export function ProofSection({ product, forgeChecks, admin }: Props) {
  const offer = namesIn(product.requiredChecks).length === 0 && forgeChecks.length > 0
  return (
    <SettingsSection id="proof" title="Proof" purpose="What a change must show before you are asked to accept it.">
      <Editable admin={admin}>
        {offer && (
          <SettingsForm action={copyForgeChecks} submit="Use the checks the forge requires">
            <Input type="hidden" name="id" value={product.id} />
            <p className="small text-muted-foreground">
              The forge requires <span className="mono">{forgeChecks.join(' · ')}</span>.
            </p>
          </SettingsForm>
        )}
        <SettingsForm action={saveProof} submit="Save proof">
          <Input type="hidden" name="id" value={product.id} />
          <MultiPick
            name="requiredChecks"
            legend="Required checks"
            hint="A change must pass these before Verify. Empty: Verify does not wait for checks."
            options={optionsOf(forgeChecks)}
            value={namesIn(product.requiredChecks)}
            addLabel="Add a check that has not run yet"
            example="test"
            missingMeta="added by hand"
          />
          <MultiPick
            name="deployChecks"
            legend="Deploy checks"
            hint="These mean the change is on staging. Empty: Ship does not wait for a deploy."
            options={optionsOf(forgeChecks)}
            value={namesIn(product.deployChecks)}
            addLabel="Add a deploy check"
            example="deploy-staging"
            missingMeta="added by hand"
          />
          <Field
            name="deployWaitMinutes"
            label="Ask me when the deploy has not finished after … minutes"
            type="number"
            inputMode="numeric"
            min={DEPLOY_MINUTES.min}
            max={DEPLOY_MINUTES.max}
            hint="Counted from the merge. You then choose to check again or to go on."
            defaultValue={product.deployWaitMinutes}
          />
          <Field
            name="stagingUrl"
            label="Staging site"
            type="url"
            hint="Where you try changes before they go live."
            example="https://staging.acme.com"
            defaultValue={product.stagingUrl}
          />
        </SettingsForm>
      </Editable>
    </SettingsSection>
  )
}
