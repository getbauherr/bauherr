'use client'
import type { FormState } from '../../lib/settings'
import { Field, SettingsForm } from '../SettingsForm'
import { ConnectSession } from './ConnectSession'

export function AgentKeyForm({
  action,
  url,
}: {
  action: (state: FormState, fd: FormData) => Promise<FormState>
  url: string
}) {
  return (
    <SettingsForm
      action={action}
      submit="Create agent key"
      primary
      reset
      copy
      after={(state) => <ConnectSession url={url} token={state.notice} />}
    >
      <Field name="label" label="Label" hint="Where it runs, e.g. laptop" />
    </SettingsForm>
  )
}
