'use client'
import { useState } from 'react'
import { saveConnection } from '../(shell)/settings/actions'
import { Field, PickField, SettingsForm } from './SettingsForm'
import { Input } from './ui/input'

const LABELS: Record<string, string> = {
  baseUrl: 'Base URL',
  awsRegion: 'AWS region',
  vertexProject: 'Vertex project',
  vertexRegion: 'Vertex region',
  azureResource: 'Azure resource',
}
const GITLAB_URL = 'https://gitlab.com'
const CHOICES: Record<string, string[]> = {
  awsRegion: [
    'us-east-1',
    'us-east-2',
    'us-west-2',
    'eu-central-1',
    'eu-west-1',
    'eu-west-3',
    'ap-northeast-1',
    'ap-southeast-2',
  ],
  vertexRegion: ['us-east5', 'us-central1', 'europe-west1', 'europe-west4', 'asia-southeast1'],
}
const GITHUB_HINT = 'GitHub token with access to the repositories and issues'
const GITLAB_HINT =
  'Token of a group service account (recommended) with scope api and Developer role on the project; ' +
  'note its expiry'
const AUTH_METHODS: [string, string][] = [
  ['token', 'Personal access token'],
  ['app', 'GitHub App'],
]

export type Preset = { required: string[]; hint: string }
export type ConnectionValue = {
  id?: number
  name: string
  kind: string
  provider: string
  config: Record<string, string>
}

type FormValue = ConnectionValue | undefined

function GithubAppFields({ value }: { value: FormValue }) {
  return (
    <>
      <Field
        name="appId"
        label="App ID"
        inputMode="numeric"
        defaultValue={value?.config.appId}
        hint="Shown on the App's settings page in GitHub"
      />
      <Field
        name="installationId"
        label="Installation ID"
        inputMode="numeric"
        defaultValue={value?.config.installationId}
        hint="The number at the end of the installation's URL in GitHub"
      />
      <Field
        name="secret"
        label="Private key"
        rows={6}
        hint={
          value
            ? 'The App private key (PEM). Leave empty to keep the stored key.'
            : 'The App private key (PEM file contents)'
        }
      />
    </>
  )
}

function ForgeFields({
  kind,
  auth,
  setAuth,
  value,
}: {
  kind: string
  auth: string
  setAuth: (auth: string) => void
  value: FormValue
}) {
  return (
    <>
      {kind === 'gitlab' && (
        <Field
          name="baseUrl"
          label="Base URL"
          type="url"
          hint="Web address of the GitLab instance (https)"
          defaultValue={value?.config.baseUrl ?? GITLAB_URL}
        />
      )}
      {kind === 'github' && (
        <Field
          name="auth"
          label="Authentication"
          options={AUTH_METHODS}
          defaultValue={auth}
          onChange={(e) => setAuth(e.target.value)}
        />
      )}
      {kind === 'github' && auth === 'app' && <GithubAppFields value={value} />}
    </>
  )
}

function ProviderFields({
  presets,
  provider,
  setProvider,
  value,
}: {
  presets: Record<string, Preset>
  provider: string
  setProvider: (provider: string) => void
  value: FormValue
}) {
  const preset = presets[provider]
  return (
    <>
      <Field
        name="provider"
        label="Provider preset"
        options={Object.keys(presets)}
        defaultValue={provider}
        onChange={(e) => setProvider(e.target.value)}
      />
      {preset.required.map((k) =>
        CHOICES[k] ? (
          <PickField
            key={`${provider}-${k}`}
            name={k}
            label={LABELS[k]}
            options={CHOICES[k]}
            defaultValue={value?.config[k] ?? CHOICES[k][0]}
          />
        ) : (
          <Field key={`${provider}-${k}`} name={k} label={LABELS[k]} defaultValue={value?.config[k]} />
        ),
      )}
    </>
  )
}

const hintOf = (kind: string, preset: Preset | undefined) =>
  kind === 'github' ? GITHUB_HINT : kind === 'gitlab' ? GITLAB_HINT : preset?.hint

function SecretField({ kind, value, hint }: { kind: string; value: FormValue; hint?: string }) {
  return (
    <Field
      name="secret"
      label={kind === 'llm-provider' ? 'Secret' : 'Access token'}
      type="password"
      autoComplete="off"
      placeholder={value ? 'unchanged' : ''}
      hint={hint}
    />
  )
}

function useConnectionState(value: FormValue) {
  const [kind, setKind] = useState(value?.kind ?? 'github')
  const [provider, setProvider] = useState(value?.provider || 'anthropic')
  const [auth, setAuth] = useState(value?.config.appId ? 'app' : 'token')
  return { kind, setKind, provider, setProvider, auth, setAuth }
}

export function ConnectionForm({
  presets,
  value,
  submit = 'Save',
  reset,
  primary,
}: {
  presets: Record<string, Preset>
  value?: ConnectionValue
  submit?: string
  reset?: boolean
  primary?: boolean
}) {
  const { kind, setKind, provider, setProvider, auth, setAuth } = useConnectionState(value)
  const preset = presets[provider]
  return (
    <SettingsForm action={saveConnection} submit={submit} reset={reset} primary={primary}>
      {value?.id && <Input type="hidden" name="id" value={value.id} />}
      <Field name="name" label="Name" defaultValue={value?.name} required />
      <Field
        name="kind"
        label="Kind"
        options={['github', 'gitlab', 'llm-provider']}
        defaultValue={kind}
        onChange={(e) => setKind(e.target.value)}
      />
      <ForgeFields kind={kind} auth={auth} setAuth={setAuth} value={value} />
      {kind === 'llm-provider' && (
        <ProviderFields presets={presets} provider={provider} setProvider={setProvider} value={value} />
      )}
      {!(kind === 'github' && auth === 'app') && <SecretField kind={kind} value={value} hint={hintOf(kind, preset)} />}
    </SettingsForm>
  )
}
