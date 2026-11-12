import { useMemo, useState } from 'react'
import { Link, NavLink, Outlet } from 'react-router'
import { errorMessage, shopApi } from '../../api/client'
import type { Account, Order, Product } from '../../api/types'
import { monitorUrl } from '../../components/Layout'
import { ErrorBox, PageTitle, Spinner, StatusBadge } from '../../components/ui'
import { failureText, formatDateTime, formatMoney, shortId } from '../../lib/format'
import { useAsync } from '../../lib/useAsync'

export function AdminLayout() {
  return (
    <>
      <PageTitle title="Shop admin" subtitle="Orders, stock and customer wallets" />
      <nav className="tabs" aria-label="Admin">
        <NavLink to="/admin" end>
          Dashboard
        </NavLink>
        <NavLink to="/admin/orders">Orders</NavLink>
        <NavLink to="/admin/products">Products</NavLink>
        <NavLink to="/admin/customers">Customers</NavLink>
      </nav>
      <Outlet />
    </>
  )
}

export interface OrderStats {
  total: number
  completed: number
  cancelled: number
  inProgress: number
  revenue: number
  successRate: number | null
  reasons: [string, number][]
}

export function orderStats(orders: Order[]): OrderStats {
  const completed = orders.filter((o) => o.status === 'COMPLETED')
  const cancelled = orders.filter((o) => o.status === 'CANCELLED')
  const reasons = new Map<string, number>()
  cancelled.forEach((o) => reasons.set(o.failureReason ?? 'UNKNOWN', (reasons.get(o.failureReason ?? 'UNKNOWN') ?? 0) + 1))
  const finished = completed.length + cancelled.length
  return {
    total: orders.length,
    completed: completed.length,
    cancelled: cancelled.length,
    inProgress: orders.length - finished,
    revenue: completed.reduce((s, o) => s + o.amount, 0),
    successRate: finished ? completed.length / finished : null,
    reasons: [...reasons.entries()].sort((a, b) => b[1] - a[1]),
  }
}

