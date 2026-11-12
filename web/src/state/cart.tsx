import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { readJson, writeJson } from '../lib/storage'
import { useAuth } from './auth'

export interface CartLine {
  productId: string
  quantity: number
}

/** The backend accepts 1 to 100 items per order; each cart line becomes one order. */
export const MAX_PER_LINE = 100

/** Pure cart operations (also used by the tests). */
export function addLine(lines: CartLine[], productId: string, quantity: number): CartLine[] {
  const existing = lines.find((l) => l.productId === productId)
  if (existing) {
    return lines.map((l) => (l.productId === productId ? { ...l, quantity: Math.min(MAX_PER_LINE, l.quantity + quantity) } : l))
  }
  return [...lines, { productId, quantity: Math.min(MAX_PER_LINE, Math.max(1, quantity)) }]
}

export function setLineQuantity(lines: CartLine[], productId: string, quantity: number): CartLine[] {
  if (quantity <= 0) return lines.filter((l) => l.productId !== productId)
  return lines.map((l) => (l.productId === productId ? { ...l, quantity: Math.min(MAX_PER_LINE, quantity) } : l))
}

export function mergeCarts(a: CartLine[], b: CartLine[]): CartLine[] {
  return b.reduce((acc, l) => addLine(acc, l.productId, l.quantity), a)
}

const keyFor = (customerId: string | null) => `saga-store.cart.${customerId ?? 'guest'}`

interface CartValue {
  lines: CartLine[]
  count: number
  add: (productId: string, quantity?: number) => void
  setQuantity: (productId: string, quantity: number) => void
  removeLine: (productId: string) => void
  removeLines: (productIds: string[]) => void
  clear: () => void
}

const CartContext = createContext<CartValue | null>(null)

/** One cart per signed-in customer (and one for guests, merged into the customer's on sign-in). */
export function CartProvider({ children }: { children: ReactNode }) {
  const { customerId } = useAuth()
  const [cart, setCart] = useState(() => ({
    owner: customerId,
    lines: readJson<CartLine[]>(keyFor(customerId), []),
    clearGuest: false,
  }))

  // Another customer signed in (or out): switch to their cart while rendering. A guest's cart is
  // merged into the customer's on sign-in.
  if (cart.owner !== customerId) {
    const fromGuest = cart.owner === null && customerId !== null
    const own = readJson<CartLine[]>(keyFor(customerId), [])
    setCart({ owner: customerId, lines: fromGuest ? mergeCarts(own, cart.lines) : own, clearGuest: fromGuest })
  }

  useEffect(() => {
    writeJson(keyFor(cart.owner), cart.lines)
    if (cart.clearGuest) writeJson(keyFor(null), [])
  }, [cart])

  const lines = cart.lines
  const setLines = useCallback(
    (update: (l: CartLine[]) => CartLine[]) => setCart((c) => ({ ...c, lines: update(c.lines), clearGuest: false })),
    [],
  )

  const add = useCallback((productId: string, quantity = 1) => setLines((l) => addLine(l, productId, quantity)), [setLines])
  const setQuantity = useCallback((productId: string, q: number) => setLines((l) => setLineQuantity(l, productId, q)), [setLines])
  const removeLine = useCallback((productId: string) => setLines((l) => l.filter((x) => x.productId !== productId)), [setLines])
  const removeLines = useCallback((ids: string[]) => setLines((l) => l.filter((x) => !ids.includes(x.productId))), [setLines])
  const clear = useCallback(() => setLines(() => []), [setLines])

  const value = useMemo<CartValue>(
    () => ({ lines, count: lines.reduce((n, l) => n + l.quantity, 0), add, setQuantity, removeLine, removeLines, clear }),
    [lines, add, setQuantity, removeLine, removeLines, clear],
  )
  return <CartContext.Provider value={value}>{children}</CartContext.Provider>
}

export function useCart(): CartValue {
  const ctx = useContext(CartContext)
  if (!ctx) throw new Error('useCart must be used inside <CartProvider>')
  return ctx
}
