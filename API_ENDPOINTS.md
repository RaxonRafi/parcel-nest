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

Every response carries an `X-Request-Id` header. Send your own in the request
and it is reused; quote it when reporting a problem.

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

`search` is literal: `%` and `_` match those characters, not "anything".

**Parcel lists carry no `statusLogs`.** A list row is the parcel and its three
users; the timeline comes from `GET /api/parcels/:trackingId/details`.

User lists also accept `role`, `isActive` and `search` (matches name or email).

---

## Shared shapes

Referenced throughout so the tables stay readable.

### `User`

Returned by every `/api/users` route and nested inside parcels. The password
hash and the sign-in lockout state are never included on either.

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
  emailNotifications: boolean;   // parcel update emails; true by default
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
  feeBreakdown: FeeBreakdown | null;  // how the fee was made up; null on older parcels
  codAmount: number;              // cash to collect; 0 means prepaid
  isCodCollected: boolean;
  deliveryProofImages: string[];
  deliveryProofNote: string | null;
  receivedBy: string | null;      // who actually took it
  deliveredAt: string | null;
  sender: User;
  receiver: User;
  deliveryPersonnel: User | null;   // assigned courier, null until assigned
  statusLogs?: {             // single-parcel responses only — absent from lists
    id: string;
    status: ParcelStatus;
    note: string | null;
    changedBy: User | null;  // null if the author was deleted
    createdAt: string;
  }[];
  createdAt: string;
  updatedAt: string;
};

