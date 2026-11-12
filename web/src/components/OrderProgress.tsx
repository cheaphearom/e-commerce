import type { Order } from '../api/types'
import { failureText } from '../lib/format'

type StepState = 'done' | 'active' | 'failed' | 'todo' | 'undone'

/** The saga as the customer sees it: placed → stock reserved → paid → completed (or rolled back). */
export function orderSteps(order: Order): { label: string; state: StepState; note?: string }[] {
  const reason = order.failureReason ?? ''
  if (order.status === 'CANCELLED') {
    const failedAtStock = reason === 'OUT_OF_STOCK' || reason === 'UNKNOWN_PRODUCT'
    if (failedAtStock) {
      return [
        { label: 'Order placed', state: 'done' },
        { label: 'Stock reserved', state: 'failed', note: failureText(reason) },
        { label: 'Payment', state: 'todo' },
        { label: 'Cancelled', state: 'failed', note: 'Nothing was charged' },
      ]
    }
    return [
      { label: 'Order placed', state: 'done' },
      { label: 'Stock reserved', state: 'undone', note: 'Released again' },
      { label: 'Payment', state: 'failed', note: failureText(reason) },
      { label: 'Cancelled', state: 'failed', note: reason === 'INSUFFICIENT_FUNDS' ? 'Nothing was charged' : 'Any charge is refunded' },
    ]
  }
  const reserved = order.status === 'INVENTORY_RESERVED' || order.status === 'COMPLETED'
  const paid = order.status === 'COMPLETED'
  return [
    { label: 'Order placed', state: 'done' },
    { label: 'Stock reserved', state: reserved ? 'done' : 'active' },
    { label: 'Payment', state: paid ? 'done' : reserved ? 'active' : 'todo' },
    { label: 'Completed', state: paid ? 'done' : 'todo' },
  ]
}

const ICON: Record<StepState, string> = { done: '✓', active: '…', failed: '✕', todo: '', undone: '↺' }

export function OrderProgress({ order }: { order: Order }) {
  return (
    <ol className="progress" aria-label="Order progress">
      {orderSteps(order).map((s) => (
        <li key={s.label} className={`progress__step progress__step--${s.state}`}>
          <span className="progress__dot" aria-hidden="true">
            {ICON[s.state]}
          </span>
          <span className="progress__label">
            {s.label}
            {s.note && <span className="progress__note">{s.note}</span>}
          </span>
        </li>
      ))}
    </ol>
  )
}
