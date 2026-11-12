# Saga Store (React web shop)

The e-commerce website of the thesis system: a React + TypeScript single-page app on top of the
existing APIs. It runs at <http://localhost:3000> with `docker compose up -d`.

| Page | Path | What it does |
|---|---|---|
| Home | `/` | categories, popular products |
| Shop | `/products` | search, category, price and stock filters, sorting |
| Product | `/products/P-101` | details, highlights, stock, quantity, add to cart / buy now |
| Cart | `/cart` | change quantities, remove lines, totals (kept in the browser, one cart per customer) |
| Checkout | `/checkout` | review, wallet balance check, pay; one order per cart line |
| Confirmation | `/orders/confirmation` | follows every order through the saga until completed or cancelled |
| My account | `/account` | wallet balance, top-up, order history, order details with the saga steps |
| Top up (payment) | `/account/top-up` | card payment form for the wallet |
| Sign in / out | `/login`, `/logout` | demo customers and admin |
| Admin | `/admin` | dashboard, orders (filters), products (restock), customers (credit wallets) |

## Demo accounts and payments

- **Sign in:** customers `C-001` … `C-020` with password `shop123`; the admin is `admin` /
  `admin123`. The backend has no user accounts, so these passwords only guard the pages of this
  site – they do not protect the API. `C-007` and `C-014` start with a balance of $50, so their
  payments get declined (the saga cancels with `INSUFFICIENT_FUNDS`), as in the experiments.
- **Payment:** checkout pays from the customer's wallet; the payment-service charges it inside
  the saga and refunds it if a later step fails. The **top-up** page is a simulated card
  payment: the card is checked in the browser (Luhn checksum, expiry, security code) and
  authorised by a simulated network. Card details never leave the browser; only the amount is
  sent (`POST /api/accounts/{id}/topup`). Test cards: `4242 4242 4242 4242` is approved,
  `4000 0000 0000 0002` is declined. No real money is involved.

## Experiments stay clean

Every shop request is real traffic through the gateway and ends up in the analysed logs. Before
showing anything, the site asks the ml-detector (`/monitor/api/services`) whether an experiment
holds the lock; while one runs, every page shows "The store is paused" and the site sends
**nothing** to the gateway (checked: 0 access-log lines). Only the confirmation and order pages
poll, and only until their orders are finished.

## How it is served

`nginx` (see `Dockerfile` and `nginx/default.conf.template`) serves the built site and forwards
`/api/*` to the api-gateway and `/monitor/*` to the ml-detector, so the browser only talks to one
origin. Upstreams are set with `GATEWAY_UPSTREAM`, `MONITOR_UPSTREAM` and `NGINX_RESOLVER`.

## Develop and test

Node 22. With the system running (`docker compose up -d`), from this folder:

```bash
npm install
```

```bash
npm run dev
```

The dev server (port 3000) forwards `/api` and `/monitor` like nginx does; point it elsewhere
with `GATEWAY_URL` and `MONITOR_URL`. Checks:

```bash
npm run typecheck
```

```bash
npm run lint
```

```bash
npm test
```

```bash
npm run build
```

The tests (Vitest + Testing Library) run against an in-memory gateway and monitor
(`src/test/fakeShop.tsx`): browsing, sign-in and sign-out, checkout with the saga, declined and
approved card payments, the account history, the admin pages and the experiment pause.

## Limits (frontend only, by design)

- One order holds one product (backend rule), so a cart with three products becomes three orders.
- The backend lists at most the 100 most recent orders of all customers. The account page
  therefore also remembers the orders placed in this browser and looks them up one by one; the
  admin pages show the latest 100.
- Product texts and categories live in `src/lib/catalog.ts`; prices, names and stock always come
  from the inventory-service. Products are drawn as SVG illustrations, so no images are needed.
