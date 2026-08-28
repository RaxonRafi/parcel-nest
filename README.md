## 🗂️ Project Structure

Each feature is a self-contained module folder. Inside it, code is split by role
so a file's job is obvious from its path:

```
src/
├── config/                     # Shared configuration builders
│   ├── database.config.ts      # One DataSourceOptions factory, used by Nest and the CLI
│   └── load-env.ts             # .env loading for processes that boot outside Nest
├── database/
│   ├── data-source.ts          # DataSource the TypeORM CLI points at
│   ├── database.module.ts      # TypeOrmModule.forRootAsync wiring
│   └── migrations/             # Versioned schema changes
├── common/                     # Cross-cutting building blocks
│   ├── access-control.module.ts
│   ├── decorators/             # @Roles, @CurrentUser
│   ├── guards/                 # JwtAuthGuard, RolesGuard
│   ├── types/
│   └── utils/
├── <feature>/                  # user, auth, token, parcel, dashboard, rag, keep-alive
│   ├── controllers/            # HTTP layer only — no business logic
│   ├── services/               # Business logic; the only place repositories live
│   ├── entities/               # TypeORM entities owned by this module
│   ├── dto/                    # Request/response payload shapes
│   ├── types/                  # Enums, interfaces, return types
│   └── <feature>.module.ts     # DI wiring
├── app.module.ts
└── main.ts
```

### Rules the layout enforces

**Entities are reached through services, never across modules.** Only the module
that owns a table calls `TypeOrmModule.forFeature` for it:

| Module   | Owns                              |
|----------|-----------------------------------|
| `user`   | `users`, `auth_providers`         |
| `parcel` | `parcels`, `parcel_status_logs`   |

Everything else asks the owning service. `ParcelService` resolves a receiver via
`UserService.findOrCreateReceiver()`; `DashboardService` injects no repository at
all and composes `UserService.getStats()` with `ParcelService.getStats()`.

**No circular module imports, no `forwardRef`.** JWT signing lives in a
dependency-free `TokenModule`, so `UserModule` and `AuthModule` both depend on it
instead of on each other:

```
TokenModule ─┬─> UserModule ─> AccessControlModule ─┬─> AuthModule
             └────────────────────────────────────  ├─> ParcelModule ─> DashboardModule
                                                    └─> ...
```

`AccessControlModule` bundles the guards with the providers they inject, so a
feature module gets `@UseGuards(JwtAuthGuard, RolesGuard)` by importing one thing.

---

## 🧱 Database Migrations

`synchronize` is **off**. The schema is owned by the files in
`src/database/migrations/` and applied explicitly.

```bash
npm run migration:run       # apply pending migrations
npm run migration:show      # list applied / pending
npm run migration:revert    # roll back the last one
```

To add a change, edit the entity, then let TypeORM diff it against the database:

```bash
npm run migration:generate -- src/database/migrations/AddParcelWeight
```

For a migration you want to hand-write, use `npm run migration:create -- src/database/migrations/Name`.

**Existing databases:** the baseline migration is written with `CREATE TABLE IF
NOT EXISTS`, so running it against a database that `synchronize` already built is
a no-op that just records the baseline. (`npm run migration:run -- --fake` is the
alternative if you would rather not touch it at all.)

Connection settings come from `DATABASE_URL`, or the discrete `DB_*` variables —
see `example.env`. Set `DB_SSL=false` for a local Postgres without TLS. Migrations
are **not** run on boot by default; set `DB_MIGRATIONS_RUN=true` if you want that.

---

## 🖥️ Frontend (Next.js)

The SwiftParcel UI lives in [`percel-client/`](./percel-client/) — landing page + dashboard from `design-reference/swiftparcel.html`.

```bash
cd percel-client && npm install && npm run dev
```

Set the API URL in `percel-client/.env.local`:

```env
NEXT_PUBLIC_API_BASE_URL=http://localhost:3000/api
```

Change this after deployment (e.g. `https://api.yourdomain.com/api`). Client runs on **http://localhost:3001**, API on **http://localhost:3000**.

---

## 🧪 Automated API Tests

E2E tests cover every endpoint below using an in-memory SQLite database (no live Supabase required).

```bash
npm run test:api
```

Also available: `npm run test:e2e` (same suite).

---

## 📘 API Endpoints Summary

### 🔐 Auth Routes

