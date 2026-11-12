import { useState } from 'react'
import { Link, useNavigate } from 'react-router'
import { errorMessage, shopApi } from '../api/client'
import type { Order } from '../api/types'
import { ProductImage } from '../components/ProductImage'
import { ErrorBox, Notice, PageTitle, Spinner } from '../components/ui'
import { formatMoney } from '../lib/format'
import { useAsync } from '../lib/useAsync'
import { useAuth } from '../state/auth'
import { useCart } from '../state/cart'
import { rememberOrders } from '../state/history'
import { priceLines } from './CartPage'

/**
 * Checkout. The backend's orders hold one product each, so every cart line becomes one order;
 * each order runs its own saga (reserve stock, then charge the wallet).
 */
export function CheckoutPage() {
  const customerId = useAuth().customerId!
  const { lines, removeLines } = useCart()
  const navigate = useNavigate()
  const { data, error, loading, reload } = useAsync(
    async () => {
      const [products, accounts] = await Promise.all([shopApi.products(), shopApi.accounts()])
      return { products, account: accounts.find((a) => a.customerId === customerId) }
    },
    [customerId],
  )
  const [placing, setPlacing] = useState(false)
  const [failures, setFailures] = useState<string[]>([])

  if (lines.length === 0) {
    return (
      <section className="empty-state">
        <h1>Nothing to check out</h1>
        <Link to="/products" className="btn btn--primary">
          Browse the shop
        </Link>
      </section>
    )
  }
  if (loading && !data) return <Spinner />
  if (error) return <ErrorBox message={error} onRetry={reload} />

  const { lines: priced, total } = priceLines(lines, data?.products ?? [])
  const balance = data?.account?.balance ?? 0
  const missing = priced.filter((l) => !l.product)
  const shortStock = priced.filter((l) => l.product && l.quantity > l.product.availableStock)
  const enough = balance >= total
  const canPlace = !placing && enough && missing.length === 0 && shortStock.length === 0 && data?.account !== undefined

  const placeOrders = async () => {
    setPlacing(true)
    setFailures([])
    const placed: Order[] = []
    const failed: string[] = []
    for (const l of priced) {
      try {
        placed.push(await shopApi.placeOrder(customerId, l.productId, l.quantity))
      } catch (e) {
        failed.push(`${l.product?.name ?? l.productId}: ${errorMessage(e)}`)
      }
    }
    if (placed.length) {
      rememberOrders(customerId, placed.map((o) => o.id))
      removeLines(placed.map((o) => o.productId))
    }
    setPlacing(false)
    if (failed.length && !placed.length) {
      setFailures(failed)
      return
    }
    navigate(`/orders/confirmation?ids=${placed.map((o) => o.id).join(',')}`, { state: { failed } })
  }

  return (
    <>
      <PageTitle title="Checkout" subtitle={`Signed in as ${customerId}`} />
      <div className="cart">
        <section>
          <h2 className="section-title">1. Review your order</h2>
          <ul className="cart-lines">
            {priced.map((l) => (
              <li key={l.productId} className="cart-line cart-line--compact">
                <ProductImage productId={l.productId} size="thumb" />
                <div className="cart-line__info">
                  <span>{l.product?.name ?? l.productId}</span>
                  <span className="muted small">
                    {l.quantity} × {l.product ? formatMoney(l.product.price) : '–'}
                  </span>
                </div>
                <strong className="cart-line__total">{formatMoney(l.lineTotal)}</strong>
              </li>
            ))}
          </ul>
          {missing.length > 0 && <Notice tone="warning">Some products are no longer available. Remove them from your cart first.</Notice>}
          {shortStock.length > 0 && (
            <Notice tone="warning">
              Not enough stock for {shortStock.map((l) => l.product!.name).join(', ')}. <Link to="/cart">Change the quantities</Link>.
            </Notice>
          )}

          <h2 className="section-title">2. Payment</h2>
          <div className="payment-method">
            <div>
              <strong>Saga Wallet</strong>
              <span className="muted small">Paid by the payment service when your stock is reserved</span>
            </div>
            <div className="payment-method__balance">
              Balance <strong>{formatMoney(balance)}</strong>
            </div>
          </div>
          {!enough && (
            <Notice tone="warning">
              Your wallet balance is {formatMoney(total - balance)} short.{' '}
              <Link to={`/account/top-up?amount=${Math.ceil(total - balance)}&next=/checkout`}>Top up by card</Link>
            </Notice>
          )}
          {failures.length > 0 && (
            <div className="notice notice--error" role="alert">
              No order could be placed:
              <ul>
                {failures.map((f) => (
                  <li key={f}>{f}</li>
                ))}
              </ul>
            </div>
          )}
        </section>
        <aside className="summary">
          <h2>Order total</h2>
          <div className="summary__row">
            <span>Items</span>
            <span>{formatMoney(total)}</span>
          </div>
          <div className="summary__row">
            <span>Delivery</span>
            <span>Free</span>
          </div>
          <div className="summary__row summary__row--total">
            <span>To pay</span>
            <span>{formatMoney(total)}</span>
          </div>
          <div className="summary__row muted small">
            <span>Wallet after payment</span>
            <span>{formatMoney(balance - total)}</span>
          </div>
          <button className="btn btn--primary btn--block" onClick={placeOrders} disabled={!canPlace}>
            {placing ? 'Placing your order…' : `Pay ${formatMoney(total)}`}
          </button>
          <p className="muted small">
            {priced.length > 1 ? `Your cart becomes ${priced.length} orders, one per product.` : 'One order.'} If a step fails,
            the saga releases the stock and refunds the wallet automatically.
          </p>
        </aside>
      </div>
    </>
  )
}
