# LS Battery Backend
Inventory management, order processing, Stripe payments & WhatsApp notifications.

---

## Quick Start (Local)

### 1. Install Node.js
Download from https://nodejs.org (choose LTS version)

### 2. Install dependencies
```bash
cd lsbattery-backend
npm install
```

### 3. Set up environment variables
```bash
cp .env.example .env
# Open .env and fill in your real values
```

### 4. Set up database (PostgreSQL)
**Free option:** Create a free PostgreSQL database at https://railway.app
- Sign up → New Project → Add PostgreSQL
- Copy the DATABASE_URL and paste into your .env

```bash
# Run database setup
psql $DATABASE_URL -f sql/schema.sql
psql $DATABASE_URL -f sql/seed.sql
```

### 5. Start the server
```bash
npm run dev    # development (auto-restarts on changes)
npm start      # production
```

Server runs at: http://localhost:3000
Health check:   http://localhost:3000/health

---

## Deploy to Railway (Free Hosting)

1. Go to https://railway.app → New Project → Deploy from GitHub
2. Connect your GitHub repo
3. Add environment variables in Railway dashboard (Settings → Variables)
4. Railway auto-deploys on every git push
5. Your API URL: https://lsbattery-backend.up.railway.app

---

## API Endpoints

### Public
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | /api/inventory/batteries | All battery models with stock |
| GET | /api/inventory/batteries/search?model=NS60L | Search batteries |
| GET | /api/inventory/availability/:model | Locations with stock |
| POST | /api/payments/stripe/intent | Create payment |
| POST | /api/payments/stripe/webhook | Stripe webhook |
| GET | /api/orders/:ref | Get order by reference |
| POST | /api/auth/login | Admin login |

### Admin (requires Bearer token)
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | /api/inventory/lockers | All 30 locker doors |
| PATCH | /api/inventory/lockers/:id | Update door status |
| GET | /api/inventory/dashboard | KPI summary |
| GET | /api/admin/orders | All orders |
| PATCH | /api/orders/:ref/collect | Mark as collected |
| GET | /api/admin/revenue | Revenue report |
| POST | /api/admin/batteries | Add battery model |
| POST | /api/payments/refund | Issue 80% refund |
| GET | /api/lockers/status | Hardware status |
| POST | /api/lockers/open | Remote open door |

---

## Connecting to Your Frontend

In your battery-locker.html, replace the mock data calls with real API calls:

```javascript
// Example: fetch real battery stock
const res = await fetch('https://your-backend.railway.app/api/inventory/batteries');
const batteries = await res.json();
```

---

## Default Admin Login
Email:    admin@lsbattery.com.sg
Password: Admin@LSBattery1

⚠️ CHANGE THIS IMMEDIATELY after first login.

---

## Background Jobs (automatic)
- Every hour    → expire overdue reservations + issue 80% refund
- Every 30 min  → send WhatsApp reminder 2h before hold expires
- Every night   → email admin daily summary report

---

## When your locker hardware arrives
1. Get the API URL and API key from your supplier
2. Add to .env: LOCKER_API_URL and LOCKER_API_KEY
3. Update src/routes/lockers.js to match their API format
4. Test with their sandbox environment first

---

## Support
Built by Claude for LS Battery Pte Ltd
Questions? Paste error messages into Claude and ask for help.
