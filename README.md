# Parcel Delivery API

NestJS + PostgreSQL backend for a parcel courier service: senders book parcels,
admins assign couriers, couriers move them through a status machine, receivers
track them. Plus a RAG assistant that answers questions over uploaded policy
PDFs and live parcel state.

**Full endpoint reference with request/response shapes:
[`API_ENDPOINTS.md`](./API_ENDPOINTS.md).** Interactive docs at `/api/docs`.

---

## 🚀 Getting started

```bash
npm install
cp example.env .env        # then fill in the values
npm run migration:run
npm run start:dev
```

The API listens on `http://localhost:${PORT}/api`, Swagger UI on `/api/docs`.

### Seeding dummy data

40 users and 200 parcels spread over the last 90 days, so lists paginate and the
dashboard trends have a real curve to draw:

```bash
SEED_DUMMY_DATA=true npm run migration:run
```

The seed migration is **inert without that flag** — migrations run on every
deploy, so the opt-in is deliberate. Every seed account uses the password
`SeedPass123!` with emails like `sender1@seed.local`, `admin1@seed.local`,
`deliverypersonnel1@seed.local`. Parcels are prefixed `TRK-SEED-`.

To remove it again: `npm run migration:revert`. The `down()` deletes only rows
carrying those markers, so it will not touch your real data.

---

## 🗂️ Project structure

Each feature is a self-contained module folder. Inside it, code is split by role
so a file's job is obvious from its path:

```
src/
├── config/                     # Shared configuration builders
│   ├── database.config.ts      # One DataSourceOptions factory, used by Nest and the CLI
│   ├── swagger.config.ts       # OpenAPI document + /api/docs mount
│   └── load-env.ts             # .env loading for processes that boot outside Nest
├── database/
│   ├── data-source.ts          # DataSource the TypeORM CLI points at
│   ├── migrations/             # Versioned schema changes
│   └── seeds/                  # Dummy-data generation (pure, unit tested)
├── common/                     # Cross-cutting building blocks
│   ├── access-control.module.ts
│   ├── decorators/             # @Roles, @CurrentUser
│   ├── dto/                    # PaginationQueryDto and friends
│   ├── guards/                 # JwtAuthGuard, RolesGuard
│   ├── constants/  types/  utils/
├── mail/                       # SMTP transport + email templates
├── <feature>/                  # user, auth, token, parcel, dashboard, audit, rag, keep-alive
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

| Module   | Owns                                                        |
|----------|-------------------------------------------------------------|
| `user`   | `users`, `auth_providers`                                    |
| `parcel` | `parcels`, `parcel_status_logs`                              |
| `auth`   | `refresh_tokens`, `password_resets`, `email_verifications`   |
| `audit`  | `audit_logs`                                                 |

Everything else asks the owning service. `DashboardService` injects no
repository at all and composes `UserService.getStats()` with
`ParcelService.getStats()`.

**No circular module imports, no `forwardRef`.** Two splits exist purely to keep
it that way, and both are worth knowing about before you add an import:

- `AccountTokensModule` — the password-reset and email-verification services
  without `AuthModule`'s controller. `AuthModule → AccessControlModule →
  UserModule`, so `UserModule` importing `AuthModule` would be a cycle.
- `AuditRecorderModule` — `AuditService` without `AuditModule`'s controller,
  for the same reason.

```
TokenModule ─┬─> UserModule ─> AccessControlModule ─┬─> AuthModule
             └────────────────────────────────────  ├─> ParcelModule ─> DashboardModule
                                                    ├─> AuditModule
                                                    └─> RagModule