type FeeBreakdown = {
  baseFee: number;     // covers the first kilogram
  weightFee: number;   // each further kilogram, rounded up
  codFee: number;      // a percentage of the cash to collect
  total: number;       // equals deliveryFee; never below the minimum fee
};
```

### `PublicParcel`

Returned **only** by the public tracking route. Built as an allow-list, so it
carries no nested user records at all — no `sender`, `receiver`,
`deliveryPersonnel` or `statusLogs[].changedBy`, and no internal `id` or phone
numbers. Every authenticated parcel route still returns the full `Parcel`.

It is also **masked**, because a tracking id is not a secret: names are a first
name and an initial, and the two addresses are reduced to their area.

```ts
type PublicParcel = {
  trackingId: string;
  status: ParcelStatus;
  isBlocked: boolean;
  senderName: string;        // "John S."
  receiverName: string;      // "Jane D."
  pickupAddress: string;     // area only: "Gulshan, Dhaka"
  deliveryAddress: string;   // area only
  description: string | null;
  deliveryPersonnelName: string | null;  // courier first name, null if unassigned
  statusLogs: { status: ParcelStatus; note: string | null; createdAt: string }[];
  createdAt: string;
  updatedAt: string;
};
```

### `AuthResponse`

```ts
type AuthResponse = { user: User; accessToken: string; refreshToken?: string };
```

Both tokens are JWTs carrying `{ userId, email, role }`. The refresh token is
also set as an `httpOnly` cookie named `refresh_token`; it is left out of the
body only when the server runs with `REFRESH_TOKEN_IN_BODY=false`.

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
| Any | `GET` | `/api/auth/sessions` | `Session[]` — your signed-in devices |
| Any | `DELETE` | `/api/auth/sessions/:id` | `{ message: string }` — sign one device out |

**Sessions are now server-side.** Each refresh token is recorded and can be
revoked, so:

- `refresh-token` **rotates**: the token you send is revoked and a new pair
  returned. Store both from the response — reusing the old one gets a `401`.
- `Authorization` must be `Bearer <accessToken>`; a bare token is rejected.
- `logout` revokes the `refreshToken` you pass in the body (only if it is the
  caller's own), or **every** session
  for the user when the body is omitted. The access token stays valid until it
  expires (15 minutes) — that is the residual window.
- `change-password` and `reset-password` both end every session.
- **Reuse is treated as theft.** If a refresh token that was already rotated
  away is presented again (more than a few seconds later), every session in
  that chain is ended and that device has to sign in again.

**The refresh token as a cookie.** `login`, `register` and `refresh-token` set
`refresh_token` as an `httpOnly` cookie (`Path=/api/auth`; `SameSite=None;
Secure` in production). A client that sends requests with credentials can call
`refresh-token` and `logout` with an empty body and let the cookie carry the
token. With the cookie in play, `logout` with no body ends *that* session; send
`{ "everywhere": true }` to end them all.

```ts
type Session = {
  id: string;
  userAgent: string | null;
  ip: string | null;
  createdAt: string;    // when this device signed in or last refreshed
  expiresAt: string;
  current: boolean;     // only known when the refresh_token cookie is sent
};
```

**Passwords** chosen at `register`, `change-password` and `reset-password` must
be at least 8 characters with an uppercase letter, a lowercase letter and a
number (at most 72 characters). Login accepts whatever the account already has.

**Lockout.** Five wrong passwords in a row lock the account for 15 minutes.
While locked, `login` answers `429` with how long is left, even for the right
password. Completing a password reset lifts the lock.

`forgot-password` always returns the same message whether or not the address has
an account, so it cannot be used to discover who is registered. The emailed
token is single-use and expires after 30 minutes. Completing a reset also
marks the address verified, since the link proved it.

Blocking a user ends all of their sessions and disconnects their sockets.

## Users

| Role | Method | Endpoint | Response |
| --- | --- | --- | --- |
| Public | `POST` | `/api/users/register` | `AuthResponse` |
| Any | `GET` | `/api/users/me` | `User` |
| Any | `PATCH` | `/api/users/update-profile` | `User` |
| Any | `DELETE` | `/api/users/me` | `{ message: string }` — body `{ password }` |
| ADMIN | `GET` | `/api/users/all-users` | `Paginated<User>` |
| ADMIN | `GET` | `/api/users/:id` | `User` |
| ADMIN | `PATCH` | `/api/users/:id` | `User` — edit name, phone, address, NID, `role`, `isVerified` |
| ADMIN | `DELETE` | `/api/users/:id` | `{ message: string }` |
| ADMIN | `PATCH` | `/api/users/:userId/block` | `User` — `isActive: "BLOCKED"` |
| ADMIN | `PATCH` | `/api/users/:userId/unblock` | `User` — `isActive: "ACTIVE"` |
| ADMIN | `GET` | `/api/users/delivery/pending` | `Paginated<User>` — courier applicants |
| ADMIN | `GET` | `/api/users/delivery` | `Paginated<User>` — approved couriers |
| ADMIN | `PATCH` | `/api/users/:userId/delivery/approve` | `User` — `role: "DELIVERY_PERSONNEL"` |
| ADMIN | `PATCH` | `/api/users/:userId/delivery/reject` | `User` — `role: "SENDER"` |

`register` is public, but asking for `role: "ADMIN"` in the body additionally
requires an existing admin's bearer token on the request. `SENDER` (the
default) and `RECEIVER` are created as asked; `DELIVERY_PERSONNEL` becomes
`PENDING_DELIVERY`, see below. A duplicate email or `nidNumber` answers `409`.

The returned `refreshToken` is a live session, exactly as after `login`.

**New accounts start unverified.** `isVerified` is now `false` on creation and
a confirmation email goes out; `POST /api/auth/verify-email` with the token
flips it. By default no route requires a verified address. With
`REQUIRE_VERIFIED_EMAIL=true` on the server, booking a parcel answers `403`
and approving a courier answers `400` until the account has confirmed it.

**Deleting an account** is a soft delete: it can no longer sign in and all of
its sessions end at once, but parcels and history that refer to it are kept
and the email stays reserved. `DELETE /api/users/me` needs the current
password. An admin cannot delete themselves through `/:id`, and nobody can
delete, demote or block the super admin. Admin edits and deletes are audited.

`update-profile` also accepts `emailNotifications: boolean` — the opt-out for
parcel update emails. Account and security emails are sent regardless.

Registering with `role: "DELIVERY_PERSONNEL"` creates the account as
`PENDING_DELIVERY` instead. Those users can sign in and read `/api/users/me`,
but no role-guarded route accepts them until an admin approves. Rejecting drops
them to `SENDER` so the account stays usable and they can apply again.

`approve` answers `400` until the applicant has both `nidNumber` and at least
one `nidImage` on their profile. Either decision is emailed to the applicant.

## Parcels

`:trackingId` is the public tracking code, not the uuid.

| Role | Method | Endpoint | Response |
| --- | --- | --- | --- |
| Public | `GET` | `/api/parcels/:trackingId` | `PublicParcel` — trimmed and masked, see below |
| Public | `POST` | `/api/parcels/quote` | `FeeBreakdown` — body `{ weightKg?, codAmount? }` |
| Any | `GET` | `/api/parcels/:trackingId/details` | `Parcel` — admin, or the parcel's sender, receiver or courier |
| SENDER, ADMIN | `POST` | `/api/parcels` | `Parcel` |
| SENDER, ADMIN | `GET` | `/api/parcels/my-parcels` | `Paginated<Parcel>` — parcels you booked |
| SENDER, ADMIN | `PATCH` | `/api/parcels/:trackingId/cancel` | `Parcel` — only a parcel you booked |
| Any | `GET` | `/api/parcels/incoming-parcels` | `Paginated<Parcel>` — addressed to you |
| Any | `GET` | `/api/parcels/delivery-history` | `Paginated<Parcel>` — by `updatedAt` desc |
| Any | `PATCH` | `/api/parcels/:trackingId/confirm` | `Parcel` — only the parcel's receiver |
| ADMIN | `GET` | `/api/parcels` | `Paginated<Parcel>` |
| ADMIN | `PATCH` | `/api/parcels/:trackingId/block` | `Parcel` |
| ADMIN | `PATCH` | `/api/parcels/:trackingId/unblock` | `Parcel` |
| ADMIN | `PATCH` | `/api/parcels/:trackingId/assign` | `Parcel` — body `{ deliveryPersonnelId }` |
| ADMIN | `PATCH` | `/api/parcels/:trackingId/unassign` | `Parcel` |
| ADMIN | `POST` | `/api/parcels/reindex` | `{ message: string; indexed: number; removed: number }` — rebuilds the assistant index, see [RAG](#rag) |
| ADMIN, DELIVERY_PERSONNEL | `PATCH` | `/api/parcels/:trackingId/status` | `Parcel` |
| ADMIN, DELIVERY_PERSONNEL | `PATCH` | `/api/parcels/:trackingId/delivery-proof` | `Parcel` |
| DELIVERY_PERSONNEL | `GET` | `/api/parcels/assigned-parcels` | `Paginated<Parcel>` — active queue |
| DELIVERY_PERSONNEL | `GET` | `/api/parcels/completed-deliveries` | `Paginated<Parcel>` — by `updatedAt` desc |

> **Receiver routes are scoped by who the parcel is addressed to, not by
> role.** A parcel can be addressed to a sender or courier account, so
> `incoming-parcels`, `delivery-history` and `confirm` accept any signed-in
> user and answer only for parcels whose receiver is the caller.

> **Becoming `DELIVERED`.** Three routes can close a parcel — `status`,
> `confirm` and `delivery-proof` — and all three stamp `deliveredAt`. A
> parcel with `codAmount > 0` is refused by `status` and `confirm` (`400`)
> until `delivery-proof` has recorded `codCollected: true`.

> **Blocked parcels are frozen.** `status`, `assign`, `cancel`, `confirm`
> and `delivery-proof` all answer `400 Parcel is blocked` until an admin
> calls `unblock`.

> **Cancelling.** `cancel` is for whoever booked the parcel — its sender, or
> an admin for a parcel they booked themselves — and works only while it is
> `PENDING`. After pickup, and for anyone else's parcel, an admin cancels it
> through `status`.

> **Opening one parcel.** `details` returns the full `Parcel` with its
> `statusLogs` and `feeBreakdown` to an admin or to one of its three parties,
> and `403` to anyone else. It is the only route that returns a timeline to a
> signed-in user; lists do not.

> **Quoting.** `quote` runs the booking calculation without booking anything,
> so a form can show the price as the weight is typed. Same bounds as booking:
> `weightKg` 0.01–1000 (default 1), `codAmount` ≥ 0 (default 0).

> **Authenticated routes** return the full `Parcel`. Nested users
> (`sender`, `receiver`, `deliveryPersonnel`, `statusLogs[].changedBy`) come
> back without `password`, but do carry the rest of the record — `email`,
> `phone`, `address`, `nidNumber` — so treat these responses as holding both
> parties' contact details and keep them off any public screen.

> **The public tracking route** returns `PublicParcel` instead: status, route
> and timeline, with no user records attached. Courier names in both
> `deliveryPersonnelName` and the assignment status-log notes are reduced to a
> first name; sender and receiver names to a first name and an initial; the
> addresses to their area; and a "Delivered to …" note to "Delivered".

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
> **Nobody can set `PICKED_UP` until a courier is assigned** — `400`.

> `deliveryPersonnel` is on every parcel response, so a receiver can see who is
> carrying their parcel; it is `null` until an admin assigns someone.
> `statusLogs[].changedBy` is `null` on an entry whose author has since been
> deleted.

> **Responses do not wait for side effects.** Re-indexing the parcel for the
> assistant, storing and pushing notifications, and sending email all run
> after the response has gone out.

### Emails sent

| Trigger | Recipient |
| --- | --- |
| Account created | Confirmation link |
| Parcel created for an unregistered receiver | Claim-your-account link (a reset grant, valid 7 days — they have no password yet) |
| Parcel reaches `PICKED_UP`, `OUT_FOR_DELIVERY`, `DELIVERED` or `CANCELLED` | Sender and receiver, unless they set `emailNotifications: false` |
| `forgot-password` | Reset link, 30 min, single use |
| Courier application approved or rejected | The applicant |
| Contact form | Support inbox, with the visitor as reply-to |

Intermediate statuses are deliberately silent. Every send is queued behind the
response: a mail failure is logged and never fails, or slows, the write that
triggered it.

## Dashboard

| Role | Method | Endpoint | Response |
| --- | --- | --- | --- |
| ADMIN | `GET` | `/api/dashboard` | counts, see below |
| ADMIN | `GET` | `/api/dashboard/trends` | volume, timing and throughput |

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

`GET /api/dashboard/trends?days=30` (1–365, default 30) adds everything the
counts cannot tell you — direction, timing, who is carrying the load:

```ts
{
  rangeDays: number;
  daily: { date: string; created: number; delivered: number }[];   // zero-filled, one row per day
  statusTimings: { status: ParcelStatus; averageHours: number | null; sampleSize: number }[];
  courierThroughput: {
    courierId: string; courierName: string;
    active: number; delivered: number;
    averageDeliveryHours: number | null;
  }[];
  revenue: {
    deliveryFeesBooked: number;      // everything not cancelled
    deliveryFeesDelivered: number;   // actually earned
    codOutstanding: number;          // cash still to collect
    codCollected: number;
  };
  averageFulfilmentHours: number | null;   // creation → delivery
}
```

`statusTimings` measures *completed* dwell time, computed from consecutive
status-log entries — a parcel currently sitting in a status has no next entry
yet and is excluded, so a status with `sampleSize: 0` means nothing has left it,
not that it is instant.

## Audit

| Role | Method | Endpoint | Response |
| --- | --- | --- | --- |
| ADMIN | `GET` | `/api/audit-logs` | `Paginated<AuditLog>` |
| ADMIN | `GET` | `/api/audit-logs/target/:targetId` | `Paginated<AuditLog>` |

```ts
type AuditLog = {
  id: string;
  actorEmail: string | null;   // null once the acting account is deleted
  action: 'USER_BLOCKED' | 'USER_UNBLOCKED' | 'USER_UPDATED' | 'USER_DELETED'
        | 'DELIVERY_APPROVED' | 'DELIVERY_REJECTED'
        | 'PARCEL_CREATED' | 'PARCEL_CANCELLED' | 'PARCEL_DELIVERY_CONFIRMED'
        | 'PARCEL_PROOF_SUBMITTED' | 'PARCEL_STATUS_CHANGED'
        | 'PARCEL_BLOCKED' | 'PARCEL_UNBLOCKED' | 'PARCEL_ASSIGNED' | 'PARCEL_UNASSIGNED';
  targetType: 'USER' | 'PARCEL';
  targetId: string;            // user uuid, or parcel tracking id
  summary: string | null;      // readable without a join
  metadata: Record<string, unknown> | null;   // usually { from, to }
  createdAt: string;
};
```

Filters: `action`, `targetType`, `targetId`. The `target/:targetId` route is the
full history of one user or parcel, newest first.

The trail is no longer admin actions only: a sender booking or cancelling, a
receiver confirming and a courier submitting proof are recorded too, so a
parcel's history shows everyone who touched it.

> Writes are best-effort by design: if the audit insert fails it is logged
> loudly and the audited action still succeeds. A missing log line is bad; a
> block that silently failed because logging was down is worse.

## RAG

| Role | Method | Endpoint | Response |
| --- | --- | --- | --- |
| Any | `POST` | `/api/rag/ask` | `{ answer: string; sources: { type, source, page }[] }` |
| Any | `POST` | `/api/rag/ask/stream` | `text/event-stream`, see below |
| ADMIN | `POST` | `/api/rag/pdf/upload` | `{ message, filename, chunksIndexed }` |
| ADMIN | `DELETE` | `/api/rag/pdf/:source` | `{ message: string }` |
| ADMIN | `POST` | `/api/rag/index/parcel` | `{ message: string }` |
| ADMIN | `POST` | `/api/rag/index/bulk` | `{ message: string }` |
| ADMIN | `DELETE` | `/api/rag/index/parcel/:id` | `{ message: string }` |

`pdf/upload` is `multipart/form-data` with a `file` field (PDF only, 10 MB max)
and an optional `category`. The file's own first bytes are checked, so a
renamed non-PDF is a `400`. `sources[].page` is `null` for non-PDF sources.

`ask` and `ask/stream` take `{ question, filter?, history? }`. `history` is the
conversation so far, oldest first and without the new question — up to 10
`{ role: 'user' | 'assistant', content }` turns. The server keeps no chat
state, so a follow-up ("and when will it arrive?") only works if the client
sends it.

When nothing relevant is found, the answer is `"I don't have that
information."` with an empty `sources` list, and no completion is billed.

