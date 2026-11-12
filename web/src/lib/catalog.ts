/**
 * Shop content the backend does not store: category, description and highlights per product.
 * Prices, names and stock always come from the inventory-service; this only adds text.
 */
export type ProductKind = 'cable' | 'mouse' | 'keyboard' | 'monitor' | 'stand' | 'headphones' | 'generic'

export interface ProductInfo {
  category: string
  kind: ProductKind
  tagline: string
  description: string
  highlights: string[]
}

const INFO: Record<string, ProductInfo> = {
  'P-100': {
    category: 'Cables & Adapters',
    kind: 'cable',
    tagline: 'Fast charging and data for every USB-C device',
    description:
      'A braided 1 m USB-C to USB-C cable that charges laptops, tablets and phones at up to 100 W and moves data at 10 Gbit/s.',
    highlights: ['100 W power delivery', '10 Gbit/s USB 3.2', 'Braided nylon, 1 m', 'Works with laptops, phones and tablets'],
  },
  'P-101': {
    category: 'Mice & Keyboards',
    kind: 'mouse',
    tagline: 'Quiet clicks, all-day comfort',
    description:
      'A compact wireless mouse with silent buttons, a 4000 DPI sensor and a battery that lasts up to 18 months.',
    highlights: ['Silent clicks', 'Up to 4000 DPI', 'Bluetooth and USB receiver', '18-month battery life'],
  },
  'P-102': {
    category: 'Mice & Keyboards',
    kind: 'keyboard',
    tagline: 'Tactile switches for focused typing',
    description:
      'A tenkeyless mechanical keyboard with hot-swappable tactile switches, PBT keycaps and white backlighting.',
    highlights: ['Hot-swappable tactile switches', 'PBT double-shot keycaps', 'Tenkeyless layout', 'USB-C, detachable cable'],
  },
  'P-103': {
    category: 'Displays',
    kind: 'monitor',
    tagline: 'Sharp 1440p for work and play',
    description:
      'A 27-inch IPS monitor with 2560 × 1440 resolution, 144 Hz refresh rate and a height-adjustable stand.',
    highlights: ['27" IPS, 2560 × 1440', '144 Hz, 1 ms', 'USB-C with 65 W charging', 'Height and tilt adjustable'],
  },
  'P-104': {
    category: 'Accessories',
    kind: 'stand',
    tagline: 'Raise your screen, relax your neck',
    description:
      'A foldable aluminium laptop stand with six height settings that fits laptops from 10 to 17 inches.',
    highlights: ['Six height settings', 'Aluminium, 280 g', 'Folds flat for travel', 'Fits 10–17" laptops'],
  },
  'P-105': {
    category: 'Audio',
    kind: 'headphones',
    tagline: 'Silence on demand',
    description:
      'Over-ear wireless headphones with adaptive noise cancelling, 40 hours of battery and a clear voice microphone.',
    highlights: ['Adaptive noise cancelling', '40 h battery', 'Multipoint Bluetooth', 'Foldable with case'],
  },
}

export function productInfo(id: string): ProductInfo {
  return (
    INFO[id] ?? {
      category: 'Other',
      kind: 'generic',
      tagline: '',
      description: 'A product from our catalogue.',
      highlights: [],
    }
  )
}

export function categories(ids: string[]): string[] {
  return [...new Set(ids.map((id) => productInfo(id).category))].sort()
}
