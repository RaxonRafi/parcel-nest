# API Endpoints

All routes are prefixed with `/api` (set in `src/main.ts`).
Interactive docs: `/api/docs` — Swagger UI, with an Authorize button for the bearer token.

**Role column**

| Value | Meaning |
| --- | --- |
| `Public` | No token needed |
| `Any` | Any signed-in user, role irrelevant |
| `ADMIN` / `SENDER` / `RECEIVER` / `DELIVERY_PERSONNEL` | Token must carry that role — anything else gets `403` |

Protected calls need `Authorization: Bearer <accessToken>`, where `accessToken`
comes from `POST /api/auth/login`.

Response shapes below were captured from live responses, not from the type
definitions — where the two disagree, this file follows what the API actually
sends.

---

## Lists are paginated

**Breaking change.** Every list endpoint used to return a bare array. They now
return `{ data, meta }`:

```ts
type Paginated<T> = {
  data: T[];
  meta: { page, limit, total, totalPages, hasNext, hasPrev };
};
```

Query params, on every list route: `page` (default 1) and `limit` (default 20,
**max 100**). Unknown query params are rejected with a `400`, same as body
fields.

Parcel lists also accept `status`, `search` (partial, case-insensitive, matches
tracking id / sender name / receiver name), `from` and `to` (ISO dates on
`createdAt`), and — for admins — `isBlocked` and `unassigned`.

User lists also accept `role`, `isActive` and `search` (matches name or email).

---

## Shared shapes

Referenced throughout so the tables stay readable.

### `User`

Returned by every `/api/users` route and nested inside parcels. The password
hash is never included on either.

```ts
type User = {
  id: string;                // uuid
  name: string;
  email: string;
  role: 'ADMIN' | 'SENDER' | 'RECEIVER' | 'DELIVERY_PERSONNEL' | 'PENDING_DELIVERY';
  phone: string | null;
  picture: string | null;
  address: string | null;
  isDeleted: boolean;
  isActive: 'ACTIVE' | 'INACTIVE' | 'BLOCKED';
  isVerified: boolean;
  nidNumber: string | null;
  nidImage: string[];
  auths: { id: string; provider: 'google' | 'credentials'; providerId: string }[];
  createdAt: string;         // ISO date
  updatedAt: string;
};
```

### `Parcel`

```ts
type Parcel = {
  id: string;                // uuid
  trackingId: string;        // the public code, e.g. "TRK-20260828-A1B2C3"
  senderName: string;
  receiverName: string;
  senderPhone: string | null;
  receiverPhone: string | null;
  pickupAddress: string;
  deliveryAddress: string;
  description: string | null;
  status: 'PENDING' | 'PICKED_UP' | 'IN_TRANSIT' | 'OUT_FOR_DELIVERY' | 'DELIVERED' | 'CANCELLED';
  isBlocked: boolean;
  weightKg: number;               // kilograms
  deliveryFee: number;            // computed server-side, never sent by the client
  codAmount: number;              // cash to collect; 0 means prepaid
  isCodCollected: boolean;
  deliveryProofImages: string[];
  deliveryProofNote: string | null;
  receivedBy: string | null;      // who actually took it
  deliveredAt: string | null;
  sender: User;
  receiver: User;
  deliveryPersonnel: User | null;   // assigned courier, null until assigned
  statusLogs: {
    id: string;
    status: ParcelStatus;
    note: string | null;
    changedBy: User | null;  // null if the author was deleted
    createdAt: string;
  }[];
  createdAt: string;
  updatedAt: string;
};
```

### `PublicParcel`

Returned **only** by the public tracking route. Built as an allow-list, so it
carries no nested user records at all — no `sender`, `receiver`,
`deliveryPersonnel` or `statusLogs[].changedBy`, and no internal `id` or phone
numbers. Every authenticated parcel route still returns the full `Parcel`.

