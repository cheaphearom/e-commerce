import { useEffect, useState } from 'react'
import { errorMessage, shopApi } from '../api/client'
import { isFinal, type Order } from '../api/types'

/**
 * Fetches orders by id and keeps polling the unfinished ones (every `intervalMs`, for at most
 * `maxPolls` rounds) until the saga has completed or cancelled them.
 */
export function useOrders(ids: string[], intervalMs = 1500, maxPolls = 60) {
  const [orders, setOrders] = useState<Record<string, Order>>({})
  const [error, setError] = useState<string | null>(null)
  const key = ids.join(',')

  useEffect(() => {
    let cancelled = false
    let polls = 0
    let timer: number | undefined
    const current: Record<string, Order> = {}
    const tick = async () => {
      const pending = ids.filter((id) => !current[id] || !isFinal(current[id].status))
      try {
        const fresh = await Promise.all(pending.map((id) => shopApi.order(id)))
        fresh.forEach((o) => (current[o.id] = o))
        if (!cancelled) {
          setOrders({ ...current })
          setError(null)
        }
      } catch (e) {
        if (!cancelled) setError(errorMessage(e))
      }
      polls += 1
      const stillPending = ids.some((id) => !current[id] || !isFinal(current[id].status))
      if (!cancelled && stillPending && polls < maxPolls) timer = window.setTimeout(tick, intervalMs)
    }
    if (ids.length) void tick()
    return () => {
      cancelled = true
      if (timer) window.clearTimeout(timer)
    }
  }, [key, intervalMs, maxPolls]) // eslint-disable-line react-hooks/exhaustive-deps

  return { orders: ids.map((id) => orders[id]).filter(Boolean) as Order[], error, done: ids.every((id) => orders[id] && isFinal(orders[id].status)) }
}
