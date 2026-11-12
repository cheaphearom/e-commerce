import { useMemo } from 'react'
import { useSearchParams } from 'react-router'
import { shopApi } from '../api/client'
import type { Product } from '../api/types'
import { ProductCard } from '../components/ProductCard'
import { ErrorBox, PageTitle, Spinner } from '../components/ui'
import { categories, productInfo } from '../lib/catalog'
import { useAsync } from '../lib/useAsync'

export type SortKey = 'featured' | 'price-asc' | 'price-desc' | 'name'

export interface CatalogFilter {
  q: string
  category: string
  maxPrice: number | null
  inStock: boolean
  sort: SortKey
}

/** Search, filter and sort (pure, so it is tested directly). */
export function filterProducts(products: Product[], f: CatalogFilter): Product[] {
  const q = f.q.trim().toLowerCase()
  const result = products.filter((p) => {
    const info = productInfo(p.id)
    if (q && !`${p.name} ${p.id} ${info.category} ${info.tagline}`.toLowerCase().includes(q)) return false
    if (f.category && info.category !== f.category) return false
    if (f.maxPrice !== null && p.price > f.maxPrice) return false
    if (f.inStock && p.availableStock <= 0) return false
    return true
  })
  switch (f.sort) {
    case 'price-asc':
      return result.sort((a, b) => a.price - b.price)
    case 'price-desc':
      return result.sort((a, b) => b.price - a.price)
    case 'name':
      return result.sort((a, b) => a.name.localeCompare(b.name))
    default:
      return result
  }
}

const PRICE_STEPS = [25, 50, 100, 200]

export function CatalogPage() {
  const { data: products, error, loading, reload } = useAsync(shopApi.products)
  const [params, setParams] = useSearchParams()
  const filter: CatalogFilter = {
    q: params.get('q') ?? '',
    category: params.get('category') ?? '',
    maxPrice: params.get('max') ? Number(params.get('max')) : null,
    inStock: params.get('stock') === '1',
    sort: (params.get('sort') as SortKey) ?? 'featured',
  }
  const set = (key: string, value: string) => {
    const next = new URLSearchParams(params)
    if (value) next.set(key, value)
    else next.delete(key)
    setParams(next, { replace: true })
  }
  const shown = useMemo(() => filterProducts(products ?? [], filter), [products, params]) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <>
      <PageTitle title={filter.category || 'All products'} subtitle={filter.q ? `Results for “${filter.q}”` : undefined} />
      <div className="catalog">
        <aside className="filters" aria-label="Filters">
          <label>
            Search
            <input type="search" value={filter.q} onChange={(e) => set('q', e.target.value)} placeholder="Name or keyword" />
          </label>
          <label>
            Category
            <select value={filter.category} onChange={(e) => set('category', e.target.value)}>
              <option value="">All categories</option>
              {categories((products ?? []).map((p) => p.id)).map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </label>
          <label>
            Price up to
            <select value={filter.maxPrice ?? ''} onChange={(e) => set('max', e.target.value)}>
              <option value="">Any price</option>
              {PRICE_STEPS.map((p) => (
                <option key={p} value={p}>
                  ${p}
                </option>
              ))}
            </select>
          </label>
          <label className="checkbox">
            <input type="checkbox" checked={filter.inStock} onChange={(e) => set('stock', e.target.checked ? '1' : '')} />
            In stock only
          </label>
          <label>
            Sort by
            <select value={filter.sort} onChange={(e) => set('sort', e.target.value === 'featured' ? '' : e.target.value)}>
              <option value="featured">Featured</option>
              <option value="price-asc">Price: low to high</option>
              <option value="price-desc">Price: high to low</option>
              <option value="name">Name</option>
            </select>
          </label>
          {params.size > 0 && (
            <button className="btn btn--ghost btn--small" onClick={() => setParams({}, { replace: true })}>
              Clear filters
            </button>
          )}
        </aside>
        <section aria-live="polite">
          {loading && !products && <Spinner />}
          {error && <ErrorBox message={error} onRetry={reload} />}
          {products && (
            <p className="result-count">
              {shown.length} of {products.length} products
            </p>
          )}
          {products && shown.length === 0 && <p className="empty">No products match these filters.</p>}
          <div className="product-grid">
            {shown.map((p) => (
              <ProductCard key={p.id} product={p} />
            ))}
          </div>
        </section>
      </div>
    </>
  )
}
