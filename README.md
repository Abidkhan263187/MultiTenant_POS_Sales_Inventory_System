# Multi-tenant POS API

A point-of-sale API for more than one business on one database. Abid and Swazei are the demo merchants. Each has stores, a catalog, and stock. A sale prices the cart from the catalog, takes payment, and updates stock together.

## Setup and environment configuration

You need Node.js 20 or newer and PostgreSQL. Redis is optional. The repository does not contain `.env` or passwords.

```bash
npm install
copy .env.example .env
```

On macOS or Linux, use `cp .env.example .env` instead of `copy`.

Open `.env` and set your own values:

```env
DATABASE_URL=postgresql://postgres:your-password@your-host:5432/postgres
DATABASE_SSL=false
JWT_SECRET=replace-with-a-long-random-string
```

Use `DATABASE_SSL=true` for Supabase and `DATABASE_SSL=false` for PostgreSQL on your own machine. If the password contains `@`, `#`, `%`, or `:`, encode it in the URL. `@` is `%40`. An unencoded `@` makes the host wrong.

For Supabase, copy the connection string from **Project Settings → Database → Connection string**. If `db.<project-ref>.supabase.co` does not resolve, use the session pooler string. The pooler username looks like `postgres.<project-ref>`. Keep `DATABASE_SSL=true`.

Other settings in `.env.example`:

| Variable | Purpose |
| --- | --- |
| `JWT_EXPIRES_IN` | Token lifetime. Default `12h`. |
| `DB_MIGRATE_ON_START` | Run migrations when the API starts. Default `true`. |
| `REDIS_URL` | Local catalog cache, for example `redis://127.0.0.1:6379`. |
| `REDIS_SERVER` | Full path to `redis-server` if it is not on your PATH. |
| `CACHE_TTL_SECONDS` | How long a product list stays in Redis. Default 60. |
| `LOGIN_RATE_LIMIT` | Login attempts per address. Default 30 per 15 minutes. |
| `LOGIN_EMAIL_RATE_LIMIT` | Login attempts per email. Default 20 per 15 minutes. |
| `API_RATE_LIMIT` | Other requests per address. Default 300 per minute. |

Create the tables and demo data, then start the API:

```bash
npm run migration:run
npm run seed
npm run start:dev
```

`npm run seed` clears merchants, stores, users, products, stock, sales, and payments, then loads the demo again. Do not run it against a database you need to keep.

Open `http://localhost:3000/api/health`. A healthy response is `{ "status": "ok", "database": "up", "redis": "up" }` or `"redis": "disabled"` when Redis is not configured.

Import `postman/pos-system.postman_collection.json` and run **Login Abid Cafe Connaught Place cashier** first. Or log in directly:

```http
POST http://localhost:3000/api/auth/login
Content-Type: application/json

{ "email": "cashier.connaught@pos.test", "password": "Password123!" }
```

Send the returned `accessToken` as `Authorization: Bearer <token>`.

Every demo user uses the password `Password123!`.

| Email | Who | Access |
| --- | --- | --- |
| abid@pos.test | Abid, merchant admin | Both Abid stores |
| manager.connaught@pos.test | Connaught Place manager | Abid Cafe, Connaught Place |
| cashier.connaught@pos.test | Connaught Place cashier | Abid Cafe, Connaught Place |
| cashier.citywalk@pos.test | Select Citywalk cashier | Abid Cafe, Select Citywalk |
| swazei@pos.test | Swazei, merchant admin | Swazei Bakes, IGI Airport |
| cashier.igi@pos.test | IGI Airport cashier | Swazei Bakes, IGI Airport |

Connaught Place starts with Americano (₹30.00, 50), Masala Chai (₹20.00, 5), Veg Samosa (₹25.00, 40), and Butter Croissant (₹80.00, 24). Select Citywalk starts with Chocolate Muffin (₹45.00, 30) and Cold Coffee (₹90.00, 18). IGI Airport starts with Grilled Vegetable Sandwich (₹120.00, 15) and Filter Coffee (₹40.00, 20).

