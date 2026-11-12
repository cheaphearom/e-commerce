import { describe, expect, it } from 'vitest'
import type { Order, Product } from '../api/types'
import { orderSteps } from '../components/OrderProgress'
import { TEST_CARDS, authorise, cardBrand, expiryValid, formatCardNumber, luhnValid, validateCard } from '../lib/card'
import { categories, productInfo } from '../lib/catalog'
import { failureText, formatMoney, statusLabel } from '../lib/format'
import { orderStats } from '../pages/admin/AdminPages'
import { priceLines } from '../pages/CartPage'
import { filterProducts } from '../pages/CatalogPage'
import { checkCredentials, normaliseCustomerId } from '../state/auth'
import { addLine, mergeCarts, setLineQuantity } from '../state/cart'

const products: Product[] = [
  { id: 'P-100', name: 'USB-C Cable', price: 9.99, availableStock: 10, reservedStock: 0 },
  { id: 'P-103', name: '27-inch Monitor', price: 249, availableStock: 0, reservedStock: 0 },
  { id: 'P-101', name: 'Wireless Mouse', price: 24.5, availableStock: 5, reservedStock: 0 },
]

const order = (status: Order['status'], failureReason: string | null = null, amount = 10): Order => ({
  id: 'x', customerId: 'C-001', productId: 'P-100', quantity: 1, amount, status, failureReason, createdAt: '2026-11-12T10:00:00Z',
})

describe('cards (simulated payment)', () => {
  it('checks numbers with the Luhn checksum', () => {
    expect(luhnValid(TEST_CARDS.success)).toBe(true)
    expect(luhnValid(TEST_CARDS.declined)).toBe(true)
    expect(luhnValid('4242 4242 4242 4241')).toBe(false)
    expect(luhnValid('1234')).toBe(false)
  })

  it('recognises brands and formats like the printed card', () => {
    expect(cardBrand('4242')).toBe('Visa')
    expect(cardBrand('5555 5555 5555 4444')).toBe('Mastercard')
    expect(cardBrand('2221 0000 0000 0009')).toBe('Mastercard')
    expect(cardBrand('3782 822463 10005')).toBe('American Express')
    expect(formatCardNumber('378282246310005')).toBe('3782 822463 10005')
    expect(formatCardNumber('4242424242424242')).toBe('4242 4242 4242 4242')
  })

  it('accepts only future expiry dates and the right security code length', () => {
    const now = new Date(2026, 10, 12)
    expect(expiryValid('11/26', now)).toBe(true)
    expect(expiryValid('10/26', now)).toBe(false)
    expect(expiryValid('13/30', now)).toBe(false)
    expect(validateCard({ number: TEST_CARDS.success, name: 'Ann Lee', expiry: '12/30', cvc: '123' }, now)).toEqual({})
    const errors = validateCard({ number: '3782 822463 10005', name: 'A', expiry: '01/20', cvc: '123' }, now)
    expect(Object.keys(errors).sort()).toEqual(['cvc', 'expiry', 'name'])
  })

  it('declines the decline test card', () => {
    expect(authorise(TEST_CARDS.success)).toEqual({ approved: true })
    expect(authorise(TEST_CARDS.declined).approved).toBe(false)
  })
})

describe('cart', () => {
  it('adds, caps at 100 per line, removes at zero and merges', () => {
    let lines = addLine([], 'P-100', 2)
    lines = addLine(lines, 'P-100', 99)
    expect(lines).toEqual([{ productId: 'P-100', quantity: 100 }])
    lines = setLineQuantity(addLine(lines, 'P-101', 1), 'P-100', 0)
    expect(lines).toEqual([{ productId: 'P-101', quantity: 1 }])
    expect(mergeCarts([{ productId: 'P-101', quantity: 1 }], [{ productId: 'P-101', quantity: 2 }, { productId: 'P-103', quantity: 1 }])).toEqual([
      { productId: 'P-101', quantity: 3 },
      { productId: 'P-103', quantity: 1 },
    ])
  })

  it('prices lines with the current prices', () => {
    const { lines, total } = priceLines([{ productId: 'P-101', quantity: 2 }, { productId: 'P-999', quantity: 1 }], products)
    expect(total).toBe(49)
    expect(lines[1].product).toBeUndefined()
  })
})

