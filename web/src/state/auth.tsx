import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react'
import { readJson, remove, writeJson } from '../lib/storage'

/**
 * Demo sign-in. The backend has no user accounts, so the passwords below only gate the pages of
 * this site; they do not protect the API. Customers are the seeded accounts C-001 to C-020.
 */
export const DEMO_CUSTOMER_PASSWORD = 'shop123'
export const DEMO_ADMIN = { username: 'admin', password: 'admin123' }

export type Session = { role: 'customer'; customerId: string } | { role: 'admin' }

const KEY = 'saga-store.session'

interface AuthValue {
  session: Session | null
  customerId: string | null
  isAdmin: boolean
  /** Returns an error message, or null when signed in. */
  signIn: (username: string, password: string, knownCustomers: string[]) => string | null
  signOut: () => void
}

const AuthContext = createContext<AuthValue | null>(null)

/** C-1, c001, "C-001" -> "C-001" */
export function normaliseCustomerId(input: string): string {
  const m = /^\s*c-?0*(\d{1,3})\s*$/i.exec(input)
  return m ? `C-${m[1].padStart(3, '0')}` : input.trim().toUpperCase()
}

export function checkCredentials(username: string, password: string, knownCustomers: string[]): Session | string {
  if (username.trim().toLowerCase() === DEMO_ADMIN.username) {
    return password === DEMO_ADMIN.password ? { role: 'admin' } : 'Wrong password for the admin account'
  }
  const id = normaliseCustomerId(username)
  if (!knownCustomers.includes(id)) return `There is no customer account "${username.trim()}"`
  if (password !== DEMO_CUSTOMER_PASSWORD) return 'Wrong password'
  return { role: 'customer', customerId: id }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(() => readJson<Session | null>(KEY, null))

  const signIn = useCallback((username: string, password: string, knownCustomers: string[]) => {
    const result = checkCredentials(username, password, knownCustomers)
    if (typeof result === 'string') return result
    writeJson(KEY, result)
    setSession(result)
    return null
  }, [])

  const signOut = useCallback(() => {
    remove(KEY)
    setSession(null)
  }, [])

  const value = useMemo<AuthValue>(
    () => ({
      session,
      customerId: session?.role === 'customer' ? session.customerId : null,
      isAdmin: session?.role === 'admin',
      signIn,
      signOut,
    }),
    [session, signIn, signOut],
  )
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthValue {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>')
  return ctx
}
