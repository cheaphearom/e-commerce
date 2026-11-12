import { readJson, writeJson } from '../lib/storage'

/**
 * Order ids placed through this site, per customer. The backend's order list only returns the
 * 100 most recent orders of all customers, so the account page also looks these up one by one.
 */
const keyFor = (customerId: string) => `saga-store.orders.${customerId}`
const MAX_REMEMBERED = 200

export function rememberedOrders(customerId: string): string[] {
  return readJson<string[]>(keyFor(customerId), [])
}

export function rememberOrders(customerId: string, ids: string[]): void {
  const merged = [...ids, ...rememberedOrders(customerId).filter((id) => !ids.includes(id))]
  writeJson(keyFor(customerId), merged.slice(0, MAX_REMEMBERED))
}
