import { Link } from 'react-router'
import { shopApi } from '../api/client'
import type { Product } from '../api/types'
import { ProductImage } from '../components/ProductImage'
import { ErrorBox, PageTitle, QuantityStepper, Spinner } from '../components/ui'
import { formatMoney } from '../lib/format'
import { useAsync } from '../lib/useAsync'
import { MAX_PER_LINE, useCart, type CartLine } from '../state/cart'

export interface PricedLine extends CartLine {
  product: Product | undefined
  lineTotal: number
}

export function priceLines(lines: CartLine[], products: Product[]): { lines: PricedLine[]; total: number } {
  const priced = lines.map((l) => {
    const product = products.find((p) => p.id === l.productId)
    return { ...l, product, lineTotal: product ? product.price * l.quantity : 0 }
  })
  return { lines: priced, total: priced.reduce((s, l) => s + l.lineTotal, 0) }
}

export function CartPage() {
  const { lines, setQuantity, removeLine } = useCart()
  const { data: products, error, loading, reload } = useAsync(shopApi.products)

  if (lines.length === 0) {
    return (
      <section className="empty-state">
        <h1>Your cart is empty</h1>
        <p>Find something you like in the shop.</p>
        <Link to="/products" className="btn btn--primary">
          Browse the shop
        </Link>
      </section>
    )
  }
  if (loading && !products) return <Spinner />
  if (error) return <ErrorBox message={error} onRetry={reload} />
  const { lines: priced, total } = priceLines(lines, products ?? [])

  return (
    <>
      <PageTitle title="Your cart" subtitle={`${lines.length} ${lines.length === 1 ? 'product' : 'products'}`} />
      <div className="cart">
        <ul className="cart-lines">
          {priced.map((l) => (
            <li key={l.productId} className="cart-line">
              <ProductImage productId={l.productId} size="thumb" />
              <div className="cart-line__info">
                <Link to={`/products/${l.productId}`}>{l.product?.name ?? l.productId}</Link>
                <span className="muted small">{l.product ? `${formatMoney(l.product.price)} each` : 'No longer available'}</span>
                {l.product && l.quantity > l.product.availableStock && (
                  <span className="warning-text small">Only {l.product.availableStock} in stock</span>
                )}
              </div>
              <QuantityStepper
                label={`Quantity of ${l.product?.name ?? l.productId}`}
                value={l.quantity}
                max={MAX_PER_LINE}
                onChange={(q) => setQuantity(l.productId, q)}
              />
              <strong className="cart-line__total">{formatMoney(l.lineTotal)}</strong>
              <button className="link-button" onClick={() => removeLine(l.productId)} aria-label={`Remove ${l.product?.name ?? l.productId}`}>
                Remove
              </button>
            </li>
          ))}
        </ul>
        <aside className="summary">
          <h2>Summary</h2>
          <div className="summary__row">
            <span>Subtotal</span>
            <span>{formatMoney(total)}</span>
          </div>
          <div className="summary__row">
            <span>Delivery</span>
            <span>Free</span>
          </div>
          <div className="summary__row summary__row--total">
            <span>Total</span>
            <span>{formatMoney(total)}</span>
          </div>
          <Link to="/checkout" className="btn btn--primary btn--block">
            Go to checkout
          </Link>
          <Link to="/products" className="btn btn--ghost btn--block">
            Continue shopping
          </Link>
        </aside>
      </div>
    </>
  )
}
