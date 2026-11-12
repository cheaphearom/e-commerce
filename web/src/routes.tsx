import { useEffect, type ReactElement } from 'react'
import type { RouteObject } from 'react-router'
import { Link, Navigate } from 'react-router'
import { Layout } from './components/Layout'
import { RequireAuth } from './components/RequireAuth'
import { AccountPage } from './pages/AccountPage'
import { AdminCustomers, AdminDashboard, AdminLayout, AdminOrders, AdminProducts } from './pages/admin/AdminPages'
import { CartPage } from './pages/CartPage'
import { CatalogPage } from './pages/CatalogPage'
import { CheckoutPage } from './pages/CheckoutPage'
import { ConfirmationPage } from './pages/ConfirmationPage'
import { HomePage } from './pages/HomePage'
import { LoginPage } from './pages/LoginPage'
import { OrderDetailPage } from './pages/OrderDetailPage'
import { ProductPage } from './pages/ProductPage'
import { TopUpPage } from './pages/TopUpPage'
import { useAuth } from './state/auth'
import { Spinner } from './components/ui'

function NotFound() {
  return (
    <section className="empty-state">
      <h1>Page not found</h1>
      <Link to="/" className="btn btn--primary">
        Go to the home page
      </Link>
    </section>
  )
}

/**
 * Signing out is its own page: the session ends only after a protected page has been left, so
 * that page cannot redirect to the sign-in page on its way out.
 */
function LogoutPage() {
  const { session, signOut } = useAuth()
  useEffect(() => {
    if (session) signOut()
  }, [session, signOut])
  return session ? <Spinner label="Signing out…" /> : <Navigate to="/" replace />
}

const customer = (el: ReactElement) => <RequireAuth role="customer">{el}</RequireAuth>

export const routes: RouteObject[] = [
  {
    path: '/',
    element: <Layout />,
    children: [
      { index: true, element: <HomePage /> },
      { path: 'products', element: <CatalogPage /> },
      { path: 'products/:id', element: <ProductPage /> },
      { path: 'cart', element: <CartPage /> },
      { path: 'login', element: <LoginPage /> },
      { path: 'logout', element: <LogoutPage /> },
      { path: 'checkout', element: customer(<CheckoutPage />) },
      { path: 'orders/confirmation', element: customer(<ConfirmationPage />) },
      { path: 'account', element: customer(<AccountPage />) },
      { path: 'account/orders/:id', element: customer(<OrderDetailPage />) },
      { path: 'account/top-up', element: customer(<TopUpPage />) },
      {
        path: 'admin',
        element: (
          <RequireAuth role="admin">
            <AdminLayout />
          </RequireAuth>
        ),
        children: [
          { index: true, element: <AdminDashboard /> },
          { path: 'orders', element: <AdminOrders /> },
          { path: 'products', element: <AdminProducts /> },
          { path: 'customers', element: <AdminCustomers /> },
        ],
      },
      { path: '*', element: <NotFound /> },
    ],
  },
]
