import type { Account, MonitorStatus, Order, Product } from './types'

/**
 * HTTP client. The site only talks to its own origin: nginx (or the Vite dev server) forwards
 * /api/* to the api-gateway and /monitor/* to the ml-detector, so no CORS is involved.
 *
 * Every /api call is real traffic through the gateway and ends up in the analysed logs; the
 * /monitor calls do not.
 */
export class ApiError extends Error {
  readonly status?: number

  constructor(message: string, status?: number) {
    super(message)
    this.name = 'ApiError'
    this.status = status
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response
  try {
    response = await fetch(path, {
      ...init,
      headers: init?.body ? { 'Content-Type': 'application/json', ...init.headers } : init?.headers,
    })
  } catch {
    throw new ApiError('The store is not reachable. Is the system running (docker compose up -d)?')
  }
  const text = await response.text()
  let body: unknown = undefined
  if (text) {
    try {
      body = JSON.parse(text)
    } catch {
      body = undefined
    }
  }
  if (!response.ok) {
    const detail = body && typeof body === 'object' ? (body as Record<string, unknown>).detail ?? (body as Record<string, unknown>).title : undefined
    const message =
      typeof detail === 'string' && detail
        ? detail
        : response.status === 502 || response.status === 503 || response.status === 504
          ? 'The store is temporarily unavailable. Please try again in a moment.'
          : `The server answered HTTP ${response.status}.`
    throw new ApiError(message, response.status)
  }
  return body as T
}

const post = <T>(path: string, body: unknown) => request<T>(path, { method: 'POST', body: JSON.stringify(body) })

export const shopApi = {
  products: () => request<Product[]>('/api/products'),
  accounts: () => request<Account[]>('/api/accounts'),
  /** The most recent orders of all customers (the backend returns at most 100). */
  orders: (limit = 100) => request<Order[]>(`/api/orders?limit=${limit}`),
  order: (id: string) => request<Order>(`/api/orders/${encodeURIComponent(id)}`),
  placeOrder: (customerId: string, productId: string, quantity: number) =>
    post<Order>('/api/orders', { customerId, productId, quantity }),
  topUp: (customerId: string, amount: number) =>
    post<Account>(`/api/accounts/${encodeURIComponent(customerId)}/topup`, { amount }),
  restock: (productId: string, quantity: number) =>
    post<Product>(`/api/products/${encodeURIComponent(productId)}/restock`, { quantity }),
}

export const monitorApi = {
  status: () => request<MonitorStatus>('/monitor/api/services'),
}

/** Turns an unknown error into a sentence for the user. */
export function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}