```ts
type PublicParcel = {
  trackingId: string;
  status: ParcelStatus;
  isBlocked: boolean;
  senderName: string;
  receiverName: string;
  pickupAddress: string;
  deliveryAddress: string;
  description: string | null;
  deliveryPersonnelName: string | null;  // courier first name, null if unassigned
  statusLogs: { status: ParcelStatus; note: string | null; createdAt: string }[];
  createdAt: string;
  updatedAt: string;
};
```

### `AuthResponse`

```ts
type AuthResponse = { user: User; accessToken: string; refreshToken: string };
```

Both tokens are JWTs carrying `{ userId, email, role }`.

---

## Auth

| Role | Method | Endpoint | Response |
| --- | --- | --- | --- |
| Public | `POST` | `/api/auth/login` | `AuthResponse` |
| Public | `POST` | `/api/auth/refresh-token` | `{ accessToken, refreshToken }` — rotated pair |
| Public | `POST` | `/api/auth/forgot-password` | `{ message: string }` |
| Public | `POST` | `/api/auth/reset-password` | `{ message: string }` |
| Public | `POST` | `/api/auth/verify-email` | `{ message: string }` |
| Public | `POST` | `/api/auth/resend-verification` | `{ message: string }` |
| Any | `POST` | `/api/auth/logout` | `{ message: string }` |
| Any | `POST` | `/api/auth/change-password` | `{ message: string }` |

**Sessions are now server-side.** Each refresh token is recorded and can be
revoked, so:

- `refresh-token` **rotates**: the token you send is revoked and a new pair
  returned. Store both from the response — reusing the old one gets a `401`.
- `logout` revokes the `refreshToken` you pass in the body, or **every** session
  for the user when the body is omitted. The access token stays valid until it
  expires (15 minutes) — that is the residual window.
- `change-password` and `reset-password` both end every session.

`forgot-password` always returns the same message whether or not the address has
an account, so it cannot be used to discover who is registered. The emailed
token is single-use and expires after 30 minutes.

## Users

| Role | Method | Endpoint | Response |
| --- | --- | --- | --- |
| Public | `POST` | `/api/users/register` | `AuthResponse` |
| Any | `GET` | `/api/users/me` | `User` |
| Any | `PATCH` | `/api/users/update-profile` | `User` |
| ADMIN | `GET` | `/api/users/all-users` | `Paginated<User>` |
| ADMIN | `GET` | `/api/users/:id` | `User` |
| ADMIN | `PATCH` | `/api/users/:userId/block` | `User` — `isActive: "BLOCKED"` |
| ADMIN | `PATCH` | `/api/users/:userId/unblock` | `User` — `isActive: "ACTIVE"` |
| ADMIN | `GET` | `/api/users/delivery/pending` | `Paginated<User>` — courier applicants |
| ADMIN | `GET` | `/api/users/delivery` | `Paginated<User>` — approved couriers |
| ADMIN | `PATCH` | `/api/users/:userId/delivery/approve` | `User` — `role: "DELIVERY_PERSONNEL"` |
| ADMIN | `PATCH` | `/api/users/:userId/delivery/reject` | `User` — `role: "SENDER"` |

`register` is public, but asking for `role: "ADMIN"` in the body additionally
requires an existing admin's bearer token on the request. Any other role sent
without a token is ignored and the account is created as `SENDER`.

**New accounts start unverified.** `isVerified` is now `false` on creation and
a confirmation email goes out; `POST /api/auth/verify-email` with the token
flips it. No route currently *requires* a verified address — that is a
one-line guard when you want it — but the flag now means something.

Registering with `role: "DELIVERY_PERSONNEL"` creates the account as
`PENDING_DELIVERY` instead. Those users can sign in and read `/api/users/me`,
but no role-guarded route accepts them until an admin approves. Rejecting drops
them to `SENDER` so the account stays usable and they can apply again.

## Parcels

`:trackingId` is the public tracking code, not the uuid.

