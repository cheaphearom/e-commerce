import { useState, type FormEvent } from 'react'
import { Link, NavLink, Outlet, useNavigate } from 'react-router'
import { useAuth } from '../state/auth'
import { useCart } from '../state/cart'
import { useExperiment } from '../state/experiment'
import { Spinner } from './ui'

/** Monitor dashboard of the ml-detector (port 8000 on the same host). */
export function monitorUrl(): string {
  return `${window.location.protocol}//${window.location.hostname}:8000/`
}

export function Layout() {
  const { session, customerId, isAdmin } = useAuth()
  const { count } = useCart()
  const experiment = useExperiment()
  const navigate = useNavigate()
  const [query, setQuery] = useState('')

  const search = (e: FormEvent) => {
    e.preventDefault()
    navigate(query.trim() ? `/products?q=${encodeURIComponent(query.trim())}` : '/products')
  }

  const paused = experiment.running !== null

  return (
    <div className="app">
      <header className="site-header">
        <div className="site-header__inner">
          <Link to="/" className="brand" aria-label="Saga Store home">
            <img src="/favicon.svg" alt="" width="28" height="28" />
            <span>Saga Store</span>
          </Link>
          <form className="search" role="search" onSubmit={search}>
            <input
              type="search"
              placeholder="Search products"
              aria-label="Search products"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </form>
          <nav className="site-nav" aria-label="Main">
            <NavLink to="/products">Shop</NavLink>
            {isAdmin && <NavLink to="/admin">Admin</NavLink>}
            {customerId && <NavLink to="/account">My account</NavLink>}
            <NavLink to="/cart" className="cart-link" aria-label={`Cart, ${count} items`}>
              Cart{count > 0 && <span className="cart-count">{count}</span>}
            </NavLink>
            {session ? (
              <button
                className="btn btn--small btn--ghost"
                onClick={() => navigate('/logout')}
              >
                Sign out{customerId ? ` (${customerId})` : ' (admin)'}
              </button>
            ) : (
              <NavLink to="/login" className="btn btn--small btn--primary">
                Sign in
              </NavLink>
            )}
          </nav>
        </div>
      </header>

      {!experiment.monitorReachable && !paused && (
        <div className="banner banner--warning" role="status">
          The monitor is not reachable, so the store cannot check whether an experiment is running. Please do not shop
          while an experiment runs.
        </div>
      )}

      <main className="site-main">
        {experiment.checking ? <Spinner label="Opening the store…" /> : paused ? <ExperimentPause name={experiment.running!} /> : <Outlet />}
      </main>

      <footer className="site-footer">
        <p>
          Saga Store is the demo shop of the thesis <em>A Comparative Evaluation of Lightweight Machine Learning and
          Rule-Based Methods for Anomaly Detection in Backend Application Logs</em>. Every order runs a saga across the
          order, inventory and payment services. No real payments are made.
        </p>
        <p>
          <a href={monitorUrl()} target="_blank" rel="noreferrer">
            Anomaly monitor ↗
          </a>
        </p>
      </footer>
    </div>
  )
}

/** Shown instead of every page while an experiment runs: the store then sends no request at all. */
function ExperimentPause({ name }: { name: string }) {
  return (
    <section className="pause">
      <div className="pause__icon" aria-hidden="true">
        🔬
      </div>
      <h1>The store is paused</h1>
      <p>
        An experiment is running (<strong>{name}</strong>). Every visit to the store is real traffic and would end up in the
        experiment's logs, so shopping is paused until it has finished. This page checks again every 15 seconds.
      </p>
      <p>
        <a className="btn btn--ghost" href={monitorUrl()} target="_blank" rel="noreferrer">
          Watch the experiment in the anomaly monitor ↗
        </a>
      </p>
    </section>
  )
}
