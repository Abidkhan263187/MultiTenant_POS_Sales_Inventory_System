# Multi-tenant POS API

Backend for a simplified point-of-sale platform. Merchants have stores, each store has its own products and inventory, and a sale updates stock and payment in one database transaction.

## Stack

- NestJS and TypeScript
- PostgreSQL with TypeORM
- JWT authentication
- Redis for the product catalog cache (optional at runtime)
- Jest and Supertest

## Run it from the repository

The repository does not contain `.env` or database passwords. After cloning, create that file locally. You need Node.js 20 or newer and a PostgreSQL database. Redis is optional.

### 1. Clone and install

```bash
git clone <your-repository-url>
cd POS
npm install
```

### 2. Create the environment file

Windows:

```bash
copy .env.example .env
```

macOS and Linux:

```bash
cp .env.example .env
```

Open `.env` and set your own database URL and JWT secret:

```env
DATABASE_URL=postgresql://postgres:your-password@your-host:5432/postgres
DATABASE_SSL=false
JWT_SECRET=replace-with-a-long-random-string
```

Use `DATABASE_SSL=true` for Supabase. Use `DATABASE_SSL=false` for PostgreSQL running on your own machine.

If the password contains `@`, `#`, `%`, or `:`, encode that character in the URL. `@` is `%40`. An unencoded `@` makes the host part of the URL wrong.

For Supabase, copy the connection string from **Project Settings → Database → Connection string**. If `db.<project-ref>.supabase.co` does not resolve or only has an IPv6 address, use the **Session pooler** string instead. The pooler username looks like `postgres.<project-ref>`. Keep `DATABASE_SSL=true`.

`.env.example` shows the variable names. Do not commit `.env`.

### 3. Create the tables and sample data

```bash
npm run migration:run
npm run seed
```

The migration creates merchants, stores, users, products, inventory, sales, and payments. The seed loads two merchants and the demo users below. Running the seed again is safe: if the demo admin already exists, it skips.

### 4. Start the API

```bash
npm run start:dev
```

Open `http://localhost:3000/api/health`. A healthy response looks like:

```json
{ "status": "ok", "database": "up", "redis": "disabled" }
```

`redis` is `"disabled"` until Redis is configured. The API still serves product lists from PostgreSQL. Startup also runs migrations unless `DB_MIGRATE_ON_START=false`.

### 5. Call the API

Import `postman/pos-system.postman_collection.json`. Run **Login store 1 cashier** first. That saves the token for the later requests.

Or log in directly:

```http
POST http://localhost:3000/api/auth/login
Content-Type: application/json

{ "email": "cashier.store1@pos.test", "password": "Password123!" }
```

Use the returned `accessToken` as `Authorization: Bearer <token>`.

### 6. Optional: Redis catalog cache

Install Redis and start it so it listens on port 6379. On Windows, `winget install taizod1024.redis-windows-fork`, then open a new terminal and run `redis-server`.

Add this to `.env`:

```env
REDIS_URL=redis://127.0.0.1:6379
```

Stop the API and run `npm run start:dev` again. `.env` is read only when the process starts. The log should include `Redis cache connected`, and `/api/health` should show `"redis": "up"`.

`GET /api/stores/:storeId/products` then returns `X-Cache: MISS` the first time and `X-Cache: HIT` after that. Creating or updating a product clears that store's cache.

### Demo users

Password for every user: `Password123!`

| Email | Role | Access |
| --- | --- | --- |
| admin.a@pos.test | Merchant admin | Both Merchant A stores |
| manager.store1@pos.test | Store manager | Store 1 |
| cashier.store1@pos.test | Cashier | Store 1 |
| cashier.store2@pos.test | Cashier | Store 2 |
| admin.b@pos.test | Merchant admin | Merchant B |
| cashier.store3@pos.test | Cashier | Store 3 |

Merchant A has Store 1 (Downtown) and Store 2 (Mall). Merchant B has Store 3 (Airport). Store 1 starts with Americano (₹30.00, 50 on hand) and Masala Tea (₹20.00, 5 on hand).

### Tests

```bash
npm test
npm run test:unit
```

`npm test` uses `DATABASE_URL` from `.env`, migrates, seeds, and covers a successful sale, a failed payment, insufficient stock, cross-tenant access, and a duplicate idempotency key. A concurrent stock test is included.

## API overview

| Method | Path | Who |
| --- | --- | --- |
| POST | `/api/auth/login` | Public |
| GET | `/api/auth/me` | Any signed-in user |
| GET | `/api/stores` | Stores the user may use |
| GET | `/api/stores/:storeId/products` | Read catalog. Response header `X-Cache` is `HIT`, `MISS`, or `BYPASS` |
| POST | `/api/stores/:storeId/products` | Merchant admin, store manager |
| PATCH | `/api/stores/:storeId/products/:productId` | Merchant admin, store manager |
| GET | `/api/stores/:storeId/inventory` | Read stock |
| POST | `/api/stores/:storeId/inventory/adjustments` | Merchant admin, store manager. Body `{ productId, delta }` |
| POST | `/api/stores/:storeId/sales` | Create a sale. Header `Idempotency-Key` is required |
| GET | `/api/stores/:storeId/sales` | List sales. Optional `idempotencyKey` and `limit` |
| GET | `/api/stores/:storeId/sales/:saleId` | One sale |

`/api/stores/:storeId/orders` is the same resource as sales. A sale is the order.

Prices are integer minor units (paise). The client does not send a price. `paymentOutcome` is only a switch for the mock provider (`SUCCESS` or `FAILED`).

Example sale:

