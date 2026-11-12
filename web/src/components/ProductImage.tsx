import type { ReactNode } from 'react'
import type { ProductKind } from '../lib/catalog'
import { productInfo } from '../lib/catalog'

/** Simple line illustrations, so the shop needs no image files or image hosting. */
const DRAWINGS: Record<ProductKind, ReactNode> = {
  cable: (
    <>
      <path d="M30 70 C30 40, 90 40, 90 70 S150 100, 150 70" />
      <rect x="18" y="64" width="16" height="26" rx="4" />
      <rect x="146" y="50" width="16" height="26" rx="4" />
      <path d="M22 90v8M30 90v8M150 50v-8M158 50v-8" />
    </>
  ),
  mouse: (
    <>
      <rect x="62" y="22" width="56" height="96" rx="28" />
      <path d="M62 60h56M90 22v38" />
      <rect x="86" y="34" width="8" height="14" rx="4" />
    </>
  ),
  keyboard: (
    <>
      <rect x="16" y="40" width="148" height="62" rx="8" />
      {[0, 1, 2].map((row) =>
        Array.from({ length: 10 - row }, (_, i) => (
          <rect key={`${row}-${i}`} x={26 + row * 6 + i * 13} y={50 + row * 14} width="9" height="9" rx="2" />
        )),
      )}
      <rect x="56" y="90" width="68" height="6" rx="2" />
    </>
  ),
  monitor: (
    <>
      <rect x="18" y="20" width="144" height="88" rx="6" />
      <rect x="28" y="30" width="124" height="68" rx="2" />
      <path d="M80 108v14M100 108v14M62 124h56" />
    </>
  ),
  stand: (
    <>
      <path d="M30 110 L130 50 L150 50" />
      <path d="M44 110 L110 110 L150 50" />
      <rect x="60" y="34" width="96" height="10" rx="3" transform="rotate(-31 108 39)" />
    </>
  ),
  headphones: (
    <>
      <path d="M44 88 V70 a46 46 0 0 1 92 0 V88" />
      <rect x="32" y="80" width="24" height="40" rx="10" />
      <rect x="124" y="80" width="24" height="40" rx="10" />
    </>
  ),
  generic: (
    <>
      <path d="M40 50 L90 28 L140 50 L140 106 L90 128 L40 106 Z" />
      <path d="M40 50 L90 72 L140 50 M90 72 V128" />
    </>
  ),
}

export function ProductImage({ productId, size = 'card' }: { productId: string; size?: 'card' | 'large' | 'thumb' }) {
  const info = productInfo(productId)
  return (
    <div className={`product-image product-image--${size} product-image--${info.kind}`} aria-hidden="true">
      <svg viewBox="0 0 180 140" fill="none" stroke="currentColor" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round">
        {DRAWINGS[info.kind]}
      </svg>
    </div>
  )
}
