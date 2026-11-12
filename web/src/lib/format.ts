import type { OrderStatus } from '../api/types'

const money = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' })

export function formatMoney(value: number): string {
  return money.format(value)
}

export function formatDateTime(iso: string | undefined | null): string {
  if (!iso) return '–'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '–'
  return d.toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

export function shortId(id: string): string {
  return id.slice(0, 8).toUpperCase()
}

/** Status label for customers. */
export function statusLabel(status: OrderStatus): string {
  switch (status) {
    case 'COMPLETED':
      return 'Completed'
    case 'CANCELLED':
      return 'Cancelled'
    case 'INVENTORY_RESERVED':
      return 'Paying'
    default:
      return 'Processing'
  }
}

/** Why an order was cancelled, in plain words. */
export function failureText(reason: string | null | undefined): string {
  switch (reason) {
    case null:
    case undefined:
    case '':
      return ''
    case 'INSUFFICIENT_FUNDS':
      return 'Payment declined: not enough balance in the wallet'
    case 'OUT_OF_STOCK':
      return 'Not enough stock'
    case 'SAGA_TIMEOUT':
      return 'The order took too long and was cancelled (the system was slow)'
    case 'PROCESSING_ERROR':
      return 'A technical error occurred while processing the order'
    case 'UNKNOWN_PRODUCT':
      return 'This product no longer exists'
    case 'UNKNOWN_CUSTOMER':
      return 'Unknown customer account'
    default:
      return reason.replaceAll('_', ' ').toLowerCase()
  }
}
