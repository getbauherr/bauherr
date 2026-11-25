import { RELEASE_CHECK_IDS } from '../../../../core/readiness/release-checks'
import type { ReadinessView } from '../../../../core/readiness/view'
import type { ProductSettings } from '../../../../core/views/product-settings'
import { saveReleaseMode } from '../../(shell)/settings/products/[id]/actions'
import { SettingsForm } from '../SettingsForm'
import { RadioCards } from '../SettingsParts'
import { Badge } from '../ui/badge'
import { Editable } from './Editable'
import { Row } from './ReadinessSection'

const MODES = [
  {
    value: 'factory',
    title: 'Released by the factory',
    text: 'Staging on every merge, production on "Release".',
  },
  {
    value: 'direct',
    title: 'Every merge goes straight to production',
    text: 'No release step; notes per merge.',
  },
]

type Props = { product: ProductSettings; view: ReadinessView; admin: boolean }

export function ReleasesSection({ product, view, admin }: Props) {
  const items = view.items.filter((item) => RELEASE_CHECK_IDS.some((id) => id === item.id))
  const { release } = view
  return (
    <section id="releases" aria-labelledby="releases-title" className="grid scroll-mt-4 gap-3">
      <div className="flex flex-wrap items-center gap-3">
        <h2 id="releases-title" className="heading">Releases</h2>
        {release.mode === 'factory' && release.blocked && <Badge variant="warn">Release blocked</Badge>}
        {release.mode === 'factory' && !release.blocked && <Badge variant="ok">Ready to release</Badge>}
      </div>
      <Editable admin={admin}>
        <SettingsForm action={saveReleaseMode} submit="Save">
          <input type="hidden" name="id" value={product.id} />
          <RadioCards
            name="releaseMode"
            legend="How does this product release?"
            value={product.releaseMode}
            options={MODES}
          />
        </SettingsForm>
      </Editable>
      {release.mode === 'direct' ? (
        <p className="small text-muted-foreground">No release step, so nothing is checked.</p>
      ) : (
        <ul className="m-0 list-none overflow-hidden rounded-md border border-border bg-card p-0">
          {items.map((item) => (
            <Row key={item.id} item={item} product={product.id} admin={admin} />
          ))}
        </ul>
      )}
    </section>
  )
}