JSON prices are paise. `priceLabel` and `totalLabel` are the rupee text a cashier can read.

Helmet adds the usual browser headers (`nosniff`, frame protection, no `X-Powered-By`). Login is limited so a wrong password cannot be guessed in a tight loop. A blocked call returns `429` and `Retry-After`.

```bash
npm test
npm run test:unit
```

`npm test` migrates, seeds, and covers a paid sale, a declined payment, insufficient stock, another tenant, a repeated idempotency key, and two tills selling the last units at the same time.

## Database and schema decisions

Migrations in `src/database/migrations` own the schema. TypeORM `synchronize` is off.

```
merchants 1---* stores 1---* users
stores 1---* products 1---1 inventory
stores 1---* sales *---1 users
sales 1---* sale_items *---1 products
sales 1---1 payments
sales 1---1 payment_events
```

Money is an integer number of paise, so totals do not use floating point. A product price is unique to a store: `(store_id, sku)` is unique, and the same SKU may exist in another store. Stock is one row per product in a store, and `quantity_on_hand` cannot go below zero. That check is in the database, not only in application code.

A sale line copies the SKU, name, and unit price at the time of sale. A later price change does not rewrite old receipts. `(store_id, idempotency_key)` is unique, so the same till tap cannot insert two sales.

A merchant admin must have `store_id` null. A manager or cashier must have a store. Foreign keys use `ON DELETE RESTRICT`, so a product that has been sold cannot be deleted out from under a receipt. `payment_events` is the lookup table for declined and successful payments: merchant, store, cashier, sale, amount, and products.

## Tenant isolation approach

The signed token carries the user id, role, merchant, and store. The API does not query the user table on every request.

`StoreAccessGuard` checks the store in the URL. The store list is kept in memory and reloaded when a store is missing or the list is older than a minute. The guard returns 403 when the store belongs to another merchant, or when a cashier or manager asks for a store that is not theirs. A missing store is 404.

Product, stock, and sale queries always include that store id. Sending another business's product id does not read or sell their stock. Abid can use both Abid stores. Abid cannot open Swazei's store.

## Transaction and concurrency strategy

A sale is one database call, `pos_create_sale`. PostgreSQL runs that function as a single `READ COMMITTED` transaction:

1. If this store already has the idempotency key, return that sale.
2. Load the active products and use their prices. The client does not send a price.
3. Lock the stock rows with `SELECT … FOR UPDATE`, in product id order, so two tills cannot deadlock by locking the same rows in opposite orders.
4. If any line asks for more than `quantity_on_hand`, stop. Nothing is saved.
5. Insert the sale and its lines. The unique key is claimed in that statement.
6. Store the payment result. On failure the sale is `FAILED` and stock is unchanged. On success, subtract stock only where `quantity_on_hand` is still enough, and mark the sale `COMPLETED`.

Two tills each selling 3 units when stock is 5 are serialized by the row lock. The second sale sees 2 left and is rejected. The conditional update is a second guard. A deadlock comes back as `409 CONCURRENT_CONFLICT`.

A stock receipt uses the same row lock and adds a delta, so a delivery cannot overwrite a sale with an absolute count.

The mock payment decision is made in the application, then the function saves the sale, the payment, and the stock change together. That is safe for the mock because it has no external side effect. A real card provider can succeed and the process can die before commit. Production code should send the same idempotency key to the provider and reconcile charges that have no committed sale. That reconciliation is out of scope here.

There is no message queue. The sale is short and must commit stock and payment together, so a queue would only add a gap between "paid" and "stock updated."

## Idempotency approach

The till sends `Idempotency-Key`. The server stores a hash of the merged lines and the mock payment outcome.

