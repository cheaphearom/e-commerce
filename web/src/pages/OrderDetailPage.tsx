import { Link, useParams } from 'react-router'
import { shopApi } from '../api/client'
import { OrderProgress } from '../components/OrderProgress'
import { ProductImage } from '../components/ProductImage'
import { ErrorBox, PageTitle, Spinner, StatusBadge } from '../components/ui'
import { failureText, formatDateTime, formatMoney, shortId } from '../lib/format'
import { useAsync } from '../lib/useAsync'
import { useOrders } from '../lib/useOrders'
import { useAuth } from '../state/auth'

export function OrderDetailPage() {
  const { id = '' } = useParams()
  const customerId = useAuth().customerId
  const { orders, error } = useOrders([id], 2000, 30)
  const { data: products } = useAsync(shopApi.products)
  const order = orders[0]

  if (error && !order) return <ErrorBox message={error} />
  if (!order) return <Spinner />
  if (order.customerId !== customerId) {
    return (
      <section className="empty-state">
        <h1>Order not found</h1>
        <Link to="/account" className="btn btn--primary">
          My orders
        </Link>
      </section>
    )
  }
  const name = products?.find((p) => p.id === order.productId)?.name ?? order.productId
  return (
    <>
      <nav className="breadcrumb" aria-label="Breadcrumb">
        <Link to="/account">My account</Link> › <span>Order {shortId(order.id)}</span>
      </nav>
      <PageTitle title={`Order ${shortId(order.id)}`} subtitle={`Placed ${formatDateTime(order.createdAt)}`} />
      <div className="order-detail">
        <div className="order-card">
          <div className="order-card__head">
            <ProductImage productId={order.productId} size="thumb" />
            <div>
              <Link to={`/products/${order.productId}`}>
                <strong>
                  {order.quantity} × {name}
                </strong>
              </Link>
              <span className="muted small">{formatMoney(order.amount)}</span>
            </div>
            <StatusBadge status={order.status} />
          </div>
          <OrderProgress order={order} />
          {order.failureReason && <p className="warning-text">{failureText(order.failureReason)}</p>}
        </div>
        <dl className="facts">
          <dt>Order number</dt>
          <dd className="mono">{order.id}</dd>
          <dt>Customer</dt>
          <dd>{order.customerId}</dd>
          <dt>Last update</dt>
          <dd>{formatDateTime(order.updatedAt ?? order.createdAt)}</dd>
        </dl>
      </div>
    </>
  )
}