`ask/stream` takes the same body and returns server-sent events. Sources arrive
first so attribution can render before the prose finishes:

```
data: {"type":"sources","sources":[{"type":"pdf","source":"policy.pdf","page":4}]}

data: {"type":"token","token":"Your"}

data: {"type":"token","token":" parcel"}

data: {"type":"done"}
```

Exactly one `done` or `{"type":"error","message":string}` terminates the stream.
Errors arrive as events rather than an HTTP status, because the headers have
already been sent by then. Closing the connection stops token generation.

> Index-mutating routes are admin-only. `ask` and `ask/stream` need any
> signed-in user rather than being public, because each call bills an
> embedding and a completion.

> **Answers are scoped to the caller.** Policy PDFs are searchable by everyone.
> Parcels are only retrieved for an admin, or for the parcel's sender, receiver
> or courier. `index/parcel` and `index/bulk` accept optional `senderId`,
> `receiverId` and `courierId`; a parcel indexed without them is visible to
> admins alone.

> **Rebuilding the index.** `POST /api/parcels/reindex` (admin, no body)
> re-indexes every parcel from the database with its owner ids, 50 per
> embedding call, then removes vectors whose parcel no longer exists
> (`removed`). It is safe to repeat. It answers `503` when the assistant is
> switched off, and fails if the embedding provider refuses the request.

