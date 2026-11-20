import { removeDoc } from '../../(shell)/settings/actions'
import { SettingsForm } from '../SettingsForm'

export function RemoveDoc({ collection, id, label }: { collection: string; id: number; label: string }) {
  return (
    <SettingsForm action={removeDoc} submit={label} confirm="Confirm remove" inline>
      <input type="hidden" name="collection" value={collection} />
      <input type="hidden" name="id" value={id} />
    </SettingsForm>
  )
}
