import type { ReactNode } from 'react'
import type { OrderStatus } from '../api/types'
import { statusLabel } from '../lib/format'

export function Spinner({ label = 'Loading…' }: { label?: string }) {
  return (
    <div className="spinner" role="status">
      <span className="spinner__dot" aria-hidden="true" />
      {label}
    </div>
  )
}

export function ErrorBox({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="notice notice--error" role="alert">
      <strong>Something went wrong.</strong> {message}
      {onRetry && (
        <button className="btn btn--small btn--ghost" onClick={onRetry}>
          Try again
        </button>
      )}
    </div>
  )
}

export function Notice({ tone = 'info', children }: { tone?: 'info' | 'warning' | 'success'; children: ReactNode }) {
  return <div className={`notice notice--${tone}`}>{children}</div>
}

/** Order status with an icon and a word, never colour alone. */
export function StatusBadge({ status }: { status: OrderStatus }) {
  const tone = status === 'COMPLETED' ? 'good' : status === 'CANCELLED' ? 'bad' : 'pending'
  const icon = tone === 'good' ? '✓' : tone === 'bad' ? '✕' : '⏳'
  return (
    <span className={`badge badge--${tone}`}>
      <span aria-hidden="true">{icon}</span> {statusLabel(status)}
    </span>
  )
}

export function QuantityStepper({
  value,
  onChange,
  min = 1,
  max = 100,
  label,
}: {
  value: number
  onChange: (v: number) => void
  min?: number
  max?: number
  label: string
}) {
  return (
    <div className="stepper" role="group" aria-label={label}>
      <button type="button" aria-label="Decrease quantity" onClick={() => onChange(Math.max(min, value - 1))} disabled={value <= min}>
        −
      </button>
      <input
        aria-label={label}
        inputMode="numeric"
        value={value}
        onChange={(e) => {
          const n = Number(e.target.value.replace(/\D/g, ''))
          if (!Number.isNaN(n)) onChange(Math.min(max, Math.max(min, n)))
        }}
      />
      <button type="button" aria-label="Increase quantity" onClick={() => onChange(Math.min(max, value + 1))} disabled={value >= max}>
        +
      </button>
    </div>
  )
}

export function PageTitle({ title, subtitle }: { title: string; subtitle?: ReactNode }) {
  return (
    <header className="page-title">
      <h1>{title}</h1>
      {subtitle && <p>{subtitle}</p>}
    </header>
  )
}
