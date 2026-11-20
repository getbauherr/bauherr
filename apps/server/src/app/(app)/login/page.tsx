import { redirect } from 'next/navigation'
import { oidcDisplayName, oidcEnabled } from '../../../lib/oidc'
import { login } from '../lib/actions'
import { getPerson } from '../lib/session'
import { Button } from '../components/ui/button'
import { Input } from '../components/ui/input'

const SSO_ERRORS = new Map([
  ['oidc-link', 'This email already has a Bauherr account. Ask an Admin to link it to your SSO identity.'],
  ['oidc-role', 'Your SSO account has no access to this Bauherr. Ask an Admin.'],
  ['oidc', 'Single sign-on failed. Try again or use your password.'],
])

function PasswordForm({ sso, passwordError }: { sso: boolean; passwordError: boolean }) {
  return (
    <form action={login} className="flex flex-col gap-4">
      <label className="flex flex-col gap-1">
        <span className="small text-muted-foreground">Email</span>
        <Input name="email" type="email" autoComplete="username" required />
      </label>
      <label className="flex flex-col gap-1">
        <span className="small text-muted-foreground">Password</span>
        <Input name="password" type="password" autoComplete="current-password" required />
      </label>
      {passwordError && (
        <p role="alert" className="small text-destructive">
          Email or password is wrong. Check both and try again.
        </p>
      )}
      <Button variant={sso ? 'outline' : 'default'}>Sign in</Button>
    </form>
  )
}

export default async function Login({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const person = await getPerson()
  if (person) redirect('/')
  const { error } = await searchParams
  const sso = oidcEnabled()
  const ssoError = error ? SSO_ERRORS.get(error) : undefined
  const passwordError = !!error && !SSO_ERRORS.has(error)
  const form = <PasswordForm sso={sso} passwordError={passwordError} />
  return (
    <main className="mx-auto my-12 flex max-w-[360px] flex-col gap-6 px-4">
      <div className="flex items-center gap-2">
        <svg width="32" height="32" viewBox="0 0 32 32" fill="none" aria-hidden>
          <rect x="3" y="3" width="26" height="26" stroke="currentColor" strokeWidth="2" />
          <rect x="3" y="18" width="11" height="11" fill="var(--accent)" />
        </svg>
        <h1 className="display">Bauherr</h1>
      </div>
      {ssoError && (
        <p role="alert" className="small text-destructive">
          {ssoError}
        </p>
      )}
      {sso && (
        <Button asChild>
          <a href="/auth/oidc/login">Sign in with {oidcDisplayName()}</a>
        </Button>
      )}
      {sso ? (
        <details open={passwordError} className="flex flex-col gap-4">
          <summary className="small cursor-pointer text-muted-foreground">Use password</summary>
          {form}
        </details>
      ) : (
        form
      )}
    </main>
  )
}
