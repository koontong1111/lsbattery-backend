require('dotenv').config();
const express    = require('express');
const cors       = require('cors');
const rateLimit  = require('express-rate-limit');

const inventoryRoutes   = require('./routes/inventory');
const ordersRoutes      = require('./routes/orders');
const paymentsRoutes    = require('./routes/payments');
const adminRoutes       = require('./routes/admin');
const lockerRoutes      = require('./routes/lockers');
const authRoutes        = require('./routes/auth');
const { startJobs }     = require('./jobs/scheduler');

const app  = express();
const PORT = process.env.PORT || 3000;

// ── CORS — allow all origins (website is a static HTML file) ─────────────────
app.use(cors({ origin: '*', credentials: false }));

// ── Raw body for Stripe webhooks (must come BEFORE express.json) ──────────────
app.use('/api/payments/stripe/webhook',
  express.raw({ type: 'application/json' })
);

// ── Body parsing ──────────────────────────────────────────────────────────────
app.use(express.json());

// ── Rate limiting ─────────────────────────────────────────────────────────────
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  message: { error: 'Too many requests, please try again later.' },
});
app.use('/api/', limiter);

const paymentLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: { error: 'Too many payment attempts. Please wait before trying again.' },
});
app.use('/api/payments/stripe/intent', paymentLimiter);

// ── ROUTES ────────────────────────────────────────────────────────────────────
app.use('/api/inventory',  inventoryRoutes);
app.use('/api/orders',     ordersRoutes);
app.use('/api/payments',   paymentsRoutes);
app.use('/api/admin',      adminRoutes);
app.use('/api/lockers',    lockerRoutes);
app.use('/api/auth',       authRoutes);

// ── HEALTH CHECK ──────────────────────────────────────────────────────────────
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// ── RESET ADMIN PASSWORD on startup if ADMIN_PASSWORD env var is set ──────────
async function resetAdminIfNeeded() {
  if (!process.env.ADMIN_PASSWORD) return;
  try {
    const db = require('../config/db');
    const bcrypt = require('bcryptjs');
    const hash = await bcrypt.hash(process.env.ADMIN_PASSWORD, 10);
    await db.query(
      `INSERT INTO admin_users (email, password_hash, name)
       VALUES ($1, $2, 'LS Battery Admin')
       ON CONFLICT (email) DO UPDATE SET password_hash = $2`,
      [process.env.ADMIN_EMAIL || 'admin@lsbattery.com.sg', hash]
    );
    console.log('✅ Admin user ready:', process.env.ADMIN_EMAIL || 'admin@lsbattery.com.sg');
  } catch (err) {
    console.error('Admin reset error:', err.message);
  }
}

// ── 404 ───────────────────────────────────────────────────────────────────────
app.use((req, res) => {
  res.status(404).json({ error: 'Route not found' });
});

// ── ERROR HANDLER ─────────────────────────────────────────────────────────────
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

// ── START ─────────────────────────────────────────────────────────────────────
app.listen(PORT, async () => {
  console.log(`\n✅ LS Battery backend running on port ${PORT}`);
  console.log(`   Environment: ${process.env.NODE_ENV || 'development'}`);
  await resetAdminIfNeeded();
  startJobs();
});

module.exports = app;
