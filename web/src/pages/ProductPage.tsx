import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { shopApi } from '../api/client'
import { stockText } from '../components/ProductCard'
import { ProductImage } from '../components/ProductImage'
import { ErrorBox, QuantityStepper, Spinner } from '../components/ui'
import { productInfo } from '../lib/catalog'
import { formatMoney } from '../lib/format'
import { useAsync } from '../lib/useAsync'
import { MAX_PER_LINE, useCart } from '../state/cart'

export function ProductPage() {
  const { id = '' } = useParams()
  const { data: products, error, loading, reload } = useAsync(shopApi.products, [id])
  const { add, lines } = useCart()
  const navigate = useNavigate()
  const [quantity, setQuantity] = useState(1)
  const [added, setAdded] = useState(false)

  if (loading && !products) return <Spinner />
  if (error) return <ErrorBox message={error} onRetry={reload} />
  const product = products?.find((p) => p.id === id)
  if (!product) {
    return (
      <section className="empty-state">
        <h1>Product not found</h1>
        <p>There is no product “{id}”.</p>
        <Link to="/products" className="btn btn--primary">
          Back to the shop
        </Link>
      </section>
    )
  }
  const info = productInfo(product.id)
  const inCart = lines.find((l) => l.productId === product.id)?.quantity ?? 0
  const maxQty = Math.max(1, Math.min(MAX_PER_LINE - inCart, product.availableStock))
  const soldOut = product.availableStock <= 0 || inCart >= MAX_PER_LINE

  return (
    <article className="product-detail">
      <nav className="breadcrumb" aria-label="Breadcrumb">
        <Link to="/products">Shop</Link> › <Link to={`/products?category=${encodeURIComponent(info.category)}`}>{info.category}</Link> ›{' '}
        <span>{product.name}</span>
      </nav>
      <div className="product-detail__grid">
        <ProductImage productId={product.id} size="large" />
        <div>
          <span className="product-card__category">{info.category}</span>
          <h1>{product.name}</h1>
          <p className="product-detail__tagline">{info.tagline}</p>
          <div className="price price--large">{formatMoney(product.price)}</div>
          <p className={`stock ${product.availableStock <= 0 ? 'stock--out' : ''}`}>
            {stockText(product)} · {product.availableStock} available, {product.reservedStock} reserved
          </p>
          <p>{info.description}</p>
          {info.highlights.length > 0 && (
            <ul className="highlights">
              {info.highlights.map((h) => (
                <li key={h}>{h}</li>
              ))}
            </ul>
          )}
          <div className="buy-box">
            <QuantityStepper label="Quantity" value={Math.min(quantity, maxQty)} onChange={setQuantity} max={maxQty} />
            <button
              className="btn btn--primary"
              disabled={soldOut}
              onClick={() => {
                add(product.id, Math.min(quantity, maxQty))
                setAdded(true)
              }}
            >
              Add to cart
            </button>
            <button
              className="btn btn--ghost"
              disabled={soldOut}
              onClick={() => {
                add(product.id, Math.min(quantity, maxQty))
                navigate('/checkout')
              }}
            >
              Buy now
            </button>
          </div>
          {added && (
            <p className="notice notice--success" role="status">
              Added to your cart. <Link to="/cart">View cart</Link>
            </p>
          )}
          {inCart > 0 && !added && <p className="muted">You have {inCart} in your cart.</p>}
          <p className="muted small">Product code {product.id}. Up to {MAX_PER_LINE} per order.</p>
        </div>
      </div>
    </article>
  )
}
