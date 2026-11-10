'use client'
import { useState } from 'react'
import { saveConnection } from '../(shell)/settings/actions'
import { Field, PickField, SettingsForm } from './SettingsForm'

const LABELS: Record<string, string> = { baseUrl: 'Base URL', awsRegion: 'AWS region', vertexProject: 'Vertex project', vertexRegion: 'Vertex region', azureResource: 'Azure resource' }
const GITLAB_URL = 'https://gitlab.com'
/** Preset fields with a known set of values (the first is the default) and the Other... fallback. */
const CHOICES: Record<string, string[]> = {
  awsRegion: ['us-east-1', 'us-east-2', 'us-west-2', 'eu-central-1', 'eu-west-1', 'eu-west-3', 'ap-northeast-1', 'ap-southeast-2'],
  vertexRegion: ['us-east5', 'us-central1', 'europe-west1', 'europe-west4', 'asia-southeast1'],
}
const GITHUB_HINT = 'GitHub token with access to the repositories and issues'
const GITLAB_HINT = 'Access token with scope api and Developer role on the project; note its expiry'

export type Preset = { required: string[]; hint: string }
export type ConnectionValue = { id?: number; name: string; kind: string; provider: string; config: Record<string, string> }

export function ConnectionForm({ presets, value, submit = 'Save', reset, primary }: { presets: Record<string, Preset>; value?: ConnectionValue; submit?: string; reset?: boolean; primary?: boolean }) {
  const [kind, setKind] = useState(value?.kind ?? 'github')
  const [provider, setProvider] = useState(value?.provider || 'anthropic')
  const preset = presets[provider]
  return (
    <SettingsForm action={saveConnection} submit={submit} reset={reset} primary={primary}>
      {value?.id && <input type="hidden" name="id" value={value.id} />}
      <Field name="name" label="Name" defaultValue={value?.name} required />
      <Field name="kind" label="Kind" options={['github', 'gitlab', 'llm-provider']} defaultValue={kind} onChange={(e) => setKind(e.target.value)} />
      {kind === 'gitlab' && <Field name="baseUrl" label="Base URL" type="url" hint="Web address of the GitLab instance (https)" defaultValue={value?.config.baseUrl ?? GITLAB_URL} />}
      {kind === 'llm-provider' && (
        <>
          <Field name="provider" label="Provider preset" options={Object.keys(presets)} defaultValue={provider} onChange={(e) => setProvider(e.target.value)} />
          {preset.required.map((k) => (
            CHOICES[k] ? <PickField key={`${provider}-${k}`} name={k} label={LABELS[k]} options={CHOICES[k]} defaultValue={value?.config[k] ?? CHOICES[k][0]} /> : <Field key={`${provider}-${k}`} name={k} label={LABELS[k]} defaultValue={value?.config[k]} />
          ))}
        </>
      )}
      <Field name="secret" label="Secret" type="password" autoComplete="off" placeholder={value ? 'unchanged' : ''} hint={kind === 'github' ? GITHUB_HINT : kind === 'gitlab' ? GITLAB_HINT : preset.hint} />
    </SettingsForm>
  )
}
