import { render } from '@testing-library/react'
import { RouterProvider, createMemoryRouter } from 'react-router'
import { vi } from 'vitest'
import type { Account, Order, Product } from '../api/types'
import { routes } from '../routes'
import { AuthProvider, type Session } from '../state/auth'
import { CartProvider, type CartLine } from '../state/cart'
import { ExperimentProvider } from '../state/experiment'

/**
 * An in-memory api-gateway (/api) and ml-detector (/monitor) behind `fetch`. Orders move from
 * PENDING to INVENTORY_RESERVED to COMPLETED on successive look-ups, and are cancelled with
 * INSUFFICIENT_FUNDS when the wallet cannot pay, like the real saga.
 */
export class FakeShop {
  products: Product[] = [
    { id: 'P-100', name: 'USB-C Cable', price: 9.99, availableStock: 474, reservedStock: 26 },
    { id: 'P-101', name: 'Wireless Mouse', price: 24.5, availableStock: 472, reservedStock: 28 },
    { id: 'P-103', name: '27-inch Monitor', price: 249, availableStock: 5, reservedStock: 0 },
    { id: 'P-105', name: 'Noise-Cancelling Headphones', price: 179, availableStock: 0, reservedStock: 3 },
  ]
  accounts: Account[] = [
    { customerId: 'C-001', balance: 1000 },
    { customerId: 'C-007', balance: 50 },
  ]
  orders: Order[] = []
  lookups = new Map<string, number>()
  experiment: string | null = null
  monitorDown = false
  requests: { method: string; url: string; body?: unknown }[] = []
  private seq = 0

  get apiRequests() {
    return this.requests.filter((r) => r.url.startsWith('/api'))
  }

  install() {
    vi.stubGlobal('fetch', (input: RequestInfo | URL, init?: RequestInit) => this.handle(String(input), init))
    return this
  }

  private json(body: unknown, status = 200) {
    return Promise.resolve(new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }))
  }

  private handle(url: string, init?: RequestInit): Promise<Response> {
    const method = init?.method ?? 'GET'
    const body = init?.body ? JSON.parse(String(init.body)) : undefined
    this.requests.push({ method, url, body })
    const path = url.split('?')[0]

    if (path === '/monitor/api/services') {
      if (this.monitorDown) return Promise.reject(new TypeError('Failed to fetch'))
      return this.json({ services: [], experiment_running: this.experiment ? { out: `/results/${this.experiment}` } : null })
    }
    if (method === 'GET' && path === '/api/products') return this.json(this.products)
    if (method === 'GET' && path === '/api/accounts') return this.json(this.accounts)
    if (method === 'GET' && path === '/api/orders') return this.json([...this.orders].reverse().slice(0, 100))
    if (method === 'GET' && path.startsWith('/api/orders/')) return this.lookup(decodeURIComponent(path.split('/').pop()!))
    if (method === 'POST' && path === '/api/orders') return this.place(body)
    if (method === 'POST' && /^\/api\/accounts\/[^/]+\/topup$/.test(path)) {
      const account = this.accounts.find((a) => a.customerId === decodeURIComponent(path.split('/')[3]))!
      account.balance += body.amount
      return this.json(account)
    }
    if (method === 'POST' && /^\/api\/products\/[^/]+\/restock$/.test(path)) {
      const product = this.products.find((p) => p.id === decodeURIComponent(path.split('/')[3]))!
      product.availableStock += body.quantity
      return this.json(product)
    }
    return this.json({ detail: 'not found' }, 404)
  }

  private place(body: { customerId: string; productId: string; quantity: number }) {
    if (body.quantity < 1 || body.quantity > 100) return this.json({ title: 'Bad Request', detail: 'quantity must be between 1 and 100' }, 400)
    const product = this.products.find((p) => p.id === body.productId)!
    this.seq += 1
    const order: Order = {
      id: `00000000-0000-4000-8000-${String(this.seq).padStart(12, '0')}`,
      ...body,
      amount: Math.round(product.price * body.quantity * 100) / 100,
      status: 'PENDING',
      failureReason: null,
      createdAt: new Date(Date.UTC(2026, 10, 12, 10, 0, this.seq)).toISOString(),
    }
    this.orders.push(order)
    return this.json(order, 202)
  }

  /** Each look-up advances the saga by one step. */
  private lookup(id: string) {
    const order = this.orders.find((o) => o.id === id)
    if (!order) return this.json({ detail: 'order not found' }, 404)
    const n = (this.lookups.get(id) ?? 0) + 1
    this.lookups.set(id, n)
    if (n === 2 && order.status === 'PENDING') order.status = 'INVENTORY_RESERVED'
    if (n >= 3 && order.status === 'INVENTORY_RESERVED') {
      const account = this.accounts.find((a) => a.customerId === order.customerId)!
      if (account.balance >= order.amount) {
        account.balance -= order.amount
        order.status = 'COMPLETED'
      } else {
        order.status = 'CANCELLED'
        order.failureReason = 'INSUFFICIENT_FUNDS'
      }
    }
    return this.json(order)
  }
}

export function renderApp(path: string, opts: { session?: Session; cart?: CartLine[] } = {}) {
  if (opts.session) window.localStorage.setItem('saga-store.session', JSON.stringify(opts.session))
  if (opts.cart) {
    const owner = opts.session?.role === 'customer' ? opts.session.customerId : 'guest'
    window.localStorage.setItem(`saga-store.cart.${owner}`, JSON.stringify(opts.cart))
  }
  const router = createMemoryRouter(routes, { initialEntries: [path] })
  const result = render(
    <ExperimentProvider intervalMs={0}>
      <AuthProvider>
        <CartProvider>
          <RouterProvider router={router} />
        </CartProvider>
      </AuthProvider>
    </ExperimentProvider>,
  )
  return { ...result, router }
}
