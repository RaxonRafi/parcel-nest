# Project review: issues, improvements and feature ideas

Backend review of the Parcel Delivery API. See [`README.md`](./README.md) for setup and architecture.

---

## 🐞 Known issues and bugs

The bugs found in the 2026-10-10 review were fixed the same day on branch
`fix/review-bugs`. Client-facing effects are in
[`FRONTEND_GUIDE.md`](./FRONTEND_GUIDE.md).

State after the fixes: `npm run lint` clean, `npx tsc --noEmit` clean,
`nest build` clean, 170 unit tests and 45 e2e tests passing.

### Fixed

**Critical**
- `POST /api/rag/ask` had no auth guard — now requires a signed-in user.
- Every route was limited to 8 requests a minute — the tight limits now apply
  only to the handlers that ask for them.
- The refresh token returned by `register` never worked — registration records
  a session.
- Public signup could not pick a role — `RECEIVER` and courier applications
  work without a token; `ADMIN` still needs an admin's.
- `deliveredAt` was only set by the delivery-proof route — every path to
  `DELIVERED` goes through one `markDelivered()`.
- The e2e suite did not boot — rebuilt on an in-memory Postgres (`pg-mem`)
  with the real modules, guard and filter, and rewritten to the current API.

**High**
- Blocked parcels could not be unblocked — `PATCH :trackingId/unblock`.
- Blocking was not enforced on cancel, confirm and delivery proof.
- Cash on delivery could be skipped through the status and confirm routes.
- Receivers whose account was not a `RECEIVER` could not see or confirm their
  parcels; a parcel could be addressed to the sender or to a blocked account.
- The assistant ignored ownership — retrieval is filtered to the caller's own
  parcels unless they are an admin.
- Unique-constraint violations surfaced as `500` — now `409`.
- A parcel and its status-log row were saved separately — now one transaction.
  Refresh rotation and single-use links are claimed atomically.
- The sender could cancel after dispatch — only while `PENDING` now.
- Rate limiting ignored reverse proxies — `TRUST_PROXY`, automatic on Vercel.

**Found while fixing**
- Two refresh tokens issued to one user in the same second were identical, so
  a rotation could hand back the token it had just revoked. Each refresh token
  now carries a unique id.

**Medium / low**
- `CORS_ORIGIN` entries are trimmed; a failed boot is logged and exits.
- The API starts without AI provider keys (assistant routes answer `503`).
- PDF temp file deleted once; a re-uploaded PDF replaces its old chunks; the
  upload directory uses the OS temp dir.
- Dashboard revenue and courier throughput honour the `days` window; dwell
  time no longer splits on assign/block notes.
- Blocking a user ends their sessions and closes their sockets; an admin cannot
  block themselves or the super admin.
- Blocked accounts get `401` at login and refresh, matching the guard.
- `logout` only revokes the caller's own refresh token.
- Claim-account links last 7 days; a completed reset marks the email verified.
- Expired token rows are pruned by the daily keep-alive cron.
- `Authorization` must use the `Bearer` scheme.
- Tracking ids come from the OS random source and are checked for collisions.
- New migration: `timestamptz` on the original tables, indexes on
  `parcels.senderId` / `receiverId`.
- Lint errors cleared; `npm run lint` no longer auto-fixes (`npm run lint:fix`
  does). `@langchain/textsplitters` declared; `@types/*` moved to dev.
- Swagger has `Contact` and `Audit` tag descriptions.

### Still open

- **Run and verify the migration.** `1787875900000-TimestamptzAndParcelPartyIndexes`
  has not been applied to any database. Try it on a copy first.
- **Not exercised against live services:** the `dashboard/trends` SQL (pg-mem
  cannot run it), and the Pinecone paths — per-user filtering, PDF re-upload
  and delete.
- **Existing assistant vectors have no owner ids**, so non-admins cannot
  retrieve their older parcels until those are re-indexed.
- **Audit writes stay outside the parcel transaction** on purpose: a failed
  audit insert must not undo the action it describes.
- `README.md` is stale in places: the project tree omits `realtime/` and
  `contact/`, the deployment section says WebSockets are not implemented, and
  `percel-client/` is linked but is not in this repository. Left untouched.
- `@langchain/openai`, `langchain`, `@huggingface/inference` and `pdf-parse`
  are never imported directly. The last two are needed by LangChain loaders at
  runtime; check the first two before removing.

---

## 🔧 Improvements to existing features

