/** Shapes returned by the api-gateway (shop) and the ml-detector (monitor). */

export interface Product {
  id: string
  name: string
  price: number
  availableStock: number
  reservedStock: number
}

export interface Account {
  customerId: string
  balance: number
}

/** PENDING and INVENTORY_RESERVED are in progress; COMPLETED and CANCELLED are final. */
export type OrderStatus = 'PENDING' | 'INVENTORY_RESERVED' | 'COMPLETED' | 'CANCELLED'

export interface Order {
  id: string
  customerId: string
  productId: string
  quantity: number
  amount: number
  status: OrderStatus
  failureReason: string | null
  createdAt: string
  updatedAt?: string
}

export interface ServiceHealth {
  name: string
  health: string
}

export interface MonitorStatus {
  services: ServiceHealth[]
  /** The experiment lock ({ out: "/results/run_3", ... }) or null when no experiment runs. */
  experiment_running: { out?: string } | null
}

export function isFinal(status: OrderStatus): boolean {
  return status === 'COMPLETED' || status === 'CANCELLED'
}
