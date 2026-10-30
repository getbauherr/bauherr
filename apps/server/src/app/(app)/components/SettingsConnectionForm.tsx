'use client'
import { useState } from 'react'
import { saveConnection } from '../(shell)/settings/actions'
import { Field, SettingsForm } from './SettingsForm'

const LABELS: Record<string, string> = { baseUrl: 'Base URL', awsRegion: 'AWS region', vertexProject: 'Vertex project', vertexRegion: 'Vertex region', azureResource: 'Azure resource' }
const GITHUB_HINT = 'GitHub token with access to the repositories and issues'

export type Preset = { required: string[]; hint: string }
export type ConnectionValue = { id?: number; name: string; kind: string; provider: string; config: Record<string, string> }

export function ConnectionForm({ presets, value, submit = 'Save', reset }: { presets: Record<string, Preset>; value?: ConnectionValue; submit?: string; reset?: boolean }) {
  const [kind, setKind] = useState(value?.kind ?? 'github')
  const [provider, setProvider] = useState(value?.provider || 'anthropic')
  const preset = presets[provider]
  return (
    <SettingsForm action={saveConnection} submit={submit} reset={reset}>
      {value?.id && <input type="hidden" name="id" value={value.id} />}
      <Field name="name" label="Name" defaultValue={value?.name} required />
      <Field name="kind" label="Kind" options={['github', 'llm-provider']} defaultValue={kind} onChange={(e) => setKind(e.target.value)} />
      {kind === 'llm-provider' && (
        <>
          <Field name="provider" label="Provider preset" options={Object.keys(presets)} defaultValue={provider} onChange={(e) => setProvider(e.target.value)} />
          {preset.required.map((k) => (
            <Field key={`${provider}-${k}`} name={k} label={LABELS[k]} defaultValue={value?.config[k]} />
          ))}
        </>
      )}
      <Field name="secret" label="Secret" type="password" autoComplete="off" placeholder={value ? 'unchanged' : ''} hint={kind === 'github' ? GITHUB_HINT : preset.hint} />
    </SettingsForm>
  )
}