> Without `PINECONE_API_KEY`, `PINECONE_INDEX`, `HUGGINGFACE_API_KEY` and
> `GROQ_API_KEY` the assistant is switched off: both ask routes answer `503`
> and the rest of the API runs normally.

## Notifications

| Role | Method | Endpoint | Response |
| --- | --- | --- | --- |
| Any | `GET` | `/api/notifications` | `Paginated<Notification>` — yours, newest first |
| Any | `GET` | `/api/notifications/unread-count` | `{ unread: number }` |
| Any | `PATCH` | `/api/notifications/:id/read` | `{ message: string }` |
| Any | `PATCH` | `/api/notifications/read-all` | `{ message: string }` |

```ts
type Notification = {
  id: string;
  type: 'parcel.created' | 'parcel.status' | 'parcel.assigned'
      | 'parcel.unassigned' | 'parcel.blocked' | 'parcel.unblocked';
  title: string;
  message: string;
  trackingId: string | null;
  status: ParcelStatus | null;
  readAt: string | null;
  createdAt: string;
};
```

Every parcel event is stored for each person it concerns — the parcel's
sender, receiver and courier, and every admin, minus whoever made the change —
and kept for 90 days. `?unread=true` narrows the list.

The live `notification` socket event carries the same `id`, `type`, `title`,
`message`, `trackingId`, `status` and `createdAt`, so a pushed item can be
marked read, and a client that was offline — or is talking to a host with no
sockets, such as Vercel — gets the same items from this list.