```

---

## 🔐 Auth model

Five roles: `ADMIN`, `SENDER`, `RECEIVER`, `DELIVERY_PERSONNEL`, and
`PENDING_DELIVERY` — the holding state a courier signup sits in until an admin
approves it.

Access tokens last 15 minutes and are stateless. Refresh tokens last 7 days,
are stored as SHA-256 hashes in `refresh_tokens`, and **rotate**: calling
`/api/auth/refresh-token` revokes the token you sent and issues a new pair.
Logout revokes one session or all of them; changing or resetting a password ends
every session.

New accounts start with `isVerified: false` and are emailed a confirmation link.
No route requires a verified address yet — that is a one-line guard when you
want it.

---

## 🧱 Database migrations

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

For a hand-written one, `npm run migration:create -- src/database/migrations/Name`.

**Connection pooling.** Supabase's session pooler (port `5432`) allows **15
clients in total** while node-postgres defaults to 10 per instance — a dev
server plus one script exhausts it, and on Vercel every warm lambda holds its
own pool. `DB_POOL_MAX` (default 5) caps it. If you hit `EMAXCONNSESSION`
regularly, move to the transaction-mode pooler on port `6543`.

---

## ✉️ Email

`MailService` is plain SMTP via nodemailer. **Configuration is optional** —
without `SMTP_HOST` it logs what it would have sent instead of throwing, so the
password-reset flow is exercisable without credentials.

Every send is fire-and-forget: a delivery failure is logged and never fails the
write that triggered it. That is not tidiness — if `forgot-password` threw on a
mail error it would return `500` for registered addresses and `200` for unknown
ones, which is exactly the account-enumeration signal the generic response
exists to hide.

Sent on: account creation (confirm your email), a parcel booked for an
unregistered receiver (claim your account), parcel reaching `PICKED_UP` /
`OUT_FOR_DELIVERY` / `DELIVERED` / `CANCELLED`, and password reset.

> Gmail app passwords are displayed in spaced groups of four and rejected unless
> the spaces are stripped — `MailService` strips them, so paste as shown. Gmail
> caps around 500 recipients/day; for production use a transactional provider
> (Resend, Brevo, Postmark). They all speak SMTP, so it is an env change only.

---

## 💰 Pricing

`deliveryFee` is computed server-side from `weightKg` and `codAmount` — the
client sends a weight, never a price. Defaults: 60 base covering the first
kilogram, 25 per additional kilogram rounded up, plus 1% of any cash-on-delivery
amount, with a 60 minimum. Every rate is env-tunable (`PRICING_*`).

Money columns are `numeric(10,2)`, not floating point.

---

## 🤖 RAG

Q&A over uploaded PDFs and live parcel state, using Pinecone for vectors,
HuggingFace for embeddings and Groq for completions.

Parcels are re-indexed automatically on create, status change, cancellation,
delivery confirmation, assignment and block — `ParcelService` calls
`RagService.indexParcel()` directly.

`POST /api/rag/ask` returns a complete answer; `POST /api/rag/ask/stream`
returns the same thing as server-sent events, sources first, then tokens.

Index-mutating routes are admin-only. `ask` requires any signed-in user, because
each call bills an embedding and a completion.

> Groq retires models with little notice — it dropped `llama-3.1-8b-instant`
> mid-project. Set `GROQ_MODEL` to change it without touching code; check
> <https://console.groq.com/docs/models> when answers start failing with
> `model_not_found`.

---

## 🧪 Tests

```bash
npm test              # unit tests
npm run test:api      # e2e against in-memory SQLite (no live database)
```

---

## ☁️ Deployment

Vercel, configured by `vercel.json`, which builds `src/main.ts` with
`@vercel/node`. Two consequences worth knowing:

- **`nest build` does not run there**, so the Swagger CLI plugin never applies.
  Schemas come from explicit `@ApiProperty()` decorators, which work in both
  paths. Do not switch to the plugin.
- **WebSockets cannot work on serverless functions.** For realtime, use Supabase
  Realtime (the client connects directly) or move the API to a host with
  persistent processes.

A daily cron hits `/api/keep-alive` so Supabase does not pause the project. It
authenticates with `CRON_SECRET`, not a user JWT.

---

## 🖥️ Frontend

The Next.js client lives in [`percel-client/`](./percel-client/).

```bash
cd percel-client && npm install && npm run dev
```

```env
NEXT_PUBLIC_API_BASE_URL=http://localhost:3000/api
```

Client runs on **http://localhost:3001**, API on **http://localhost:3000**.
Set `FRONTEND_URL` on the API so emailed reset and confirmation links point at
the client — it needs routes at `/reset-password` and `/verify-email` that read
`?token=`.
