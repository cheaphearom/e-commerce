import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { RouterProvider, createBrowserRouter } from 'react-router'
import { routes } from './routes'
import { AuthProvider } from './state/auth'
import { CartProvider } from './state/cart'
import { ExperimentProvider } from './state/experiment'
import './styles.css'

const router = createBrowserRouter(routes)

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ExperimentProvider>
      <AuthProvider>
        <CartProvider>
          <RouterProvider router={router} />
        </CartProvider>
      </AuthProvider>
    </ExperimentProvider>
  </StrictMode>,
)
