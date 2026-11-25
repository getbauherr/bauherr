import { publicUrl } from '../../../lib/oidc'
import { createWebhookSecret } from '../(shell)/settings/webhook-action'
import { CopyField, SettingsForm } from './SettingsForm'
import { SettingsSection } from './SettingsParts'
import { Time } from './Time'
import type { WebhookState } from '../lib/webhook'

const EVENTS: Record<string, string[]> = {
  github: [
    'Issues',
    'Issue comments',
    'Pull requests',
    'Pull request reviews',
    'Check runs',
    'Check suites',
    'Statuses',
    'Deployment statuses',
  ],
  gitlab: ['Issues events', 'Comments', 'Merge request events', 'Pipeline events', 'Deployment events'],
}

const SECRET_FIELD: Record<string, string> = { github: 'Secret', gitlab: 'Secret token' }

const PURPOSE = 'Without a webhook the factory looks every minute. With one it reacts within seconds.'

type Props = { connection: { id: number; name: string; kind: string }; webhook: WebhookState }

export function ConnectionWebhook({ connection, webhook }: Props) {
  const { id, name, kind } = connection
  return (
    <SettingsSection id={`webhook-${id}`} title="Webhook" purpose={PURPOSE}>
      <p className="small mono">{name}</p>
      <div className="flex flex-col gap-1">
        <span className="small font-medium text-foreground">URL to enter at the forge</span>
        <CopyField text={`${publicUrl()}/api/hooks/${id}`} />
      </div>
      <div className="flex flex-col gap-1">
        <span className="small font-medium text-foreground">Events to select there</span>
        <ul className="small m-0 list-inside list-disc text-muted-foreground">
          {EVENTS[kind]?.map((event) => <li key={event}>{event}</li>)}
        </ul>
        <span className="small text-muted-foreground">Enter the secret in the field "{SECRET_FIELD[kind]}".</span>
      </div>
      <SettingsForm
        action={createWebhookSecret}
        submit={webhook.hasSecret ? 'Replace secret' : 'Create secret'}
        confirm={webhook.hasSecret ? 'Confirm replace' : undefined}
        primary={!webhook.hasSecret}
        noticeHint="Shown once. Paste it into the webhook settings at the forge."
        copy
      >
        <input type="hidden" name="id" value={id} />
      </SettingsForm>
      <p className="small text-muted-foreground">
        {webhook.deliveredAt ? <>Last delivery <Time iso={webhook.deliveredAt} /></> : 'No delivery received yet'}
      </p>
    </SettingsSection>
  )
}
