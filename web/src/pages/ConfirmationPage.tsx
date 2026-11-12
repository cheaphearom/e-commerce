import { Link, useLocation, useSearchParams } from 'react-router'
import { shopApi } from '../api/client'
import { OrderProgress } from '../components/OrderProgress'
import { ProductImage } from '../components/ProductImage'
import { ErrorBox, Notice, PageTitle, StatusBadge } from '../components/ui'
import { formatMoney, shortId } from '../lib/format'
import { useAsync } from '../lib/useAsync'
import { useOrders } from '../lib/useOrders'

export function ConfirmationPage() {
  const [params] = useSearchParams()
  const location = useLocation()
  const failed = ((location.state as { failed?: string[] } | null)?.failed ?? []).filter(Boolean)
  const ids = (params.get('ids') ?? '').split(',').filter(Boolean)
  const { orders, error, done } = useOrders(ids)
  const { data: products } = useAsync(shopApi.products)
  const nameOf = (id: string) => products?.find((p) => p.id === id)?.name ?? id

  const completed = orders.filter((o) => o.status === 'COMPLETED')
  const cancelled = orders.filter((o) => o.status === 'CANCELLED')
  const charged = completed.reduce((s, o) => s + o.amount, 0)

  return (
    <>
      <PageTitle
        title={!done ? 'Processing your order…' : cancelled.length === 0 ? 'Thank you for your order!' : completed.length ? 'Order partly completed' : 'Order cancelled'}
        subtitle={
          done
            ? `${completed.length} completed, ${cancelled.length} cancelled · ${formatMoney(charged)} charged to your wallet`
            : 'Reserving stock and charging your wallet. This usually takes a second.'
        }
      />
      {error && <ErrorBox message={error} />}
      {failed.length > 0 && (
        <Notice tone="warning">
          These products could not be ordered and are still in your cart: {failed.join('; ')}
        </Notice>
      )}
      <ul className="order-cards">
        {ids.map((id) => {
          const o = orders.find((x) => x.id === id)
          return (
            <li key={id} className="order-card">
              {o ? (
                <>
                  <div className="order-card__head">
                    <ProductImage productId={o.productId} size="thumb" />
                    <div>
                      <strong>
                        {o.quantity} × {nameOf(o.productId)}
                      </strong>
                      <span className="muted small">
                        Order {shortId(o.id)} · {formatMoney(o.amount)}
                      </span>
                    </div>
                    <StatusBadge status={o.status} />
                  </div>
                  <OrderProgress order={o} />
                </>
              ) : (
                <span className="muted">Loading order {shortId(id)}…</span>
              )}
            </li>
          )
        })}
      </ul>
      <div className="actions">
        <Link to="/account" className="btn btn--primary">
          My orders
        </Link>
        <Link to="/products" className="btn btn--ghost">
          Continue shopping
        </Link>
      </div>
    </>
  )
}