describe('sign-in', () => {
  it('normalises customer numbers', () => {
    expect(normaliseCustomerId('c1')).toBe('C-001')
    expect(normaliseCustomerId(' C-007 ')).toBe('C-007')
    expect(normaliseCustomerId('c-020')).toBe('C-020')
  })

  it('checks demo credentials', () => {
    const known = ['C-001', 'C-007']
    expect(checkCredentials('C-001', 'shop123', known)).toEqual({ role: 'customer', customerId: 'C-001' })
    expect(checkCredentials('C-001', 'nope', known)).toBe('Wrong password')
    expect(checkCredentials('C-099', 'shop123', known)).toMatch(/no customer account/)
    expect(checkCredentials('ADMIN', 'admin123', [])).toEqual({ role: 'admin' })
    expect(checkCredentials('admin', 'shop123', known)).toMatch(/Wrong password/)
  })
})

describe('catalogue', () => {
  it('searches, filters and sorts', () => {
    const base = { q: '', category: '', maxPrice: null, inStock: false, sort: 'featured' as const }
    expect(filterProducts(products, { ...base, q: 'mouse' }).map((p) => p.id)).toEqual(['P-101'])
    expect(filterProducts(products, { ...base, q: 'displays' }).map((p) => p.id)).toEqual(['P-103'])
    expect(filterProducts(products, { ...base, inStock: true }).map((p) => p.id)).toEqual(['P-100', 'P-101'])
    expect(filterProducts(products, { ...base, maxPrice: 25 }).map((p) => p.id)).toEqual(['P-100', 'P-101'])
    expect(filterProducts(products, { ...base, sort: 'price-desc' }).map((p) => p.id)).toEqual(['P-103', 'P-101', 'P-100'])
    expect(filterProducts(products, { ...base, category: 'Cables & Adapters' }).map((p) => p.id)).toEqual(['P-100'])
  })

  it('has content for every seeded product and a fallback', () => {
    expect(categories(['P-100', 'P-101', 'P-102', 'P-103', 'P-104', 'P-105'])).toHaveLength(5)
    expect(productInfo('P-999').category).toBe('Other')
  })
})

describe('orders', () => {
  it('describes the saga steps, including roll-backs', () => {
    expect(orderSteps(order('COMPLETED')).every((s) => s.state === 'done')).toBe(true)
    expect(orderSteps(order('INVENTORY_RESERVED')).map((s) => s.state)).toEqual(['done', 'done', 'active', 'todo'])
    const funds = orderSteps(order('CANCELLED', 'INSUFFICIENT_FUNDS'))
    expect(funds.map((s) => s.state)).toEqual(['done', 'undone', 'failed', 'failed'])
    expect(funds[2].note).toBe(failureText('INSUFFICIENT_FUNDS'))
    expect(orderSteps(order('CANCELLED', 'OUT_OF_STOCK'))[1].state).toBe('failed')
  })

  it('summarises orders for the admin dashboard', () => {
    const s = orderStats([order('COMPLETED', null, 10), order('COMPLETED', null, 5), order('CANCELLED', 'SAGA_TIMEOUT'), order('PENDING')])
    expect(s).toMatchObject({ total: 4, completed: 2, cancelled: 1, inProgress: 1, revenue: 15 })
    expect(s.successRate).toBeCloseTo(2 / 3)
    expect(s.reasons).toEqual([['SAGA_TIMEOUT', 1]])
  })

  it('formats money, statuses and failure reasons', () => {
    expect(formatMoney(1234.5)).toBe('$1,234.50')
    expect(statusLabel('INVENTORY_RESERVED')).toBe('Paying')
    expect(failureText('OUT_OF_STOCK')).toBe('Not enough stock')
    expect(failureText('SOMETHING_NEW')).toBe('something new')
    expect(failureText(null)).toBe('')
  })
})
