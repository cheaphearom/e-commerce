/**
 * Card checks for the simulated payment form. Card data never leaves the browser: after the
 * checks pass, only the amount is sent to the payment-service (wallet top-up).
 */

export type CardBrand = 'Visa' | 'Mastercard' | 'American Express' | 'Unknown'

export function digitsOnly(value: string): string {
  return value.replace(/\D/g, '')
}

/** Luhn checksum, used by every real card number. */
export function luhnValid(number: string): boolean {
  const digits = digitsOnly(number)
  if (digits.length < 12 || digits.length > 19) return false
  let sum = 0
  let double = false
  for (let i = digits.length - 1; i >= 0; i--) {
    let d = Number(digits[i])
    if (double) {
      d *= 2
      if (d > 9) d -= 9
    }
    sum += d
    double = !double
  }
  return sum % 10 === 0
}

export function cardBrand(number: string): CardBrand {
  const d = digitsOnly(number)
  if (d.startsWith('4')) return 'Visa'
  if (/^3[47]/.test(d)) return 'American Express'
  const two = Number(d.slice(0, 2))
  const four = Number(d.slice(0, 4))
  if ((two >= 51 && two <= 55) || (four >= 2221 && four <= 2720)) return 'Mastercard'
  return 'Unknown'
}

/** Groups digits as printed on the card (4-6-5 for American Express, otherwise 4-4-4-4). */
export function formatCardNumber(value: string): string {
  const d = digitsOnly(value).slice(0, 19)
  if (cardBrand(d) === 'American Express') {
    return [d.slice(0, 4), d.slice(4, 10), d.slice(10, 15)].filter(Boolean).join(' ')
  }
  return d.replace(/(.{4})/g, '$1 ').trim()
}

/** "MM/YY" that is not in the past (a card is valid until the end of its month). */
export function expiryValid(value: string, now: Date = new Date()): boolean {
  const m = /^(\d{2})\s*\/\s*(\d{2})$/.exec(value.trim())
  if (!m) return false
  const month = Number(m[1])
  const year = 2000 + Number(m[2])
  if (month < 1 || month > 12) return false
  const endOfMonth = new Date(year, month, 1)
  return endOfMonth > now
}

export function formatExpiry(value: string): string {
  const d = digitsOnly(value).slice(0, 4)
  return d.length > 2 ? `${d.slice(0, 2)}/${d.slice(2)}` : d
}

export function cvcValid(cvc: string, brand: CardBrand): boolean {
  return brand === 'American Express' ? /^\d{4}$/.test(cvc) : /^\d{3}$/.test(cvc)
}

/** Test cards shown on the form. The decline card is refused, like a real test card. */
export const TEST_CARDS = {
  success: '4242 4242 4242 4242',
  declined: '4000 0000 0000 0002',
} as const

export interface CardInput {
  number: string
  name: string
  expiry: string
  cvc: string
}

export type CardErrors = Partial<Record<keyof CardInput, string>>

export function validateCard(card: CardInput, now: Date = new Date()): CardErrors {
  const errors: CardErrors = {}
  const brand = cardBrand(card.number)
  if (!luhnValid(card.number)) errors.number = 'Enter a valid card number'
  if (card.name.trim().length < 2) errors.name = 'Enter the name on the card'
  if (!expiryValid(card.expiry, now)) errors.expiry = 'Enter a future expiry date as MM/YY'
  if (!cvcValid(card.cvc, brand)) errors.cvc = brand === 'American Express' ? 'Enter the 4-digit code' : 'Enter the 3-digit code'
  return errors
}

/** The simulated card network's answer for a valid card. */
export function authorise(number: string): { approved: true } | { approved: false; reason: string } {
  if (digitsOnly(number) === digitsOnly(TEST_CARDS.declined)) {
    return { approved: false, reason: 'Your card was declined by the bank. Try another card.' }
  }
  return { approved: true }
}
