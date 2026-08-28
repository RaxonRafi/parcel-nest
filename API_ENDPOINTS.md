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
| Public | `POST` | `/api/auth/refresh-token` | `{ accessToken: string }` |
| Any | `POST` | `/api/auth/logout` | `{ message: "Logged out successfully" }` |
| Any | `POST` | `/api/auth/change-password` | `{ message: "Password changed successfully" }` |

`logout` is stateless — it returns a message and nothing else. Clearing the
stored token is the frontend's job; the old token stays valid until it expires.

## Users

| Role | Method | Endpoint | Response |
| --- | --- | --- | --- |
| Public | `POST` | `/api/users/register` | `AuthResponse` |
| Any | `GET` | `/api/users/me` | `User` |
| Any | `PATCH` | `/api/users/update-profile` | `User` |
| ADMIN | `GET` | `/api/users/all-users` | `User[]` — newest first |
| ADMIN | `GET` | `/api/users/:id` | `User` |
| ADMIN | `PATCH` | `/api/users/:userId/block` | `User` — `isActive: "BLOCKED"` |
| ADMIN | `PATCH` | `/api/users/:userId/unblock` | `User` — `isActive: "ACTIVE"` |
| ADMIN | `GET` | `/api/users/delivery/pending` | `User[]` — courier applicants |
| ADMIN | `GET` | `/api/users/delivery` | `User[]` — approved couriers |
| ADMIN | `PATCH` | `/api/users/:userId/delivery/approve` | `User` — `role: "DELIVERY_PERSONNEL"` |
| ADMIN | `PATCH` | `/api/users/:userId/delivery/reject` | `User` — `role: "SENDER"` |

`register` is public, but asking for `role: "ADMIN"` in the body additionally
requires an existing admin's bearer token on the request. Any other role sent
without a token is ignored and the account is created as `SENDER`.

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
| SENDER | `GET` | `/api/parcels/my-parcels` | `Parcel[]` — newest first |
| SENDER | `PATCH` | `/api/parcels/:trackingId/cancel` | `Parcel` |
| RECEIVER | `GET` | `/api/parcels/incoming-parcels` | `Parcel[]` — newest first |
| RECEIVER | `GET` | `/api/parcels/delivery-history` | `Parcel[]` — by `updatedAt` desc |
| RECEIVER | `PATCH` | `/api/parcels/:trackingId/confirm` | `Parcel` |
| ADMIN | `GET` | `/api/parcels` | `Parcel[]` — newest first |
| ADMIN | `PATCH` | `/api/parcels/:trackingId/block` | `Parcel` |
| ADMIN | `PATCH` | `/api/parcels/:trackingId/assign` | `Parcel` — body `{ deliveryPersonnelId }` |
| ADMIN | `PATCH` | `/api/parcels/:trackingId/unassign` | `Parcel` |
| ADMIN, DELIVERY_PERSONNEL | `PATCH` | `/api/parcels/:trackingId/status` | `Parcel` |
| DELIVERY_PERSONNEL | `GET` | `/api/parcels/assigned-parcels` | `Parcel[]` — active queue |
| DELIVERY_PERSONNEL | `GET` | `/api/parcels/completed-deliveries` | `Parcel[]` — by `updatedAt` desc |

> **Authenticated routes** return the full `Parcel`. Nested users
> (`sender`, `receiver`, `deliveryPersonnel`, `statusLogs[].changedBy`) come
> back without `password`, but do carry the rest of the record — `email`,
> `phone`, `address`, `nidNumber` — so treat these responses as holding both
> parties' contact details and keep them off any public screen.

> **The public tracking route** returns `PublicParcel` instead: status, route
> and timeline, with no user records attached. Courier names in both
> `deliveryPersonnelName` and the assignment status-log notes are reduced to a
> first name.

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
| Public | `POST` | `/api/rag/ask` | `{ answer: string; sources: { type, source, page }[] }` |
| Public | `POST` | `/api/rag/pdf/upload` | `{ message, filename, chunksIndexed }` |
| Public | `DELETE` | `/api/rag/pdf/:source` | `{ message: string }` |
| Public | `POST` | `/api/rag/index/parcel` | `{ message: string }` |
| Public | `POST` | `/api/rag/index/bulk` | `{ message: string }` |
| Public | `DELETE` | `/api/rag/index/parcel/:id` | `{ message: string }` |

`pdf/upload` is `multipart/form-data` with a `file` field (PDF only, 10 MB max)
and an optional `category`. `sources[].page` is `null` for non-PDF sources.

> These carry no guards at all today — including the two `DELETE` routes that
> drop documents from the vector store. Worth locking down before the frontend
> ships.

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
| `400` | Bad input, illegal parcel status transition, blocked/inactive account at login |
| `401` | Missing, malformed, or expired token; wrong password |
| `403` | Wrong role for the route; a courier touching a parcel that is not theirs, or setting a status couriers may not set |
| `404` | No such user or tracking id |
| `409` | Email already registered |

There is no request validation layer yet, so malformed bodies generally surface
as `500`s from the database rather than a clean `400`.