## Contact

| Access | Method | Path | Returns |
|---|---|---|---|
| Public | `POST` | `/api/contact` | `{ message: string }` |
| ADMIN | `GET` | `/api/contact/messages` | `Paginated<ContactMessage>` — newest first |

Body: `{ name, email, topic, trackingId?, message, website? }`, where `topic`
is one of `sending`, `tracking`, `courier`, `other`. The message is stored and
emailed to `SUPPORT_EMAIL` with the visitor as the reply-to address. Limited to
5 requests a minute.

`website` is a honeypot: render it as a field people cannot see and leave it
empty. A submission that fills it in gets the usual success response and is
discarded.

```ts
type ContactMessage = {
  id: string; name: string; email: string; topic: string;
  trackingId: string | null; message: string; createdAt: string;
};
```

## System

| Role | Method | Endpoint | Response |
| --- | --- | --- | --- |
| Public | `GET` | `/api` | `"Hello World!"` (plain text) — liveness only |
| Public | `GET` | `/api/health` | `Health` — `200` when the database answers, `503` when it does not |
| Cron | `GET` | `/api/keep-alive` | `{ ok: true, at: string, pruned: number }` — also deletes expired tokens and old notifications |

```ts
type Health = {
  status: 'ok' | 'degraded';
  uptime: number;            // seconds
  database: 'up' | 'down';
  assistant: boolean;        // AI provider keys configured
  mail: boolean;             // SMTP configured
  realtime: boolean;         // false on a serverless host — do not open a socket
};
```

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
| `400` | Failed validation, weak password, illegal parcel status transition, blocked parcel, pickup with no courier, uncollected cash on delivery, expired reset token, courier application without an ID |
| `401` | Missing, malformed, or expired token; wrong password; blocked or deleted account (login, refresh and every guarded route) |
| `403` | Wrong role for the route; a parcel that is not yours; a status couriers may not set; changing your own role; touching the super admin; unconfirmed email when the server requires one |
| `404` | No such user, tracking id, session or notification |
| `409` | Email or national id already in use |
| `429` | Rate limit: 120/min per route by default, 8/min on credential routes, 20/min on the assistant. Also `login` on an account locked after five wrong passwords |
| `500` | Something unexpected. The body is `{ statusCode, message: "Internal server error", requestId }` — the same id as the `X-Request-Id` header |
| `503` | Assistant not configured; or `/api/health` when the database is down |

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
