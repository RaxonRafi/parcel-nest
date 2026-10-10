# Project review: issues, improvements and feature ideas

Backend review of the Parcel Delivery API. See [`README.md`](./README.md) for setup and architecture.

---

## 🐞 Known issues and bugs

The bugs found in the 2026-10-10 review were fixed the same day on branch
`fix/review-bugs`, and a follow-up pass on `development` closed most of what
that left open. Both are merged to `master`. Client-facing effects are in
[`FRONTEND_GUIDE.md`](./FRONTEND_GUIDE.md).

State after the fixes: `npm run lint` clean, `npx tsc --noEmit` clean,
`nest build` clean, 175 unit tests and 47 e2e tests passing. (The improvements
pass further down took that to 385 and 79.)

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

**Closed in the follow-up pass (same day)**
- Both new migrations are applied to the development database and their
  effects checked: `timestamptz` columns, the two parcel indexes, and no
  delivered parcel without `deliveredAt`.
- The `dashboard/trends` SQL was run on real Postgres for 7, 30 and 90 days;
  the daily totals match the table.
- The Pinecone paths were run on the real index: per-user filtering, PDF
  upload, a shorter re-upload replacing the old chunks, and PDF delete.
- The 4 parcel vectors that existed were given their owner ids.
- `POST /api/parcels/reindex` (admin) rebuilds every parcel's vector from
  Postgres, 50 per embedding call.
- `README.md` brought up to date: `realtime/` and `contact/` in the tree, the
  deployment note on WebSockets, the `percel-client/` link, and the e2e
  database (pg-mem, not SQLite).
- `langchain` and `@langchain/openai` removed from `package.json`; neither was
  imported. `pdf-parse` had already gone when PDF loading moved to `unpdf`.
  `@huggingface/inference` stays: the embeddings class loads it at runtime.

### Still open

Re-checked at the end of 2026-10-10. In the order they need doing:

1. **The HuggingFace account has no credits left.** Every embedding request
   answers `402`, so `ask` and `ask/stream` fail on any real question, and PDF
   upload and parcel indexing fail too. Wait for the monthly allowance to
   reset, add credits, or put a key from another account in
   `HUGGINGFACE_API_KEY`. Nothing below it on this list can move until then.