export function AdminDashboard() {
  const { data, error, loading, reload } = useAsync(async () => {
    const [orders, products] = await Promise.all([shopApi.orders(100), shopApi.products()])
    return { orders, products }
  })
  if (loading && !data) return <Spinner />
  if (error) return <ErrorBox message={error} onRetry={reload} />
  const stats = orderStats(data!.orders)
  const lowStock = data!.products.filter((p) => p.availableStock < 50)
  return (
    <>
      <div className="kpis">
        <div className="kpi">
          <span>Orders (latest 100)</span>
          <strong>{stats.total}</strong>
        </div>
        <div className="kpi">
          <span>Completed</span>
          <strong>{stats.completed}</strong>
        </div>
        <div className="kpi">
          <span>Cancelled</span>
          <strong>{stats.cancelled}</strong>
        </div>
        <div className="kpi">
          <span>Success rate</span>
          <strong>{stats.successRate === null ? '–' : `${Math.round(stats.successRate * 100)} %`}</strong>
        </div>
        <div className="kpi">
          <span>Revenue</span>
          <strong>{formatMoney(stats.revenue)}</strong>
        </div>
      </div>
      <div className="two-col">
        <section>
          <h2 className="section-title">Why orders were cancelled</h2>
          {stats.reasons.length === 0 ? (
            <p className="empty">No cancelled orders.</p>
          ) : (
            <table className="table">
              <tbody>
                {stats.reasons.map(([reason, n]) => (
                  <tr key={reason}>
                    <td>{failureText(reason)}</td>
                    <td className="num">{n}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
        <section>
          <h2 className="section-title">Low stock</h2>
          {lowStock.length === 0 ? (
            <p className="empty">Every product has at least 50 in stock.</p>
          ) : (
            <ul>
              {lowStock.map((p) => (
                <li key={p.id}>
                  {p.name}: {p.availableStock} left
                </li>
              ))}
            </ul>
          )}
          <p>
            <Link to="/admin/products">Restock products</Link> ·{' '}
            <a href={monitorUrl()} target="_blank" rel="noreferrer">
              Anomaly monitor ↗
            </a>
          </p>
        </section>
      </div>
    </>
  )
}

export function AdminOrders() {
  const { data, error, loading, reload } = useAsync(async () => {
    const [orders, products] = await Promise.all([shopApi.orders(100), shopApi.products()])
    return { orders, products }
  })
  const [status, setStatus] = useState('')
  const [customer, setCustomer] = useState('')
  const [product, setProduct] = useState('')
  const shown = useMemo(
    () =>
      (data?.orders ?? []).filter(
        (o) =>
          (!status || o.status === status) &&
          (!customer || o.customerId.toLowerCase().includes(customer.trim().toLowerCase())) &&
          (!product || o.productId === product),
      ),
    [data, status, customer, product],
  )
  if (loading && !data) return <Spinner />
  if (error) return <ErrorBox message={error} onRetry={reload} />
  const nameOf = (id: string) => data!.products.find((p: Product) => p.id === id)?.name ?? id
  return (
    <>
      <div className="toolbar">
        <label>
          Status
          <select value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">All</option>
            <option value="COMPLETED">Completed</option>
            <option value="CANCELLED">Cancelled</option>
            <option value="PENDING">Processing</option>
            <option value="INVENTORY_RESERVED">Paying</option>
          </select>
        </label>
        <label>
          Customer
          <input value={customer} onChange={(e) => setCustomer(e.target.value)} placeholder="C-007" />
        </label>
        <label>
          Product
          <select value={product} onChange={(e) => setProduct(e.target.value)}>
            <option value="">All</option>
            {data!.products.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
        <button className="btn btn--ghost btn--small" onClick={reload}>
          Refresh
        </button>
      </div>
      <p className="muted small">
        {shown.length} of the {data!.orders.length} most recent orders (the order service returns at most 100).
      </p>
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>Time</th>
              <th>Order</th>
              <th>Customer</th>
              <th>Product</th>
              <th className="num">Qty</th>
              <th className="num">Amount</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((o) => (
              <tr key={o.id}>
                <td>{formatDateTime(o.createdAt)}</td>
                <td className="mono">{shortId(o.id)}</td>
                <td>{o.customerId}</td>
                <td>{nameOf(o.productId)}</td>
                <td className="num">{o.quantity}</td>
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
    </>
  )
}

export function AdminProducts() {
  const { data: products, error, loading, reload } = useAsync(shopApi.products)
  if (loading && !products) return <Spinner />
  if (error) return <ErrorBox message={error} onRetry={reload} />
  return (
    <div className="table-wrap">
      <table className="table">
        <thead>
          <tr>
            <th>Product</th>
            <th className="num">Price</th>
            <th className="num">Available</th>
            <th className="num">Reserved</th>
            <th>Restock</th>
          </tr>
        </thead>
        <tbody>
          {products!.map((p) => (
            <ProductRow key={p.id} product={p} onChanged={reload} />
          ))}
        </tbody>
      </table>
    </div>
  )
}

function ProductRow({ product, onChanged }: { product: Product; onChanged: () => void }) {
  const [qty, setQty] = useState('100')
  const [msg, setMsg] = useState<string | null>(null)
  const restock = async () => {
    const n = Number(qty)
    if (!(Number.isInteger(n) && n >= 1 && n <= 100000)) {
      setMsg('Enter 1 to 100,000')
      return
    }
    try {
      await shopApi.restock(product.id, n)
      setMsg(`+${n} added`)
      onChanged()
    } catch (e) {
      setMsg(errorMessage(e))
    }
  }
  return (
    <tr>
      <td>
        <Link to={`/products/${product.id}`}>{product.name}</Link> <span className="muted small">{product.id}</span>
      </td>
      <td className="num">{formatMoney(product.price)}</td>
      <td className="num">{product.availableStock}</td>
      <td className="num">{product.reservedStock}</td>
      <td>
        <div className="inline-form">
          <input aria-label={`Restock quantity for ${product.name}`} inputMode="numeric" value={qty} onChange={(e) => setQty(e.target.value)} />
          <button className="btn btn--small btn--primary" onClick={restock}>
            Restock
          </button>
          {msg && <span className="muted small">{msg}</span>}
        </div>
      </td>
    </tr>
  )
}

export function AdminCustomers() {
  const { data: accounts, error, loading, reload } = useAsync(shopApi.accounts)
  if (loading && !accounts) return <Spinner />
  if (error) return <ErrorBox message={error} onRetry={reload} />
  return (
    <div className="table-wrap">
      <table className="table">
        <thead>
          <tr>
            <th>Customer</th>
            <th className="num">Wallet balance</th>
            <th>Credit</th>
          </tr>
        </thead>
        <tbody>
          {accounts!.map((a) => (
            <CustomerRow key={a.customerId} account={a} onChanged={reload} />
          ))}
        </tbody>
      </table>
    </div>
  )
}

function CustomerRow({ account, onChanged }: { account: Account; onChanged: () => void }) {
  const [amount, setAmount] = useState('100')
  const [msg, setMsg] = useState<string | null>(null)
  const credit = async () => {
    const n = Number(amount)
    if (!(n > 0 && n <= 10000)) {
      setMsg('Enter $0.01 to $10,000')
      return
    }
    try {
      await shopApi.topUp(account.customerId, n)
      setMsg(`+${formatMoney(n)}`)
      onChanged()
    } catch (e) {
      setMsg(errorMessage(e))
    }
  }
  return (
    <tr>
      <td>{account.customerId}</td>
      <td className="num">{formatMoney(account.balance)}</td>
      <td>
        <div className="inline-form">
          <input aria-label={`Credit for ${account.customerId}`} inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
          <button className="btn btn--small btn--primary" onClick={credit}>
            Credit wallet
          </button>
          {msg && <span className="muted small">{msg}</span>}
        </div>
      </td>
    </tr>
  )
}
