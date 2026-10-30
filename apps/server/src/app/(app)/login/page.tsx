import { redirect } from 'next/navigation'
import { login } from '../lib/actions'
import { getBauherr } from '../lib/session'

export default async function Login({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  if (await getBauherr()) redirect('/')
  const { error } = await searchParams
  return (
    <main className="login">
      <div className="brand">
        <svg width="32" height="32" viewBox="0 0 32 32" fill="none" aria-hidden>
          <rect x="3" y="3" width="26" height="26" stroke="currentColor" strokeWidth="2" />
          <rect x="3" y="18" width="11" height="11" fill="var(--accent)" />
        </svg>
        <h1 className="display">Bauherr</h1>
      </div>
      <form action={login}>
        <label className="field">
          <span className="small muted">Email</span>
          <input name="email" type="email" autoComplete="username" required />
        </label>
        <label className="field">
          <span className="small muted">Password</span>
          <input name="password" type="password" autoComplete="current-password" required />
        </label>
        {error && <p role="alert" className="err small">Email or password is wrong. Check both and try again.</p>}
        <button className="btn primary" style={{ justifyContent: 'center' }}>Sign in</button>
      </form>
      {/* Slice 5 (#90): "Sign in with <provider>" button, rendered only when OIDC is configured. */}
      {process.env.OIDC_ISSUER && null}
    </main>
  )
}
