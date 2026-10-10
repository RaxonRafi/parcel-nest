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
- [11. Second pass: the improvements release](#11-second-pass-the-improvements-release)

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

A parcel that is not in the assistant's index is invisible to it, and so far
almost none are: see step 2 in
[10](#10-backend-steps-before-the-client-ships).

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

### Admin: rebuild the whole index (new)

`POST /api/parcels/reindex`, no body, admin only. Returns
`{ message: string; indexed: number }`. The server reads every parcel from the
database itself, so the client sends nothing. Worth a button on the admin
assistant screen; it can take several seconds, and answers `503` when the
assistant is switched off.

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

0. **Run the two new migrations before deploying the improvements release.**
   `1787876100000-AuthHardening` and
   `1787876200000-NotificationsContactAndFeeBreakdown` are **not applied
   yet**. The new code reads columns they add, so deploying it first breaks
   sign-in. They only add columns and tables, so the *current* code keeps
   working once they are in: migrate first, then deploy. See
   [11](#11-second-pass-the-improvements-release).

1. **Run the earlier migrations.** Done on the development database on
   2026-10-10; repeat on any other environment. `npm run migration:run`
   applies two:

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

2. **Re-index parcels for the assistant. Not done yet.** Only 4 of the 204
   parcels are in the index (those 4 now carry owner ids). The rest are
   invisible to the assistant for everyone until an admin calls
   `POST /api/parcels/reindex`. That call is blocked for now: the HuggingFace
   account that produces embeddings has no credits left (`402`), which also
   means `ask` and `ask/stream` fail on every real question until it is topped
   up or the key is replaced.

3. **Set `TRUST_PROXY=1`** on a host behind a reverse proxy (Render, Railway,
   nginx). Without it all users share one rate-limit bucket. Vercel is
   detected automatically.

4. **`CORS_ORIGIN`** may now contain spaces after commas
   (`https://a.com, https://b.com`).

### Verified against live services

The automated suites run on an in-memory Postgres with mail and AI providers
switched off, so these were checked by hand on 2026-10-10 against the
development database and the real Pinecone index:

- both migrations applied; timestamps are `timestamptz`, the two indexes
  exist, and no delivered parcel is missing `deliveredAt`;
- the `dashboard/trends` SQL runs for 7, 30 and 90 days, and its daily totals
  match the table;
- per-user parcel retrieval, PDF upload, a shorter re-upload replacing the old
  chunks, and PDF delete all behave on Pinecone.

One gap: HuggingFace was out of credits, so the Pinecone checks used stand-in
vectors. Storage, filtering and deletion are confirmed; answer quality with
real embeddings is not.

---

## 11. Second pass: the improvements release

A second change set on the same day worked through the "improvements" list in
[`PROJECT_REVIEW.md`](./PROJECT_REVIEW.md). The client in `percel-client` has
already been updated for everything marked **done**; the rest is optional.

### Breaks an unchanged client

| Change | What to do | Client |
| --- | --- | --- |
| **Parcel lists have no `statusLogs`.** | Fetch `GET /api/parcels/:trackingId/details` when a row is opened. | done |
| **`PICKED_UP` needs a courier.** `PATCH …/status` answers `400` until one is assigned — for admins too. | Disable that option until `deliveryPersonnel` is set. | done |
| **Courier approval needs an ID.** `…/delivery/approve` answers `400` until the applicant has `nidNumber` and a `nidImage`. | Let applicants add a photo URL on their profile; show the error to the admin. | done |
| **Passwords have rules** at register, change and reset: 8–72 characters with upper case, lower case and a number. | Say so next to the field; the API's message is displayable as it is. | done |
| **The public tracking page is masked.** Names are "Jane D.", addresses are the area only. | Nothing to change, but do not expect a street address there. A signed-in party gets the full record from `details`. | no change needed |
| **`GET /api` is liveness only.** | Use `GET /api/health` for a real check. | done |

### New, and used by the client

- **Notification inbox.** `GET /api/notifications`, `…/unread-count`,
  `PATCH …/:id/read`, `PATCH …/read-all`. The bell loads from it on sign-in,
  so nothing is lost while the tab was closed.
- **No more failed socket on Vercel.** `GET /api/health` returns
  `realtime: false` on a serverless host. The client asks first and only opens
  a Socket.IO connection when it is `true`; otherwise it re-reads the inbox
  every minute and on window focus. This is what removes the
  `WebSocket connection to 'wss://…/socket.io/' failed` console error.
- **Price preview.** `POST /api/parcels/quote` — the new-shipment form shows
  the fee and its breakdown as the weight is typed.
- **`feeBreakdown`** on every parcel booked from now on (older ones: `null`).
- **Follow-up questions.** `ask` and `ask/stream` accept `history`; the chat
  widget sends the last ten turns.
- **Profile:** `emailNotifications` (opt out of parcel emails), a list of
  signed-in devices with sign-out per device (`GET/DELETE /api/auth/sessions`),
  and delete-my-account (`DELETE /api/users/me` with the password).
- **Admin cancel and "my parcels"** for parcels the admin booked themselves.
- **Contact form honeypot** — an off-screen `website` field.
- **Audit filter** lists the new actions.

### New, and not used by the client yet

- **The refresh cookie.** `login`, `register` and `refresh-token` now also set
  the refresh token as an `httpOnly` cookie. The client still keeps the token
  from the body in storage. To move over: send auth requests with
  `credentials: 'include'`, stop storing the refresh token, call
  `refresh-token` with an empty body, send `{ everywhere: true }` to sign out
  everywhere, then set `REFRESH_TOKEN_IN_BODY=false` on the API. Note that the
  client and API are on different sites in production, so this relies on a
  third-party cookie, which Safari and some privacy modes block — test before
  switching the body off.
- **Admin user editing and deleting** (`PATCH` / `DELETE /api/users/:id`). The
  API client has `adminUpdateUser` and `adminDeleteUser`; no screen calls them.
- **Contact messages for admins** (`GET /api/contact/messages`,
  `api.getContactMessages`). No screen yet.
- **`markNotificationRead`** for a single item; the bell marks all on close.

### New status codes to expect

- `429` from **login** can now mean the account is locked (five wrong
  passwords, 15 minutes). The message says how long is left.
- `500` bodies carry a `requestId`, also in the `X-Request-Id` response
  header. Worth showing in an error state so it can be quoted.
- `403` on booking a parcel, only if the API is run with
  `REQUIRE_VERIFIED_EMAIL=true`.

### Sign-out after token reuse

If a refresh token that was already rotated is presented again, the API ends
every session in that chain. The client's single-flight refresh already
prevents this within one tab. Two *tabs* refreshing in the same few seconds
are tolerated; the loser gets a `401` and the user signs in again in that tab.
