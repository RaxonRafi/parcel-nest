# Frontend guide: what changed in the API

For the Next.js client. Covers the backend bug-fix pass of 2026-10-10 (branch
`fix/review-bugs`). Full request and response shapes are in
[`API_ENDPOINTS.md`](./API_ENDPOINTS.md); this file is only the delta and what
the client has to do about it.

Sections are ordered by how likely they are to break something that works today.

- [1. Checklist](#1-checklist)
- [2. Auth and sessions](#2-auth-and-sessions)
- [3. Registration](#3-registration)
- [4. Parcels](#4-parcels)
- [5. Receiver screens](#5-receiver-screens)
- [6. Admin screens](#6-admin-screens)
- [7. Assistant](#7-assistant)
- [8. Realtime](#8-realtime)
- [9. Errors and rate limits](#9-errors-and-rate-limits)
- [10. Backend steps before the client ships](#10-backend-steps-before-the-client-ships)

---

## 1. Checklist

Must change, or something breaks:

- [ ] Send `Authorization: Bearer <token>` on every authenticated request. A
      bare token is now rejected with `401`. ([2](#2-auth-and-sessions))
- [ ] Treat `401` from **login** and **refresh** as "blocked or deleted
      account" as well as "bad credentials". These used to be `400`.
      ([2](#2-auth-and-sessions))
- [ ] Send the token on `POST /api/rag/ask`. It was accidentally public and is
      now guarded like `ask/stream`. ([7](#7-assistant))
- [ ] Hide the sender's Cancel button once a parcel leaves `PENDING`.
      ([4](#4-parcels))
- [ ] Handle `400` on "mark delivered" and "confirm delivery" for
      cash-on-delivery parcels. ([4](#4-parcels))
- [ ] Do not validate tracking ids against the old pattern. ([4](#4-parcels))

Should change, to use what is now possible:

- [ ] Add the role picker to the signup form. ([3](#3-registration))
- [ ] Show "Incoming" and "Delivery history" to every role, not only
      `RECEIVER`. ([5](#5-receiver-screens))
- [ ] Add an Unblock action for parcels. ([6](#6-admin-screens))
- [ ] Handle the socket being closed by the server. ([8](#8-realtime))
- [ ] Handle `409`, `429` and `503`. ([9](#9-errors-and-rate-limits))

Can delete:

- [ ] Any workaround that sent a dummy `Authorization` header on signup to get
      a non-sender role.
- [ ] Any "log in again right after registering" step added because the
      refresh token from signup did not work.
- [ ] Client-side throttling or retry added because ordinary pages were
      hitting `429` after 8 requests.

---

## 2. Auth and sessions

### The `Bearer` prefix is required

```ts
// before: both worked
headers: { Authorization: accessToken }
headers: { Authorization: `Bearer ${accessToken}` }

// now: only this
headers: { Authorization: `Bearer ${accessToken}` }
```

The Socket.IO handshake is unchanged. It still takes the raw token:
`io(url, { auth: { token: accessToken } })`.

### Blocked and deleted accounts answer `401` everywhere

| Route | Before | Now |
| --- | --- | --- |
| `POST /api/auth/login` (blocked/deleted account) | `400` | `401` |
| `POST /api/auth/refresh-token` (blocked/deleted, or user gone) | `400` | `401` |
| Any guarded route | `401` | `401` |

The message tells the two cases apart: `Invalid email or password` versus
`User is BLOCKED` / `User is deleted`. Show the message from the body instead
of a hardcoded "wrong password".

```ts
if (res.status === 401) {
  const { message } = await res.json();
  setError(message); // "Invalid email or password" | "User is BLOCKED" | ...
}
```

### Refresh tokens are single-use, strictly

Rotation already existed; two gaps are closed:

- If two requests refresh with the same token at once, exactly one succeeds
  and the other gets `401`. Make sure the client refreshes through **one
  shared promise**, or parallel requests after expiry will log the user out.
- Two refresh tokens issued in the same second used to be identical strings.
  They are now always different, so always store the pair from the response.

```ts
let refreshing: Promise<TokenPair> | null = null;

export function refreshTokens(): Promise<TokenPair> {
  refreshing ??= api
    .post('/auth/refresh-token', { refreshToken: getRefreshToken() })
    .then((pair) => {
      storeTokens(pair); // both tokens, every time
      return pair;
    })
    .finally(() => {
      refreshing = null;
    });

  return refreshing;
}
```

### Logout

`POST /api/auth/logout` with `{ refreshToken }` now only ends that session if
the token belongs to the caller. Nothing to change if you send the user's own
token. Sending no body still signs out every device.

### Being blocked

When an admin blocks a user, all of that user's sessions end immediately:
refresh fails with `401` and open sockets are closed (see
[8](#8-realtime)). The access token is refused on the next request. Route any
`401` that survives one refresh attempt to the login screen.

### Password reset and account claim

- Completing `reset-password` now also sets `isVerified: true`. After a reset
  you can stop showing a "verify your email" banner without another call.
- The "claim your account" link sent to a receiver who was booked a parcel
  before registering is valid for **7 days** (was 30 minutes). It still lands
  on `/reset-password?token=…`. If that page mentions a 30-minute limit, make
  the wording generic. Ordinary reset links are still 30 minutes.

---

## 3. Registration

`POST /api/users/register`

### The refresh token from signup works

It used to be rejected on first use, which signed a new user out after 15
minutes. It is now a normal session. Store both tokens and continue exactly as
after login.

### `role` is honoured without a token

Before, `role` was ignored unless an `Authorization` header was present (any
header, even a meaningless one). Now:

| `role` sent | Token needed | Account created as |
| --- | --- | --- |
| omitted or `SENDER` | no | `SENDER` |
| `RECEIVER` | no | `RECEIVER` |
| `DELIVERY_PERSONNEL` | no | `PENDING_DELIVERY` until an admin approves |
| `ADMIN` | admin's `Bearer` token | `ADMIN`; `401` otherwise |

So the signup form can offer a choice:

```ts
await api.post('/users/register', {
  name,
  email,
  password,
  role, // 'SENDER' | 'RECEIVER' | 'DELIVERY_PERSONNEL'
});
```

A courier applicant gets back `user.role === 'PENDING_DELIVERY'`. They can sign
in and read `/users/me`, but no role-guarded route accepts them yet, so send
them to a "your application is being reviewed" screen instead of a dashboard.

### Duplicates answer `409`

A duplicate email already did. A duplicate `nidNumber` (on register **and** on
`PATCH /api/users/update-profile`) used to be a `500` and is now:

```json
{ "statusCode": 409, "message": "That nidNumber is already in use", "error": "Conflict" }
```

---

## 4. Parcels

### Tracking id format

New parcels get `TRK-` plus 12 characters from `0-9 A-Z` without `I L O U`,
for example `TRK-7K2M9QX4T1VB`. Older parcels keep their old, longer ids, and
both stay valid. If you validate the tracking input, use something loose:

```ts
const looksLikeTrackingId = /^TRK-[0-9A-Z-]{6,40}$/i.test(value.trim());
```

### Creating a parcel

Two new `400`s on `POST /api/parcels`:

| Message | When |
| --- | --- |
| `You cannot send a parcel to yourself` | `receiverId` or `receiverEmail` is the sender's own |
| `That receiver account is not available — use a different receiver` | the receiver account is blocked or deleted |

### Cancelling (sender)

`PATCH /api/parcels/:trackingId/cancel` now only works while the parcel is
`PENDING`. After pickup it answers `400`:

```
This parcel has already been picked up — contact support to cancel it
```

```tsx
{parcel.status === 'PENDING' && !parcel.isBlocked && (
  <CancelButton trackingId={parcel.trackingId} />
)}
```

An admin can still cancel later through `PATCH :trackingId/status` with
`{ status: 'CANCELLED' }`.

### Delivering, and cash on delivery

All three ways of closing a parcel now behave the same: they set
`status: 'DELIVERED'` and stamp `deliveredAt`.

| Route | Who | Cash-on-delivery parcel (`codAmount > 0`) |
| --- | --- | --- |
| `PATCH :trackingId/delivery-proof` | courier, admin | Requires `codCollected: true`, otherwise `400` |
| `PATCH :trackingId/status` → `DELIVERED` | courier, admin | `400` until cash is recorded through delivery-proof |
| `PATCH :trackingId/confirm` | the receiver | `400` until cash is recorded through delivery-proof |

For the courier app this means a COD parcel must be closed through the proof
screen, not the status dropdown:

```tsx
const needsProof = parcel.codAmount > 0 && !parcel.isCodCollected;

// status dropdown
<option value="DELIVERED" disabled={needsProof}>
  Delivered{needsProof ? ' (submit proof to collect cash)' : ''}
</option>
```

For the receiver, hide or disable "Confirm delivery" under the same condition
and explain that the courier records the handover.

`deliveredAt` is now set on every parcel delivered from here on. Parcels
delivered earlier through the status or confirm routes are filled in by the
`BackfillDeliveredAt` migration (see
[10](#10-backend-steps-before-the-client-ships)); once that has run, any
`deliveredAt ?? updatedAt` fallback in the client can go.

Submitting proof for a parcel that is already delivered still works: it
attaches the images and keeps the original `deliveredAt`.

### Blocked parcels

A blocked parcel (`isBlocked: true`) now refuses **every** change with
`400 Parcel is blocked`: status, assign, cancel, confirm and delivery-proof.
Before, cancel, confirm and proof slipped through. Disable those actions in
the UI when `isBlocked` is true and show an "on hold" badge. The public
tracking response already carries `isBlocked`.

---

## 5. Receiver screens

These three routes used to require the `RECEIVER` role. They now accept **any
signed-in user** and are scoped by who the parcel is addressed to:

| Route | Returns |
| --- | --- |
| `GET /api/parcels/incoming-parcels` | open parcels addressed to the caller |
| `GET /api/parcels/delivery-history` | delivered parcels addressed to the caller |
| `PATCH /api/parcels/:trackingId/confirm` | confirms a parcel addressed to the caller; `403` otherwise |

The reason: a sender can book a parcel to an email that already belongs to
another sender or a courier. That person was the receiver but could not see or
confirm the parcel.

In the client, stop gating these screens on `user.role === 'RECEIVER'`. Give
senders and couriers an "Incoming" tab too. It is simply empty when nothing is
addressed to them.

```tsx
// before
{user.role === 'RECEIVER' && <IncomingParcels />}

// now
<IncomingParcels /> // every signed-in role
```

---

## 6. Admin screens

### Unblock a parcel (new)

```
PATCH /api/parcels/:trackingId/unblock      ADMIN      → Parcel (isBlocked: false)
```

- `400 Parcel is not blocked` if it is not on hold.
- `PATCH :trackingId/block` now answers `400 Parcel is already blocked` on a
  parcel that is already on hold, instead of silently logging a second block.
- The audit log gets a new action, `PARCEL_UNBLOCKED`. Add it to any action
  filter or label map.
- Connected clients receive a `parcel.unblocked` notification (the type
  existed in the client contract but was never emitted).

### Blocking users

| Case | Response |
| --- | --- |
| Admin blocks their own account | `403 You cannot block your own account` |
| Anyone blocks the super admin | `403 The super admin cannot be blocked` |

Hide the Block button on the current user's own row.

### Dashboard trends

`GET /api/dashboard/trends?days=N` — same shape, but two things change in the
numbers:

- `revenue` and `courierThroughput` now respect `days`. They used to be
  all-time totals whatever the window was. Label them with the selected range.
- `statusTimings[].averageHours` will be **higher** than before and
  `sampleSize` lower. Assigning, unassigning or blocking used to cut a status
  span short; a span now runs from entering a status to leaving it.
- `daily[].delivered` and `averageFulfilmentHours` now include deliveries made
  through the status route and receiver confirmation. Older deliveries made
  that way appear once the `BackfillDeliveredAt` migration has run.

### Users list

No shape change. `GET /api/users/all-users` and the parcel lists are no longer
limited to 8 requests a minute, so search-as-you-type and pagination can call
them freely (see [9](#9-errors-and-rate-limits)).

---

## 7. Assistant

### `POST /api/rag/ask` needs the token

It was reachable without one by mistake. It now returns `401` unless the
request carries `Authorization: Bearer <token>`, same as `ask/stream`.

### Answers depend on who is asking

- Policy PDFs: searchable by everyone, as before.
- Parcels: an admin can ask about any parcel. Everyone else only gets parcels
  they sent, are receiving, or are carrying.

So a sender asking about someone else's tracking code now gets "I don't have
that information" and an empty or PDF-only `sources` list. That is the
intended result, not an error; show the answer as it comes.

Parcels indexed before this release carry no owner information and are
invisible to non-admins until re-indexed (see
[10](#10-backend-steps-before-the-client-ships)).

### `503` when the assistant is switched off

If the server has no AI provider keys, both ask routes answer:

```json
{ "statusCode": 503, "message": "The assistant is not configured on this server" }
```

For `ask/stream` this arrives as a normal HTTP error **before** the stream
starts, so check `res.ok` before reading the body:

```ts
const res = await fetch(`${API}/rag/ask/stream`, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${accessToken}`,
  },
  body: JSON.stringify({ question }),
});

if (res.status === 503) return showAssistantUnavailable();
if (!res.ok) throw await res.json();

// ...then read the SSE stream as before
```

The stream event format (`sources`, `token`, `done`, `error`) is unchanged.

### Admin: indexing parcels by hand

`POST /api/rag/index/parcel` and `/index/bulk` accept three new optional
fields per parcel: `senderId`, `receiverId`, `courierId` (uuids). Send them if
you have an admin re-index tool, otherwise the parcel is only visible to
admins.

---

## 8. Realtime

### The server may close the socket

When a user is blocked, the server disconnects their sockets. Socket.IO does
not auto-reconnect after a server-side disconnect, and a manual reconnect
would be refused anyway.

```ts
socket.on('disconnect', (reason) => {
  if (reason === 'io server disconnect') {
    // Access was revoked. Do not reconnect; confirm with the API.
    void verifySessionOrSignOut();
  }
});
```

`verifySessionOrSignOut` can be a `GET /api/users/me`: a `401` there means the
account is blocked, so clear the tokens and go to login.

### New notification type in use

`parcel.unblocked` is now emitted (title `Parcel released`). If the client
switches on `notification.type`, add a case for it.

Everything else about the socket (the `notification` event, the payload, the
handshake) is unchanged.

---

## 9. Errors and rate limits

### Status codes the client may now see

| Code | Meaning | Suggested handling |
| --- | --- | --- |
| `401` | Bad credentials, expired token, **or blocked/deleted account** | Try one refresh; if that fails, sign out and show `message` |
| `403` | Wrong role, not your parcel, or blocking yourself / the super admin | Show `message` |
| `409` | Email or national id already in use | Show `message` next to the field |
| `429` | Rate limit hit | Back off; see below |
| `503` | Assistant not configured | Hide or disable the assistant |

The envelope is unchanged: `{ statusCode, message, error? }`, where `message`
is a string or, for validation failures, a string array.

### Rate limits

Every route used to be capped at 8 requests a minute per IP by mistake. The
real limits are now, per route and per client address:

| Routes | Limit |
| --- | --- |
| Everything not listed below | 120 / minute |
| `auth/login`, `auth/refresh-token`, `auth/forgot-password`, `auth/reset-password`, `auth/verify-email`, `auth/resend-verification`, `auth/change-password`, `users/register` | 8 / minute |
| `contact` | 5 / minute |
| `rag/ask`, `rag/ask/stream`, `rag/index/bulk` | 20 / minute |

`429` responses say how long to wait, in seconds: `Retry-After` for the
general limit, `Retry-After-auth` for credential routes and `Retry-After-ai`
for the assistant. The API lists all three in `Access-Control-Expose-Headers`,
so a browser client on another origin can read them. Debounce search inputs as
good practice, but ordinary browsing no longer needs special care.

---

## 10. Backend steps before the client ships

These are on the API side, listed here because the client's behaviour depends
on them.

1. **Run the migrations.** `npm run migration:run` applies two:

   - `1787875900000-TimestamptzAndParcelPartyIndexes`: the original
     `createdAt`/`updatedAt` columns become `timestamptz` and two indexes are
     added. It rewrites the `users`, `parcels` and `parcel_status_logs`
     tables, so run it in a quiet moment.
   - `1787876000000-BackfillDeliveredAt`: gives every already-delivered parcel
     that has no `deliveredAt` the time of its first `DELIVERED` status-log
     entry.

   Effect on the client: timestamps on users, parcels and status logs were
   being read in the server's local time zone. They now come back as true UTC
   instants (`…Z`) regardless of where the API runs. If the client was
   compensating for an offset in development, remove that.

2. **Re-index parcels for the assistant.** Existing vectors have no owner ids,
   so non-admin users cannot retrieve their own older parcels. Each parcel
   re-indexes itself on its next change; to fix them all at once, post them to
   `POST /api/rag/index/bulk` with `senderId`, `receiverId` and `courierId`.

3. **Set `TRUST_PROXY=1`** on a host behind a reverse proxy (Render, Railway,
   nginx). Without it all users share one rate-limit bucket. Vercel is
   detected automatically.

4. **`CORS_ORIGIN`** may now contain spaces after commas
   (`https://a.com, https://b.com`).

### Not yet verified against live services

The automated suites run on an in-memory Postgres with mail and AI providers
switched off, so three things were changed without being exercised end to end.
Check them once on a real environment:

- the migration above, on a copy of the real database;
- the `dashboard/trends` SQL (the in-memory database cannot run it);
- PDF re-upload and delete, and per-user parcel answers, against a real
  Pinecone index.
