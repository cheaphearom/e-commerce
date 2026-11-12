import type { ReactNode } from 'react'
import { Navigate, useLocation } from 'react-router'
import { useAuth } from '../state/auth'

/** Sends visitors to the sign-in page (and back here afterwards) unless they have the role. */
export function RequireAuth({ role, children }: { role: 'customer' | 'admin'; children: ReactNode }) {
  const { session } = useAuth()
  const location = useLocation()
  if (session?.role === role) return <>{children}</>
  const next = encodeURIComponent(location.pathname + location.search)
  return <Navigate to={`/login?next=${next}&role=${role}`} replace />
}
