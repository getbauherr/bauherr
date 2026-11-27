import { removeDoc } from '../../(shell)/settings/actions'
import { SettingsForm } from '../SettingsForm'
import { Input } from '../ui/input'

export function RemoveDoc({ collection, id, label }: { collection: string; id: number; label: string }) {
  return (
    <SettingsForm action={removeDoc} submit={label} confirm="Confirm remove" inline>
      <Input type="hidden" name="collection" value={collection} />
      <Input type="hidden" name="id" value={id} />
    </SettingsForm>
  )
}
