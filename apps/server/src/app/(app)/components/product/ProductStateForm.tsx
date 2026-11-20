import { setProductState } from '../../(shell)/settings/state-action'
import { SettingsForm } from '../SettingsForm'

type Props = { product: number; state: 'observing' | 'active'; primary?: boolean }

export function ProductStateForm({ product, state, primary }: Props) {
  const label = state === 'active' ? 'Switch back to observing' : 'Switch on'
  return (
    <SettingsForm action={setProductState} submit={label} primary={primary}>
      <input type="hidden" name="id" value={product} />
      <input type="hidden" name="state" value={state === 'active' ? 'observing' : 'active'} />
    </SettingsForm>
  )
}
