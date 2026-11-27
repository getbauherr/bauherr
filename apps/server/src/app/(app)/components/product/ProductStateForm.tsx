import { setProductState } from '../../(shell)/settings/state-action'
import { SettingsForm } from '../SettingsForm'
import { Input } from '../ui/input'

type Props = { product: number; state: 'observing' | 'active'; primary?: boolean }

export function ProductStateForm({ product, state, primary }: Props) {
  const label = state === 'active' ? 'Switch back to observing' : 'Switch on'
  return (
    <SettingsForm action={setProductState} submit={label} primary={primary}>
      <Input type="hidden" name="id" value={product} />
      <Input type="hidden" name="state" value={state === 'active' ? 'observing' : 'active'} />
    </SettingsForm>
  )
}