```http
POST /api/stores/11111111-1111-4111-8111-111111111101/sales
Authorization: Bearer <token>
Idempotency-Key: 4f1c0b2e-6a1d-4c2a-9e5b-1a2b3c4d5e6f

{
  "items": [{ "productId": "11111111-1111-4111-8111-111111111301", "quantity": 2 }],
  "paymentOutcome": "SUCCESS"
}
```

## Database

Migrations live in `src/database/migrations`. The first creates the schema. The second allows a sale status of `FAILED`.

```
merchants 1---* stores 1---* users
stores 1---* products 1---1 inventory
stores 1---* sales *---1 users
sales 1---* sale_items *---1 products
sales 1---1 payments
```

Choices:

- Money is `integer` cents so totals do not use floating point.
- `products (store_id, sku)` is unique. SKU can repeat in another store.
- `inventory (store_id, product_id)` is unique, with `quantity_on_hand >= 0`.
- `sales (store_id, idempotency_key)` is unique.
- Sale lines store the sku, name, and unit price from the moment of sale.
- A merchant admin must have `store_id` null. A manager or cashier must have a store. That is a database check, not only application code.
- Foreign keys use `ON DELETE RESTRICT`.
- Indexes cover store lookups, user lookup, and sales listed by time.

`synchronize` is off. Schema changes go through migrations.

## Tenant isolation

The JWT is loaded into the user on each request (id, role, merchant, store). `StoreAccessGuard` loads the store from the URL and rejects the request when:

- the store belongs to another merchant (403), or
- the user is a cashier or manager for a different store (403).

A missing store is 404. Product, inventory, and sale queries always include that authorized `storeId`, so substituting another tenant's product id does not read or sell their stock. Merchant admins can use every store of their own merchant only.

## Transactions and concurrency

Creating a sale runs in one `READ COMMITTED` transaction:

1. If this store already has the idempotency key, return that sale.
2. Load active products for this store and use their prices.
3. `SELECT ... FOR UPDATE` the inventory rows, ordered by product id, so two sales cannot deadlock by locking the same rows in opposite orders.
4. Reject the sale if any line asks for more than `quantity_on_hand`.
5. Insert the sale as `PENDING` with its lines. The unique key is claimed before payment.
6. Call the payment provider.
7. On failure, mark the sale `FAILED`, store the declined payment, and commit. Stock is not changed.
8. On success, `UPDATE inventory SET quantity_on_hand = quantity_on_hand - $qty WHERE quantity_on_hand >= $qty`.
9. Mark the sale `COMPLETED` and insert the successful payment row.
10. Commit.

Two terminals selling 3 units from a stock of 5 are serialized by the row lock. The second sale sees the remaining 2 and is rejected. The conditional update is a second guard if the locked quantity changed. A database deadlock is returned as `409 CONCURRENT_CONFLICT`.

Stock receipts use the same row lock and add a delta (`quantity_on_hand + delta >= 0`) so a receipt does not overwrite a sale with an absolute count.

The mock provider is called inside the transaction. That keeps the sale and the stock in one commit, and it is safe here because the mock has no external side effect. A real provider can succeed and then the process can die before commit. Production code should send the same idempotency key to the provider and reconcile charges that have no committed sale. That saga is out of scope for this assignment.

## Idempotency

The POS sends `Idempotency-Key`. The server stores a hash of the merged line items and the mock payment outcome.

- Same key and same body: the original sale is returned (`200` on a retry, `201` the first time, `402` when the first result was a failed payment). Stock is not reduced again.
- Same key and a different body: `409 IDEMPOTENCY_PAYLOAD_MISMATCH`.
- Two parallel requests with the same key: the unique index `(store_id, idempotency_key)` lets one insert win. The other waits, then either reads the committed sale or hits the unique violation and returns that sale.
- A failed payment is stored once. Retrying that same key returns the failed sale and does not charge or change stock again. A new attempt needs a new key.

Duplicate lines for one product in a single request are merged before pricing and hashing.

## Payments

`PaymentProvider` is the only payment API the sale service calls. `MockPaymentProvider` is bound to that token in `PaymentsModule`. `paymentOutcome: "FAILED"` makes the mock decline. The sale service does not set a sale to paid by itself; it uses the provider result. Replacing the mock means implementing `charge()` and changing the binding.

## Redis

`GET /api/stores/:storeId/products` is the cached read. The key is `pos:products:{storeId}` and the TTL is `CACHE_TTL_SECONDS` (default 60). Creating or updating a product deletes that key. Inventory is not cached, because a sale must see current stock.

If `REDIS_URL` is unset, or Redis is down, the service logs a warning and reads PostgreSQL. `X-Cache` is `BYPASS` in that case. The API does not fail because the cache is down.

Trade-off: a short TTL can serve a stale catalog for up to a minute if a delete is missed. Stock is never taken from this cache. There is no stampede protection; a catalog this small does not need it.

## Assumptions

- There is no public registration. Users are created by the seed.
- A sale is the order. A declined payment is stored as a `FAILED` sale with its payment row, and inventory is left unchanged.
- `paymentOutcome` exists so tests and Postman can force the mock result. It is not a price and it is not used as the amount.
- Cashiers can sell and view. Managers and merchant admins can also change products and stock.
- One catalog is loaded in full per store. Pagination can be added if a store grows past a few hundred products.

## Project layout

```
src/auth            login, JWT, user lookup
src/stores          store list and tenant checks
src/products        catalog and Redis cache
src/inventory       stock reads and adjustments
src/sales           sale transaction, idempotency
src/payments        payment provider and mock
src/database        entities, migration, seed
```

Controllers call services. Services call repositories. Repositories are the TypeORM query layer.
