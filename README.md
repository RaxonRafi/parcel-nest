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
