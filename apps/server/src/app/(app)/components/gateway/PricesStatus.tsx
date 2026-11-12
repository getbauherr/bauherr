import { SettingsForm } from '../SettingsForm'
import { ago } from '../../lib/format'
import type { Prices } from '../../lib/gateway-setup'
import { updatePricesNow } from '../../(shell)/settings/actions'

/** "Prices updated <date> from <source>, N models", the last error of the daily refresh, and for an Admin "Update now". */
export function PricesStatus({ prices, admin }: { prices: Prices; admin: boolean }) {
  const s = prices.status
  return (
    <section id="prices" aria-label="Prices and models" className="flex flex-col gap-3" data-testid="prices-status">
      <h3 className="heading">Prices and models</h3>
      {!prices.enabled ? (
        <p className="small m-0 text-muted-foreground">Automatic price updates are switched off on this instance (BAUHERR_PRICES_REFRESH=0). The prices shipped with Bauherr are used.</p>
      ) : s?.fetchedAt ? (
        <p className="small m-0">Prices updated {ago(s.fetchedAt)} from {s.source}, {s.models.toLocaleString('en')} models. They refresh once a day; new models are priced without any action.</p>
      ) : (
        <p className="small m-0 text-muted-foreground">Prices have not been fetched yet; the prices shipped with Bauherr are used until the first update.</p>
      )}
      {!!s?.changed?.length && (
        <p className="small m-0" data-testid="prices-changed">Changed: {s.changed.map((c) => [c.model, [c.input && `input ${c.input[0]} → ${c.input[1]}`, c.output && `output ${c.output[0]} → ${c.output[1]}`].filter(Boolean).join(', ')].join(' ')).join('; ')} (USD per million tokens, models your tiers and roles use).</p>
      )}
      {s?.error && <p className="small m-0 text-destructive" role="alert" data-testid="prices-error">Last update failed {ago(s.error.at)}: {s.error.message}</p>}
      {admin && prices.enabled && <SettingsForm action={updatePricesNow} submit="Update now" />}
    </section>
  )
}
