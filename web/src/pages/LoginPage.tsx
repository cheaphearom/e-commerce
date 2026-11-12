import { useState, type FormEvent } from 'react'
import { Navigate, useNavigate, useSearchParams } from 'react-router'
import { errorMessage, shopApi } from '../api/client'
import { PageTitle } from '../components/ui'
import { DEMO_ADMIN, DEMO_CUSTOMER_PASSWORD, useAuth } from '../state/auth'

/** Only same-site paths are accepted as the page to return to. */
function safeNext(next: string | null, fallback: string): string {
  return next && next.startsWith('/') && !next.startsWith('//') ? next : fallback
}

export function LoginPage() {
  const { session, signIn } = useAuth()
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const wantedRole = params.get('role')
  const adminWanted = wantedRole === 'admin'
  // signed in with the wrong role for the page that sent us here: offer to switch accounts
  const wrongRole = session !== null && wantedRole !== null && session.role !== wantedRole
  const [username, setUsername] = useState(adminWanted ? 'admin' : '')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  if (session && !wrongRole) return <Navigate to={safeNext(params.get('next'), session.role === 'admin' ? '/admin' : '/account')} replace />

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const isAdmin = username.trim().toLowerCase() === DEMO_ADMIN.username
      const customers = isAdmin ? [] : (await shopApi.accounts()).map((a) => a.customerId)
      const problem = signIn(username, password, customers)
      if (problem) setError(problem)
      else navigate(safeNext(params.get('next'), isAdmin ? '/admin' : '/account'), { replace: true })
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  const fill = (u: string, p: string) => {
    setUsername(u)
    setPassword(p)
  }

  return (
    <div className="login">
      <PageTitle title="Sign in" subtitle={adminWanted ? 'The admin pages need the admin account.' : 'Sign in to check out and see your orders.'} />
      {wrongRole && (
        <div className="notice notice--info login__switch">
          You are signed in as {session.role === 'admin' ? 'the admin' : session.customerId}. Sign in with{' '}
          {adminWanted ? 'the admin account' : 'a customer account'} to open this page.
        </div>
      )}
      <form className="login__form" onSubmit={submit}>
        <label>
          Customer number or “admin”
          <input autoComplete="username" value={username} onChange={(e) => setUsername(e.target.value)} placeholder="C-001" required />
        </label>
        <label>
          Password
          <input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        </label>
        {error && (
          <div className="notice notice--error" role="alert">
            {error}
          </div>
        )}
        <button className="btn btn--primary btn--block" disabled={busy}>
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
      <aside className="demo-accounts">
        <h2>Demo accounts</h2>
        <p className="muted small">
          This is a demo: the backend has no user accounts, so these passwords only guard the pages of this site.
        </p>
        <ul>
          <li>
            <button type="button" className="link-button" onClick={() => fill('C-001', DEMO_CUSTOMER_PASSWORD)}>
              C-001
            </button>{' '}
            – a customer with a large balance
          </li>
          <li>
            <button type="button" className="link-button" onClick={() => fill('C-007', DEMO_CUSTOMER_PASSWORD)}>
              C-007
            </button>{' '}
            – a customer with only $50 (payments get declined)
          </li>
          <li>
            <button type="button" className="link-button" onClick={() => fill(DEMO_ADMIN.username, DEMO_ADMIN.password)}>
              admin
            </button>{' '}
            – the shop admin
          </li>
        </ul>
        <p className="muted small">
          Customers C-001 to C-020 use the password <code>{DEMO_CUSTOMER_PASSWORD}</code>; the admin uses <code>{DEMO_ADMIN.password}</code>.
        </p>
      </aside>
    </div>
  )
}
