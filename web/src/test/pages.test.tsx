import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TEST_CARDS } from '../lib/card'
import { FakeShop, renderApp } from './fakeShop'

let shop: FakeShop
beforeEach(() => {
  shop = new FakeShop().install()
})
afterEach(() => {
  vi.unstubAllGlobals()
})

const C001 = { role: 'customer' as const, customerId: 'C-001' }

describe('browsing', () => {
  it('shows the home page with categories and products in stock', async () => {
    renderApp('/')
    expect(await screen.findByRole('heading', { name: /Everything for your desk/ })).toBeInTheDocument()
    expect(await screen.findByText('Wireless Mouse')).toBeInTheDocument()
    expect(screen.queryByText('Noise-Cancelling Headphones')).not.toBeInTheDocument() // sold out: not featured
    expect(screen.getByRole('link', { name: /Audio/ })).toHaveAttribute('href', '/products?category=Audio')
  })

  it('filters the catalogue by search and category', async () => {
    const user = userEvent.setup()
    renderApp('/products?category=Displays')
    expect(await screen.findByText('1 of 4 products')).toBeInTheDocument()
    expect(screen.getByText('27-inch Monitor')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Clear filters' }))
    await user.type(screen.getByRole('searchbox', { name: 'Search' }), 'cable')
    expect(screen.getByText('1 of 4 products')).toBeInTheDocument()
    expect(screen.getByText('USB-C Cable')).toBeInTheDocument()
  })

  it('shows product details and adds the chosen quantity to the cart', async () => {
    const user = userEvent.setup()
    renderApp('/products/P-101')
    expect(await screen.findByRole('heading', { name: 'Wireless Mouse' })).toBeInTheDocument()
    expect(screen.getByText('Silent clicks')).toBeInTheDocument()
    await user.click(screen.getAllByRole('button', { name: 'Increase quantity' })[0])
    await user.click(screen.getByRole('button', { name: 'Add to cart' }))
    expect(screen.getByRole('link', { name: 'Cart, 2 items' })).toBeInTheDocument()
    expect(screen.getByText(/Added to your cart/)).toBeInTheDocument()
  })

  it('cannot add sold-out products and explains unknown ones', async () => {
    renderApp('/products/P-105')
    expect(await screen.findByText(/Out of stock/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Add to cart' })).toBeDisabled()
  })
})

describe('sign-in and sign-out', () => {
  it('sends visitors to sign in before checkout and back afterwards', async () => {
    const user = userEvent.setup()
    const { router } = renderApp('/checkout', { cart: [{ productId: 'P-100', quantity: 1 }] })
    expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeInTheDocument()
    expect(router.state.location.search).toContain('next=%2Fcheckout')
    await user.type(screen.getByLabelText(/Customer number/), 'c1')
    await user.type(screen.getByLabelText('Password'), 'wrong')
    await user.click(screen.getByRole('button', { name: 'Sign in' }))
    expect(await screen.findByText('Wrong password')).toBeInTheDocument()
    await user.clear(screen.getByLabelText('Password'))
    await user.type(screen.getByLabelText('Password'), 'shop123')
    await user.click(screen.getByRole('button', { name: 'Sign in' }))
    expect(await screen.findByRole('heading', { name: 'Checkout' })).toBeInTheDocument()
    // the guest cart was carried over to the customer's cart
    expect(screen.getByText('USB-C Cable')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /Sign out \(C-001\)/ }))
    const nav = screen.getByRole('navigation', { name: 'Main' })
    expect(await within(nav).findByRole('link', { name: 'Sign in' })).toBeInTheDocument()
    expect(router.state.location.pathname).toBe('/')
  })

  it('keeps customers out of the admin pages', async () => {
    const { router } = renderApp('/admin', { session: C001 })
    expect(await screen.findByText('The admin pages need the admin account.')).toBeInTheDocument()
    expect(screen.getByText(/You are signed in as C-001/)).toBeInTheDocument()
    expect(router.state.location.search).toContain('role=admin')
  })

  it('lets a signed-in customer switch to the admin account', async () => {
    const user = userEvent.setup()
    const { router } = renderApp('/admin', { session: C001 })
    await user.click(await screen.findByRole('button', { name: 'admin' }))
    await user.click(screen.getByRole('button', { name: 'Sign in' }))
    expect(await screen.findByRole('heading', { name: 'Shop admin' })).toBeInTheDocument()
    expect(router.state.location.pathname).toBe('/admin')
  })

  it('sends an admin who opens a customer page to sign in as a customer (no loop)', async () => {
    renderApp('/account', { session: { role: 'admin' } })
    expect(await screen.findByText(/Sign in with a customer account/)).toBeInTheDocument()
  })
})

describe('checkout and payment', () => {
  it('pays from the wallet, places one order per line and follows them to completion', async () => {
    const user = userEvent.setup()
    const { router } = renderApp('/checkout', {
      session: C001,
      cart: [
        { productId: 'P-100', quantity: 2 },
        { productId: 'P-101', quantity: 1 },
      ],
    })
    const pay = await screen.findByRole('button', { name: 'Pay $44.48' })
    await user.click(pay)
    expect(await screen.findByRole('heading', { name: 'Thank you for your order!' }, { timeout: 8000 })).toBeInTheDocument()
    const posts = shop.requests.filter((r) => r.method === 'POST' && r.url === '/api/orders')
    expect(posts.map((r) => r.body)).toEqual([
      { customerId: 'C-001', productId: 'P-100', quantity: 2 },
      { customerId: 'C-001', productId: 'P-101', quantity: 1 },
    ])
    expect(screen.getByText(/2 completed, 0 cancelled · \$44.48 charged/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Cart, 0 items' })).toBeInTheDocument()
    expect(router.state.location.pathname).toBe('/orders/confirmation')
    expect(JSON.parse(window.localStorage.getItem('saga-store.orders.C-001')!)).toHaveLength(2)
  }, 15000)

  it('blocks checkout when the wallet is short and offers a card top-up', async () => {
    renderApp('/checkout', { session: { role: 'customer', customerId: 'C-007' }, cart: [{ productId: 'P-101', quantity: 3 }] })
    expect(await screen.findByText(/balance is \$23.50 short/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Pay $73.50' })).toBeDisabled()
    expect(screen.getByRole('link', { name: 'Top up by card' })).toHaveAttribute('href', '/account/top-up?amount=24&next=/checkout')
  })

  it('blocks checkout when there is not enough stock', async () => {
    renderApp('/checkout', { session: C001, cart: [{ productId: 'P-103', quantity: 6 }] })
    expect(await screen.findByText(/Not enough stock for 27-inch Monitor/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Pay/ })).toBeDisabled()
  })

  it('tops up by card: validates, declines the decline card, and sends only the amount', async () => {
    const user = userEvent.setup()
    renderApp('/account/top-up?amount=24&next=/checkout', { session: { role: 'customer', customerId: 'C-007' } })
    await user.click(await screen.findByRole('button', { name: 'Pay $24.00' }))
    expect(screen.getByText('Enter a valid card number')).toBeInTheDocument()

    await user.type(screen.getByLabelText('Card number'), TEST_CARDS.declined)
    await user.type(screen.getByLabelText('Name on card'), 'Ann Lee')
    await user.type(screen.getByLabelText('Expiry (MM/YY)'), '1230')
    await user.type(screen.getByLabelText('Security code'), '123')
    await user.click(screen.getByRole('button', { name: 'Pay $24.00' }))
    expect(await screen.findByText(/declined by the bank/, {}, { timeout: 3000 })).toBeInTheDocument()
    expect(shop.requests.some((r) => r.url.includes('/topup'))).toBe(false)

    await user.clear(screen.getByLabelText('Card number'))
    await user.type(screen.getByLabelText('Card number'), TEST_CARDS.success)
    await user.click(screen.getByRole('button', { name: 'Pay $24.00' }))
    expect(await screen.findByRole('heading', { name: 'Payment successful' }, { timeout: 3000 })).toBeInTheDocument()
    const topup = shop.requests.find((r) => r.url.includes('/topup'))!
    expect(topup.body).toEqual({ amount: 24 })
    expect(JSON.stringify(shop.requests)).not.toContain('4242')
    expect(screen.getByText(/Visa card ending in 4242/)).toBeInTheDocument()
    expect(screen.getByText('$74.00')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Continue to checkout' })).toHaveAttribute('href', '/checkout')
  }, 15000)
})

describe('account', () => {
  it('lists orders placed in this browser even when they are not among the latest 100', async () => {
    for (let i = 0; i < 120; i++) shop.orders.push({ id: `other-${i}`, customerId: 'C-002', productId: 'P-100', quantity: 1, amount: 9.99, status: 'COMPLETED', failureReason: null, createdAt: '2026-11-12T11:00:00Z' })
    shop.orders.unshift({ id: 'mine-1', customerId: 'C-001', productId: 'P-101', quantity: 2, amount: 49, status: 'COMPLETED', failureReason: null, createdAt: '2026-11-11T09:00:00Z' })
    window.localStorage.setItem('saga-store.orders.C-001', JSON.stringify(['mine-1']))
    renderApp('/account', { session: C001 })
    expect(await screen.findByText('2 × Wireless Mouse')).toBeInTheDocument()
    expect(screen.getByText('$1,000.00')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'MINE-1' })).toHaveAttribute('href', '/account/orders/mine-1')
  })
})

describe('admin', () => {
  it('restocks a product', async () => {
    const user = userEvent.setup()
    renderApp('/admin/products', { session: { role: 'admin' } })
    const row = (await screen.findByText('27-inch Monitor')).closest('tr')!
    await user.click(within(row).getByRole('button', { name: 'Restock' }))
    expect(await within(row).findByText('+100 added')).toBeInTheDocument()
    expect(shop.requests.find((r) => r.url === '/api/products/P-103/restock')?.body).toEqual({ quantity: 100 })
    await waitFor(() => expect(within(row).getByText('105')).toBeInTheDocument())
  })

  it('summarises recent orders on the dashboard', async () => {
    shop.orders.push(
      { id: 'a', customerId: 'C-001', productId: 'P-100', quantity: 1, amount: 10, status: 'COMPLETED', failureReason: null, createdAt: '2026-11-12T10:00:00Z' },
      { id: 'b', customerId: 'C-007', productId: 'P-101', quantity: 3, amount: 73.5, status: 'CANCELLED', failureReason: 'INSUFFICIENT_FUNDS', createdAt: '2026-11-12T10:01:00Z' },
    )
    renderApp('/admin', { session: { role: 'admin' } })
    expect(await screen.findByText('50 %')).toBeInTheDocument()
    expect(screen.getByText('Payment declined: not enough balance in the wallet')).toBeInTheDocument()
    expect(screen.getByText(/Headphones: 0 left/)).toBeInTheDocument()
  })
})

describe('experiments', () => {
  it('pauses the whole store and sends no shop request while an experiment runs', async () => {
    shop.experiment = 'run_3'
    renderApp('/products', { session: C001 })
    expect(await screen.findByRole('heading', { name: 'The store is paused' })).toBeInTheDocument()
    expect(screen.getByText('run_3')).toBeInTheDocument()
    expect(shop.apiRequests).toEqual([])
  })

  it('still works without the monitor, with a warning', async () => {
    shop.monitorDown = true
    renderApp('/products')
    expect(await screen.findByText(/cannot check whether an experiment is running/)).toBeInTheDocument()
    expect(await screen.findByText('Wireless Mouse')).toBeInTheDocument()
  })
})