| Role | Method | Endpoint | Response |
| --- | --- | --- | --- |
| Public | `GET` | `/api/parcels/:trackingId` | `PublicParcel` — trimmed, see below |
| SENDER, ADMIN | `POST` | `/api/parcels` | `Parcel` |
| SENDER | `GET` | `/api/parcels/my-parcels` | `Paginated<Parcel>` |
| SENDER | `PATCH` | `/api/parcels/:trackingId/cancel` | `Parcel` |
| RECEIVER | `GET` | `/api/parcels/incoming-parcels` | `Paginated<Parcel>` |
| RECEIVER | `GET` | `/api/parcels/delivery-history` | `Paginated<Parcel>` — by `updatedAt` desc |
| RECEIVER | `PATCH` | `/api/parcels/:trackingId/confirm` | `Parcel` |
| ADMIN | `GET` | `/api/parcels` | `Paginated<Parcel>` |
| ADMIN | `PATCH` | `/api/parcels/:trackingId/block` | `Parcel` |
| ADMIN | `PATCH` | `/api/parcels/:trackingId/assign` | `Parcel` — body `{ deliveryPersonnelId }` |
| ADMIN | `PATCH` | `/api/parcels/:trackingId/unassign` | `Parcel` |
| ADMIN, DELIVERY_PERSONNEL | `PATCH` | `/api/parcels/:trackingId/status` | `Parcel` |
| ADMIN, DELIVERY_PERSONNEL | `PATCH` | `/api/parcels/:trackingId/delivery-proof` | `Parcel` |
| DELIVERY_PERSONNEL | `GET` | `/api/parcels/assigned-parcels` | `Paginated<Parcel>` — active queue |
| DELIVERY_PERSONNEL | `GET` | `/api/parcels/completed-deliveries` | `Paginated<Parcel>` — by `updatedAt` desc |

> **Authenticated routes** return the full `Parcel`. Nested users
> (`sender`, `receiver`, `deliveryPersonnel`, `statusLogs[].changedBy`) come
> back without `password`, but do carry the rest of the record — `email`,
> `phone`, `address`, `nidNumber` — so treat these responses as holding both
> parties' contact details and keep them off any public screen.

> **The public tracking route** returns `PublicParcel` instead: status, route
> and timeline, with no user records attached. Courier names in both
> `deliveryPersonnelName` and the assignment status-log notes are reduced to a
> first name.

> **Pricing.** `deliveryFee` is calculated server-side from `weightKg` and
> `codAmount` — the client sends weight, never a price. Rates are env-tunable
> (`PRICING_BASE_FEE`, `PRICING_PER_KG_FEE`, `PRICING_INCLUDED_KG`,
> `PRICING_COD_FEE_PERCENT`, `PRICING_MINIMUM_FEE`); defaults are a 60 base fee
> covering the first kg, 25 per additional kg rounded up, plus 1% of any COD
> amount.

> **Proof of delivery.** `delivery-proof` takes `images` (1–5 URLs), optional
> `receivedBy` and `note`, and `codCollected`. It moves the parcel to
> `DELIVERED` and stamps `deliveredAt`. A parcel with `codAmount > 0` is
> refused unless `codCollected` is true. Couriers may only submit for parcels
> assigned to them.

> **Courier rules.** `assign` requires an approved, active
> `DELIVERY_PERSONNEL` and refuses blocked, delivered or cancelled parcels;
> re-assigning records a handover. On `status`, an admin may set anything, but a
> courier may only touch parcels assigned to them and only set `PICKED_UP`,
> `IN_TRANSIT`, `OUT_FOR_DELIVERY` or `DELIVERED` — anything else is `403`.
> Every assign and unassign appends a status log entry naming the courier.

