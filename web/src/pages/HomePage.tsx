import { Link } from 'react-router'
import { shopApi } from '../api/client'
import { ProductCard } from '../components/ProductCard'
import { ErrorBox, Spinner } from '../components/ui'
import { categories, productInfo } from '../lib/catalog'
import { useAsync } from '../lib/useAsync'

export function HomePage() {
  const { data: products, error, loading, reload } = useAsync(shopApi.products)
  const featured = (products ?? []).filter((p) => p.availableStock > 0).slice(0, 4)
  return (
    <>
      <section className="hero">
        <div>
          <p className="hero__eyebrow">Tech essentials, delivered by a saga</p>
          <h1>Everything for your desk, from cables to monitors.</h1>
          <p>
            Every order reserves stock in the inventory service and charges your wallet in the payment service, and
            either completes or is rolled back. Sign in with a demo account to try it.
          </p>
          <div className="hero__actions">
            <Link to="/products" className="btn btn--primary">
              Browse the shop
            </Link>
            <Link to="/login" className="btn btn--ghost">
              Sign in
            </Link>
          </div>
        </div>
      </section>

      {products && (
        <section>
          <h2 className="section-title">Shop by category</h2>
          <div className="category-row">
            {categories(products.map((p) => p.id)).map((c) => (
              <Link key={c} to={`/products?category=${encodeURIComponent(c)}`} className="category-chip">
                {c}
                <span>{products.filter((p) => productInfo(p.id).category === c).length}</span>
              </Link>
            ))}
          </div>
        </section>
      )}

      <section>
        <h2 className="section-title">Popular right now</h2>
        {loading && !products && <Spinner />}
        {error && <ErrorBox message={error} onRetry={reload} />}
        <div className="product-grid">
          {featured.map((p) => (
            <ProductCard key={p.id} product={p} />
          ))}
        </div>
      </section>

      <section className="usp-row" aria-label="Why shop here">
        <div>
          <strong>Wallet payments</strong>
          <span>Pay from your wallet; top it up by card in seconds.</span>
        </div>
        <div>
          <strong>Live order tracking</strong>
          <span>Follow every order through stock reservation and payment.</span>
        </div>
        <div>
          <strong>Automatic refunds</strong>
          <span>If a step fails, the saga releases stock and refunds you.</span>
        </div>
      </section>
    </>
  )
}
