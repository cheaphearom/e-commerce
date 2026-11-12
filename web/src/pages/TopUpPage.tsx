import { useState, type FormEvent } from 'react'
import { Link, useSearchParams } from 'react-router'
import { errorMessage, shopApi } from '../api/client'
import type { Account } from '../api/types'
import { Notice, PageTitle } from '../components/ui'
import {
  TEST_CARDS,
  authorise,
  cardBrand,
  digitsOnly,
  formatCardNumber,
  formatExpiry,
  validateCard,
  type CardErrors,
  type CardInput,
} from '../lib/card'
import { formatMoney } from '../lib/format'
import { useAuth } from '../state/auth'

const PRESETS = [25, 50, 100, 250]
export const MAX_TOP_UP = 10000

/**
 * Card payment for the wallet (simulated payment provider). The card is checked in the browser
 * (Luhn, expiry, security code) and authorised by a simulated network; card details are never
 * sent anywhere. Only the amount goes to the payment-service.
 */
export function TopUpPage({ authoriseDelayMs = 900 }: { authoriseDelayMs?: number }) {
  const customerId = useAuth().customerId!
  const [params] = useSearchParams()
  const next = params.get('next')
  const [amount, setAmount] = useState(() => {
    const a = Number(params.get('amount'))
    return a > 0 ? String(Math.min(MAX_TOP_UP, Math.ceil(a))) : '50'
  })
  const [card, setCard] = useState<CardInput>({ number: '', name: '', expiry: '', cvc: '' })
  const [errors, setErrors] = useState<CardErrors & { amount?: string }>({})
  const [status, setStatus] = useState<'idle' | 'authorising' | 'declined' | 'error'>('idle')
  const [message, setMessage] = useState('')
  const [receipt, setReceipt] = useState<{ account: Account; amount: number; last4: string; brand: string } | null>(null)

  const brand = cardBrand(card.number)
  const value = Number(amount)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    const found: CardErrors & { amount?: string } = validateCard(card)
    if (!(value >= 1 && value <= MAX_TOP_UP)) found.amount = `Choose an amount between $1 and ${formatMoney(MAX_TOP_UP)}`
    setErrors(found)
    if (Object.keys(found).length) return
    setStatus('authorising')
    await new Promise((r) => setTimeout(r, authoriseDelayMs))
    const answer = authorise(card.number)
    if (!answer.approved) {
      setStatus('declined')
      setMessage(answer.reason)
      return
    }
    try {
      const account = await shopApi.topUp(customerId, Math.round(value * 100) / 100)
      setReceipt({ account, amount: value, last4: digitsOnly(card.number).slice(-4), brand })
      setStatus('idle')
    } catch (err) {
      setStatus('error')
      setMessage(errorMessage(err))
    }
  }

  if (receipt) {
    return (
      <section className="receipt">
        <div className="receipt__icon" aria-hidden="true">
          ✓
        </div>
        <h1>Payment successful</h1>
        <p>
          {formatMoney(receipt.amount)} was added to your wallet from your {receipt.brand} card ending in {receipt.last4}.
        </p>
        <p className="receipt__balance">
          New balance <strong>{formatMoney(receipt.account.balance)}</strong>
        </p>
        <div className="actions">
          {next ? (
            <Link to={next} className="btn btn--primary">
              Continue to checkout
            </Link>
          ) : (
            <Link to="/account" className="btn btn--primary">
              Back to my account
            </Link>
          )}
          <Link to="/products" className="btn btn--ghost">
            Continue shopping
          </Link>
        </div>
      </section>
    )
  }

  const field = (key: keyof CardInput) => (errors[key] ? { 'aria-invalid': true, 'aria-describedby': `${key}-error` } : {})

  return (
    <>
      <PageTitle title="Top up your wallet" subtitle="Pay by card; the amount is added to your Saga Wallet immediately." />
      <form className="card-form" onSubmit={submit} noValidate>
        <fieldset>
          <legend>Amount</legend>
          <div className="preset-row">
            {PRESETS.map((p) => (
              <button type="button" key={p} className={`chip ${Number(amount) === p ? 'chip--active' : ''}`} onClick={() => setAmount(String(p))}>
                {formatMoney(p)}
              </button>
            ))}
          </div>
          <label>
            Other amount (USD)
            <input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ''))} aria-invalid={!!errors.amount} />
          </label>
          {errors.amount && <span className="field-error">{errors.amount}</span>}
        </fieldset>

        <fieldset>
          <legend>Card details</legend>
          <label>
            Card number
            <div className="card-number">
              <input
                aria-label="Card number"
                autoComplete="cc-number"
                inputMode="numeric"
                placeholder="1234 5678 9012 3456"
                value={card.number}
                onChange={(e) => {
                  setCard({ ...card, number: formatCardNumber(e.target.value) })
                  if (status === 'declined') setStatus('idle')   // a new card: forget the old decline
                }}
                {...field('number')}
              />
              {brand !== 'Unknown' && <span className="card-brand">{brand}</span>}
            </div>
          </label>
          {errors.number && <span id="number-error" className="field-error">{errors.number}</span>}
          <label>
            Name on card
            <input autoComplete="cc-name" value={card.name} onChange={(e) => setCard({ ...card, name: e.target.value })} {...field('name')} />
          </label>
          {errors.name && <span id="name-error" className="field-error">{errors.name}</span>}
          <div className="form-row">
            <label>
              Expiry (MM/YY)
              <input
                autoComplete="cc-exp"
                inputMode="numeric"
                placeholder="MM/YY"
                value={card.expiry}
                onChange={(e) => setCard({ ...card, expiry: formatExpiry(e.target.value) })}
                {...field('expiry')}
              />
            </label>
            <label>
              Security code
              <input
                autoComplete="cc-csc"
                inputMode="numeric"
                placeholder={brand === 'American Express' ? '4 digits' : '3 digits'}
                value={card.cvc}
                onChange={(e) => setCard({ ...card, cvc: digitsOnly(e.target.value).slice(0, 4) })}
                {...field('cvc')}
              />
            </label>
          </div>
          {errors.expiry && <span id="expiry-error" className="field-error">{errors.expiry}</span>}
          {errors.cvc && <span id="cvc-error" className="field-error">{errors.cvc}</span>}
        </fieldset>

        {status === 'declined' && <Notice tone="warning">{message}</Notice>}
        {status === 'error' && <div className="notice notice--error" role="alert">{message}</div>}

        <button className="btn btn--primary btn--block" disabled={status === 'authorising'}>
          {status === 'authorising' ? 'Authorising payment…' : `Pay ${value > 0 ? formatMoney(value) : ''}`}
        </button>

        <div className="test-cards">
          <strong>Demo payment – no real money.</strong> Card details stay in your browser. Test cards (any future expiry, any
          3-digit code): <code>{TEST_CARDS.success}</code> is approved, <code>{TEST_CARDS.declined}</code> is declined.
        </div>
      </form>
    </>
  )
}