> Every parcel route loads the same relation set, so `deliveryPersonnel` and
> `statusLogs[].changedBy` are populated consistently — a receiver can see who
> is carrying their parcel. Both are still nullable: `deliveryPersonnel` is
> `null` until an admin assigns someone, and `changedBy` is `null` on a log
> entry whose author has since been deleted.

### Emails sent

| Trigger | Recipient |
| --- | --- |
| Account created | Confirmation link |
| Parcel created for an unregistered receiver | Claim-your-account link (a reset grant — they have no password yet) |
| Parcel reaches `PICKED_UP`, `OUT_FOR_DELIVERY`, `DELIVERED` or `CANCELLED` | Sender and receiver |
| `forgot-password` | Reset link, 30 min, single use |

Intermediate statuses are deliberately silent. Every send is fire-and-forget:
a mail failure is logged and never fails the write that triggered it.

## Dashboard

| Role | Method | Endpoint | Response |
| --- | --- | --- | --- |
| ADMIN | `GET` | `/api/dashboard` | see below |

```ts
{
  totalUsers: number;
  activeUsers: number;
  blockedUsers: number;
  totalParcels: number;
  blockedParcels: number;
  parcelsByStatus: Record<ParcelStatus, number>;  // every status key present, zero-filled
}
```

## RAG

| Role | Method | Endpoint | Response |
| --- | --- | --- | --- |
| Any | `POST` | `/api/rag/ask` | `{ answer: string; sources: { type, source, page }[] }` |
| ADMIN | `POST` | `/api/rag/pdf/upload` | `{ message, filename, chunksIndexed }` |
| ADMIN | `DELETE` | `/api/rag/pdf/:source` | `{ message: string }` |
| ADMIN | `POST` | `/api/rag/index/parcel` | `{ message: string }` |
| ADMIN | `POST` | `/api/rag/index/bulk` | `{ message: string }` |
| ADMIN | `DELETE` | `/api/rag/index/parcel/:id` | `{ message: string }` |

`pdf/upload` is `multipart/form-data` with a `file` field (PDF only, 10 MB max)
and an optional `category`. `sources[].page` is `null` for non-PDF sources.

> Index-mutating routes are admin-only. `ask` needs any signed-in user rather
> than being public, because each call bills an embedding and a completion.

## System

| Role | Method | Endpoint | Response |
| --- | --- | --- | --- |
| Public | `GET` | `/api` | `"Hello World!"` (plain text) |
| Cron | `GET` | `/api/keep-alive` | `{ ok: true, at: string }` |

`keep-alive` is for the Vercel cron and expects
`Authorization: Bearer <CRON_SECRET>` — not a user JWT. Not for frontend use.

---

## Errors

Standard Nest error envelope on every failure:

```ts
{ statusCode: number; message: string | string[]; error?: string }
```

| Code | When |
| --- | --- |
| `400` | Failed validation, illegal parcel status transition, blocked/inactive account at login, expired reset token |
| `401` | Missing, malformed, or expired token; wrong password |
| `403` | Wrong role for the route; a courier touching a parcel that is not theirs, or setting a status couriers may not set |
| `404` | No such user or tracking id |
| `409` | Email already registered |
| `429` | Rate limit hit — 120 req/min generally, 8/min on auth routes, 20/min on AI routes |

**Request bodies are validated.** A bad payload comes back as `400` with
`message` as an array of strings, one per failed rule:

```json
{ "statusCode": 400, "message": ["A valid email address is required"], "error": "Bad Request" }
```

Unknown properties are rejected rather than ignored, so a misspelled field
fails loudly: `["property extraField should not exist"]`.

**Parcel status follows a state machine.** Legal moves are
`PENDING → PICKED_UP → IN_TRANSIT → OUT_FOR_DELIVERY → DELIVERED`, with
`IN_TRANSIT → DELIVERED` allowed for routes without a separate final leg, and
`CANCELLED` reachable from any non-final state. `DELIVERED` and `CANCELLED` are
terminal. Anything else is a `400` naming the moves that were allowed.
