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

- `GET /api/products` — list products (optional `?category=PSE%26G`)
- `POST /api/products` — create product

```json
{
  "sku": "RAM-LED-001",
  "name": "LED Panel 2x4",
  "price": 89.99,
  "category": "PSE&G"
}
```

Categories: `PSE&G`, `JCP&L`, `ATLANTIC CITY ENERGY`

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
