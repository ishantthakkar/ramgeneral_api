# Ramgeneral API

Simple Node.js admin login API using Express and MongoDB.

## Setup

1. Install dependencies:

```bash
npm install
```

2. Start the server:

```bash
npm run dev
```

3. Seed an admin account:

```bash
node scripts/seedAdmin.js admin@ramgeneral.com Password123!
```

## Login endpoint

POST `/api/admin/login`

Request body:

```json
{
  "email": "admin@ramgeneral.com",
  "password": "Password123!"
}
```

Response:

```json
{
  "email": "admin@ramgeneral.com",
  "accessToken": "...",
  "refreshToken": "..."
}
```

## Products API

All product routes require `Authorization: Bearer <accessToken>`.

- `GET /api/products` — list all products
- `POST /api/products` — create product
- `GET /api/products/:id` — get one product

```json
{
  "sku": "RAM-LED-001",
  "name": "LED Panel 2x4",
  "salesPrice": 89.99,
  "commission": 12.5,
  "installationCost": 25.0
}
```

Seed sample products:

```bash
npm run seed:products
```

## MongoDB URL

Default connection: `mongodb://127.0.0.1:27017/ramgeneral`

If you want to use environment variables, create a `.env` file with:

```env
MONGO_URL=mongodb://127.0.0.1:27017/ramgeneral
JWT_SECRET=your_secret_here
PORT=5000
```
