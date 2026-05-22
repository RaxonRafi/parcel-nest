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
