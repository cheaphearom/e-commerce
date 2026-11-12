import { Link } from 'react-router'
import type { Product } from '../api/types'
import { productInfo } from '../lib/catalog'
import { formatMoney } from '../lib/format'
import { useCart } from '../state/cart'
import { ProductImage } from './ProductImage'

export function stockText(p: Product): string {
  if (p.availableStock <= 0) return 'Out of stock'
  if (p.availableStock < 20) return `Only ${p.availableStock} left`
  return 'In stock'
}

export function ProductCard({ product }: { product: Product }) {
  const { add } = useCart()
  const info = productInfo(product.id)
  const soldOut = product.availableStock <= 0
  return (
    <article className="product-card">
      <Link to={`/products/${product.id}`} className="product-card__link">
        <ProductImage productId={product.id} />
        <span className="product-card__category">{info.category}</span>
        <h3>{product.name}</h3>
        <p className="product-card__tagline">{info.tagline}</p>
      </Link>
      <div className="product-card__footer">
        <div>
          <div className="price">{formatMoney(product.price)}</div>
          <div className={`stock ${soldOut ? 'stock--out' : ''}`}>{stockText(product)}</div>
        </div>
        <button className="btn btn--primary btn--small" onClick={() => add(product.id)} disabled={soldOut} aria-label={`Add ${product.name} to cart`}>
          Add to cart
        </button>
      </div>
    </article>
  )
}