**Auth and accounts**
- Enforce `isVerified` where it matters (creating parcels, courier approval).
- Refresh-token reuse detection: presenting an already-rotated token should
  revoke the whole session family, not just fail.
- Deliver the refresh token in an `httpOnly` cookie instead of the JSON body.
- Password strength rules beyond length; per-account lockout after repeated
  failures (the throttle is per IP only).
- Expose the unused `softDeleteUser` / `updateUser` as "delete my account" and
  admin user editing; add a "list my sessions / sign out this device" view.
- Courier approval should require `nidNumber` and `nidImage`, and email the
  applicant the decision.

**Parcels**
- Authenticated `GET /api/parcels/:trackingId/details` for the owner — today the
  only single-parcel read is the trimmed public one.
- Require an assigned courier before `PICKED_UP`; let admins use `cancel` and
  `my-parcels` for parcels they created.
- Mask the public tracking response to city/area rather than full pickup and
  delivery addresses and full names.
- Return the fee breakdown `calculateDeliveryFee` already computes, and add a
  `POST /api/parcels/quote` so the client can show a price before booking.
- Drop `statusLogs` + `changedBy` from list queries (five joins per page) and
  load them on the detail route only. Escape `%` / `_` in search terms.
- Audit cancel, confirm, proof submission and parcel creation, not only admin
  actions.

**Notifications and mail**
- Move SMTP sends and RAG indexing off the request path (BullMQ, or `waitUntil`
  on Vercel). Today each parcel write awaits two emails plus an embedding call.
- Persist notifications so a missed socket push is not lost; add an unread
  count and per-user email preferences.
- Set `replyTo` on contact-form mail, store messages in a table, and add a
  honeypot or captcha.

**RAG**
- Add conversation history; return "no sources" instead of calling the model
  when retrieval is empty; verify PDF magic bytes, not just the client MIME type.
- Index the seed data, and add a "re-index everything from Postgres" admin
  action — the current bulk route needs the client to send the documents.

**Platform**
- Validate env at boot (Joi/zod schema in `ConfigModule`) instead of
  `getOrThrow` failing on the first request that needs a value.
- `helmet`, a catch-all exception filter, request logging with a request id, `enableShutdownHooks`, and a real `/api/health` that checks the
  database (the current one returns "Hello World!").
- Redis-backed throttler storage and Socket.IO adapter so both work across
  instances.
- Gate Swagger UI in production.
- Turn on `strict` in `tsconfig.json` (`noImplicitAny` is off).
- More tests: dashboard trends against a real Postgres, password reset and
  email verification services, mail templates.
- CI (lint, type-check, unit, e2e against a Postgres service container) and a
  `Dockerfile` — realtime needs a long-running host, which Vercel is not.

---

## ✨ Features worth adding

**Core delivery flow**
- Online payment for prepaid parcels (SSLCommerz / bKash / Stripe) and a COD
  settlement ledger: what each courier collected, what is owed to each sender.
- Failed-attempt, reschedule and return-to-sender statuses — the state machine
  currently ends at delivered or cancelled.
- Editing a parcel (address, receiver phone) while it is still `PENDING`.
- Delivery OTP or QR code confirmed at handover instead of a free "confirm"
  button.
- Scheduled pickup windows and an estimated delivery date.
- Zones / hubs with distance-based pricing, express vs standard tiers.
- Printable shipping label and invoice PDF with a QR tracking code.
- Bulk booking by CSV upload for merchants.

**Couriers**
- Auto-assignment by zone and current workload; courier availability toggle.
- Live location sharing over the existing Socket.IO gateway, with a map on the
  tracking page.
- Courier earnings summary and ratings from receivers.

**Accounts**
- Google sign-in — `AuthProviderType.GOOGLE` and the `auth_providers` table are
  already there, with no implementation behind them.
- Two-factor authentication for admins.
- File uploads: profile picture, NID images and delivery proof are URL fields
  with no upload endpoint. Supabase Storage signed uploads fit, and
  `@supabase/supabase-js` is already a dependency.
- Saved address book for senders.

**Communication**
- SMS / WhatsApp / web-push notifications alongside email.
- In-app notification inbox backed by a table.
- Support tickets linked to a parcel, replacing the email-only contact form.
- Bangla / English localisation for emails and API messages.

**Admin and integrations**
- CSV / Excel export of parcels, users and audit logs; scheduled email reports.
- Merchant API keys and webhooks for status changes.
- Admin-editable pricing rules instead of env variables.
- Per-sender analytics (spend, delivery success rate).
