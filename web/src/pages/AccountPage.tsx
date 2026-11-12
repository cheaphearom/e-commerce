import { Link } from 'react-router'
import { shopApi } from '../api/client'
import type { Order } from '../api/types'
import { ErrorBox, PageTitle, Spinner, StatusBadge } from '../components/ui'
import { failureText, formatDateTime, formatMoney, shortId } from '../lib/format'
import { useAsync } from '../lib/useAsync'
import { useAuth } from '../state/auth'
import { rememberedOrders } from '../state/history'

/**
 * The customer's orders: those placed through this site (remembered ids, looked up one by one)
 * plus any of theirs among the 100 most recent orders of the shop.
 */
export async function loadCustomerOrders(customerId: string): Promise<Order[]> {
  const remembered = rememberedOrders(customerId).slice(0, 50)
  const [recent, own] = await Promise.all([
    shopApi.orders(100),
    Promise.all(remembered.map((id) => shopApi.order(id).catch(() => null))),
  ])
  const byId = new Map<string, Order>()
  for (const o of [...own, ...recent]) if (o && o.customerId === customerId) byId.set(o.id, o)
  return [...byId.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt))
}

export function AccountPage() {
  const customerId = useAuth().customerId!
  const { data, error, loading, reload } = useAsync(
    async () => {
      const [accounts, products, orders] = await Promise.all([shopApi.accounts(), shopApi.products(), loadCustomerOrders(customerId)])
      return { account: accounts.find((a) => a.customerId === customerId), products, orders }
    },
    [customerId],
  )
  if (loading && !data) return <Spinner />
  if (error) return <ErrorBox message={error} onRetry={reload} />
  const { account, products, orders } = data!
  const nameOf = (id: string) => products.find((p) => p.id === id)?.name ?? id
  const spent = orders.filter((o) => o.status === 'COMPLETED').reduce((s, o) => s + o.amount, 0)

  return (
    <>
      <PageTitle title="My account" subtitle={`Customer ${customerId}`} />
      <div className="kpis">
        <div className="kpi">
          <span>Wallet balance</span>
          <strong>{formatMoney(account?.balance ?? 0)}</strong>
          <Link to="/account/top-up" className="btn btn--primary btn--small">
            Top up
          </Link>
        </div>
        <div className="kpi">
          <span>Orders</span>
          <strong>{orders.length}</strong>
        </div>
        <div className="kpi">
          <span>Spent</span>
          <strong>{formatMoney(spent)}</strong>
        </div>
      </div>

      <h2 className="section-title">Order history</h2>
      {orders.length === 0 ? (
        <p className="empty">
          No orders yet. <Link to="/products">Start shopping</Link>
        </p>
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Order</th>
                <th>Date</th>
                <th>Product</th>
                <th className="num">Amount</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {orders.map((o) => (
                <tr key={o.id}>
                  <td>
                    <Link to={`/account/orders/${o.id}`} className="mono">
                      {shortId(o.id)}
                    </Link>
                  </td>
                  <td>{formatDateTime(o.createdAt)}</td>
                  <td>
                    {o.quantity} × {nameOf(o.productId)}
                  </td>
                  <td className="num">{formatMoney(o.amount)}</td>
                  <td>
                    <StatusBadge status={o.status} />
                    {o.failureReason && <div className="muted small">{failureText(o.failureReason)}</div>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="muted small">
        Shows the orders you placed in this browser and any of yours among the shop's 100 most recent orders.
      </p>
    </>
  )
}