- Same key and same body: the original sale is returned. `201` the first time, `200` on a retry, `402` when the first result was a declined payment. Stock is not reduced again.
- Same key and a different body: `409 IDEMPOTENCY_PAYLOAD_MISMATCH`.
- Two parallel requests with the same key: the unique index lets one insert win. The other reads that sale or hits the unique violation and returns it.
- A declined payment is stored once. Retrying that key does not charge again. A new attempt needs a new key.

Duplicate lines for one product in a single request are merged before pricing and hashing.

## Redis and trade-offs

Redis caches one thing: the product list for a store. The key is `pos:products:{storeId}` and it expires after `CACHE_TTL_SECONDS` (default 60). Creating or updating a product deletes that key. The first read is `X-Cache: MISS`. The next read is `X-Cache: HIT` and does not query PostgreSQL.

If `REDIS_URL` points at this machine, `npm run start:dev` starts `redis-server` when port 6379 is free. If Redis is already running, the API uses it.

Stock, sales, and payments are not cached. A sale has to see the quantity on hand at that moment. Caching stock would let two tills sell the same units.

If Redis is unset or down, the API logs a warning and reads PostgreSQL. `X-Cache` is `BYPASS`. The sale still works. The trade-off is that a missed delete can show a stale name or price for up to a minute. There is no stampede protection; a catalog this small does not need it.

## API

| Method | Path | Who |
| --- | --- | --- |
| POST | `/api/auth/login` | Public |
| GET | `/api/auth/me` | Any signed-in user |
| GET | `/api/stores` | Stores that user may use |
| GET | `/api/stores/:storeId/products` | Catalog. Header `X-Cache` is `HIT`, `MISS`, or `BYPASS` |
| POST | `/api/stores/:storeId/products` | Merchant admin, store manager |
| PATCH | `/api/stores/:storeId/products/:productId` | Merchant admin, store manager |
| GET | `/api/stores/:storeId/inventory` | Stock |
| POST | `/api/stores/:storeId/inventory/adjustments` | Merchant admin, store manager. Body `{ productId, delta }` |
| POST | `/api/stores/:storeId/sales` | Create a sale. Header `Idempotency-Key` is required |
| GET | `/api/stores/:storeId/sales` | List sales. Optional `idempotencyKey` and `limit` |
| GET | `/api/stores/:storeId/sales/:saleId` | One sale |
| GET | `/api/stores/:storeId/payment-events` | Payment log. Merchant admin or store manager. Optional `paymentStatus`, `userId`, `productId`, `limit` |
| GET | `/api/stores/:storeId/payment-events/summary` | Failed and paid totals for that store |
| GET | `/api/payment-events` | Payment log for every store that user may use |
| GET | `/api/payment-events/summary` | Failed and paid totals for those stores |

`/api/stores/:storeId/orders` is the same resource as sales.

`paymentOutcome` is only a switch for the mock provider (`SUCCESS` or `FAILED`). It is not a price. A declined payment is a `FAILED` sale: money was not taken and stock was not changed, so there is nothing to refund. A successful payment is the row to open when a customer asks for a refund. Cashiers cannot read the payment log.

```http
POST /api/stores/11111111-1111-4111-8111-111111111101/sales
Authorization: Bearer <token>
Idempotency-Key: 4f1c0b2e-6a1d-4c2a-9e5b-1a2b3c4d5e6f

{
  "items": [{ "productId": "11111111-1111-4111-8111-111111111301", "quantity": 2 }],
  "paymentOutcome": "SUCCESS"
}
```

## Assumptions

There is no public registration. Users come from the seed. Cashiers sell and view. Managers and merchant admins also change products and stock. One catalog is loaded in full per store. Pagination can be added if a store grows past a few hundred products.

```
src/auth              login and JWT
src/stores            store list and tenant checks
src/products          catalog and Redis cache
src/inventory         stock
src/sales             sale, idempotency
src/payments          payment provider and mock
src/payment-events    payment log for refund lookup
src/database          schema, migrations, seed
```