2. **200 of 204 parcels are not in the assistant's index**, so it cannot answer
   about them for anyone. Call `POST /api/parcels/reindex` as an admin (the
   "full re-index" button on the client's knowledge page) once embeddings
   work. The route is unit- and e2e-tested but has not completed a live run.
3. **Answer quality with real embeddings is unverified.** The Pinecone checks
   above used stand-in vectors because of the credit problem; storage,
   filtering and deletion are confirmed, ranking is not. Ask a few real
   questions as a sender, a receiver and an admin after step 2.
4. **Production database:** the migrations were verified on the database in the
   local `.env` only. Run `npm run migration:show` against any other one.
5. **Run the two migrations from the improvements pass** before deploying
   it — see the next section.

**Not a defect, recorded so it is not "fixed" by mistake:** audit writes stay
outside the parcel transaction on purpose. A failed audit insert must not undo
the action it describes.

---

## 🔧 Improvements to existing features

Worked through on 2026-10-10. State afterwards: lint, type-check (now
`strict`) and build clean; 385 unit tests, 79 e2e tests and 9 live SQL tests
passing. The client-facing delta is section 11 of
[`FRONTEND_GUIDE.md`](./FRONTEND_GUIDE.md).

### Before deploying this

1. **Run the two new migrations first**: `npm run migration:run` applies
   `AuthHardening` and `NotificationsContactAndFeeBreakdown`. They are not
   applied anywhere yet. The new code reads columns they add, so deploying it
   before migrating breaks sign-in; the old code is unaffected by them, so
   migrate, then deploy. Both were run up and down inside a rolled-back
   transaction on the development database and passed.
2. **Courier applicants need an ID on file** to be approved from now on. The
   three seeded applicants have none.

### Done

**Auth and accounts**
- `isVerified` is enforced on booking a parcel and on courier approval when
  `REQUIRE_VERIFIED_EMAIL=true`. Off by default: it locks everyone out of
  booking unless mail is actually being delivered.
- Refresh-token reuse detection. Tokens in one rotation chain share a family;
  a rotated token presented again ends the family.
- The refresh token is set as an `httpOnly` cookie. It is still in the JSON
  body until `REFRESH_TOKEN_IN_BODY=false`, so the current client keeps
  working.
- Password rules (8–72 characters, upper case, lower case, a number) and a
  per-account lockout: five wrong passwords, 15 minutes.
- `DELETE /api/users/me` (with password), admin `PATCH` / `DELETE
  /api/users/:id`, and `GET` / `DELETE /api/auth/sessions`.
- Courier approval requires `nidNumber` and `nidImage`, and emails the
  applicant either decision.

**Parcels**
- `GET /api/parcels/:trackingId/details` for an admin or the parcel's parties.
- A courier must be assigned before `PICKED_UP`; admins can use `cancel` and
  `my-parcels` for parcels they booked.
- The public tracking response is masked to area and "Jane D.".
- `feeBreakdown` is stored at booking and returned; `POST /api/parcels/quote`.
- Lists no longer load `statusLogs` and their authors. `%` and `_` in a search
  are literal.
- Booking, cancelling, confirming and proof submission are audited.

**Notifications and mail**
- Mail, assistant indexing and notifications run behind the response
  (`BackgroundService`, using Vercel's `waitUntil` there).
- Notifications are stored per user, with an inbox, an unread count and
  mark-read routes; the live push carries the stored id. `emailNotifications`
  is the per-user opt-out for parcel emails.
- Contact messages are stored (admins: `GET /api/contact/messages`), sent with
  the visitor as reply-to, and protected by a honeypot field.

**RAG**
- `history` on both ask routes; no completion is billed when retrieval finds
  nothing; uploaded PDFs are checked by their first bytes.
- `POST /api/parcels/reindex` also removes vectors whose parcel is gone.

**Platform**
- Environment validated at boot.
- `helmet`, one catch-all exception filter, request ids with a log line per
  request, shutdown hooks, and `GET /api/health` that queries the database.
- Optional Redis (`REDIS_URL`) for throttler storage and the Socket.IO
  adapter.
- Swagger can be switched off or put behind Basic auth.
- `strict` is on in `tsconfig.json`.
- New tests: password reset, email verification, mail templates, and the
  trend queries against a real Postgres (`npm run test:live`).
- CI workflow and a `Dockerfile`.
- `sqlite3`, an unused dev dependency, removed.

### Built but not verified end to end

- **Redis.** No Redis was available to test against. The code paths are
  exercised only as far as type-checking and a boot without `REDIS_URL`.
- **The CI workflow and the `Dockerfile`** have not been run: Docker was not
  running on the development machine, and the workflow runs on GitHub.
- **Vercel `waitUntil`.** Unit-tested against a stand-in for Vercel's request
  context, not on Vercel itself. If queued mail stops arriving there, this is
  the first place to look.
- **The refresh cookie across sites.** Verified against the API directly. In
  production the client is on another site, where the cookie is a third-party
  cookie that some browsers block — which is why the body token stays on.
- **The assistant's new behaviour with a real model.** HuggingFace is still
  out of credits, so `history` and the no-sources path are unit-tested only.

### Deliberately different from the original note

- **Swagger is not gated by default.** The live docs are part of what this
  project shows, so the gate is opt-in.
- **`isVerified` enforcement is opt-in**, for the reason above.
- **The refresh token is delivered in a cookie *as well as* the body**, not
  instead of it, until the client moves over.
- **Background work uses `waitUntil`, not BullMQ.** A queue needs a worker
  process, which Vercel does not have.
- **No captcha** on the contact form — a honeypot only. A captcha needs a
  third-party account and a client widget.

### Still worth doing

- Move the client to the refresh cookie and switch the body token off.
- Client screens for admin user editing and for reading contact messages.
- A separate "condense the follow-up into a standalone question" step for the
  assistant; today retrieval just searches with the previous question too.
- Per-notification email preferences (today it is one switch).
- An upload endpoint for ID photos and delivery proof — they are URL fields.

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