| Method | Endpoint             | Access      | Description                      |
|--------|----------------------|-------------|----------------------------------|
| POST   | `/api/auth/login`    | Public      | Login with credentials           |
| POST   | `/api/auth/refresh-token` | Public | Get a new access token using refresh token |
| POST   | `/api/auth/logout`   | Authenticated | Logout and clear refresh token |
| POST   | `/api/auth/change-password` | Authenticated (All Roles) | Change current password |

---

### 👤 User Routes

| Method | Endpoint                 | Access         | Description                     |
|--------|--------------------------|----------------|---------------------------------|
| POST   | `/api/users/register`    | Public         | Create a new user (Sender)      |
| PATCH  | `/api/users/update-profile` | Authenticated (All Roles) | Update own profile          |
| GET    | `/api/users/me`          | Authenticated (All Roles) | Get own user details       |
| GET    | `/api/users/all-users`   | Admin          | Get all users                    |
| GET    | `/api/users/:id`         | Admin          | Get single user by ID           |
| PATCH  | `/api/users/:userId/block` | Admin        | Block a user                     |
| PATCH  | `/api/users/:userId/unblock` | Admin      | Unblock a user                   |

---

### 📦 Parcel Routes

| Method | Endpoint                            | Access        | Description                                   |
|--------|-------------------------------------|---------------|-----------------------------------------------|
| POST   | `/api/parcels/`                     | Sender, Admin | Create a new parcel                           |
| PATCH  | `/api/parcels/:trackingId/status`   | Admin         | Update parcel status                          |
| PATCH  | `/api/parcels/:trackingId/cancel`   | Sender        | Cancel a parcel                               |
| PATCH  | `/api/parcels/:trackingId/confirm`  | Receiver      | Confirm parcel delivery                       |
| PATCH  | `/api/parcels/:trackingId/block`    | Admin         | Block a parcel                                |
| GET    | `/api/parcels/my-parcels`           | Sender        | View own parcels and status logs              |
| GET    | `/api/parcels/incoming-parcels`     | Receiver      | View incoming parcels                          |
| GET    | `/api/parcels/delivery-history`     | Receiver      | View delivery history                          |
| GET    | `/api/parcels/`                     | Admin         | Get all parcels                                |
| GET    | `/api/parcels/:trackingId`          | Public        | Get single parcel by tracking ID              |

---
### 📦 Dashboard Routes

| Method | Endpoint                            | Access        | Description                                   |
|--------|-------------------------------------|---------------|-----------------------------------------------|
| GET   | `/api/dashboard/`                     | Admin | Get Dashboard Stats                           |

---

## 🤖 RAG (Retrieval-Augmented Generation)

This project now includes a RAG module for:

- Q&A over uploaded PDF knowledge docs (policy/help content)
- Q&A over live parcel tracking context
- Hybrid retrieval using both sources

### ✅ Automatic Parcel Indexing

Parcel records are automatically indexed into the vector store whenever parcel state changes in DB flows:

- Parcel created
- Parcel status updated
- Parcel cancelled
- Parcel delivery confirmed
- Parcel blocked

This makes queries like "Where is my parcel TRK-1042?" answerable via `/api/rag/ask`.

### 🔧 RAG Environment Variables

Make sure these are configured:

```env
PINECONE_API_KEY=...
PINECONE_INDEX=...
HUGGINGFACE_API_KEY=...
GROQ_API_KEY=...

# Used by internal parcel->RAG indexing call (optional fallbacks are APP_URL then localhost)
INTERNAL_API_BASE_URL=http://localhost:5000
```

### 📚 RAG Routes

| Method | Endpoint                         | Description |
|--------|----------------------------------|-------------|
| POST   | `/api/rag/pdf/upload`            | Upload + ingest PDF into vector store |
| DELETE | `/api/rag/pdf/:source`           | Remove a PDF from vector store |
| POST   | `/api/rag/ask`                   | Ask a question over retrieved context |
| POST   | `/api/rag/index/parcel`          | Index one parcel document |
| POST   | `/api/rag/index/bulk`            | Index many parcels |
| DELETE | `/api/rag/index/parcel/:id`      | Remove one indexed parcel |

### 💬 Ask Examples

Ask a tracking question (recommended filter):

```http
POST /api/rag/ask
Content-Type: application/json

{
	"question": "Where is my parcel TRK-1042?",
	"filter": "parcel"
}
```

Ask a policy/doc question:

```http
POST /api/rag/ask
Content-Type: application/json

{
	"question": "What is the refund policy for lost parcels?",
	"filter": "pdf"
}
```

Use `"filter": "all"` to search both parcel and PDF context.
