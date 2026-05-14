const express = require('express');
const router  = express.Router();
const db      = require('../../config/db');
const { requireAdmin } = require('../middleware/auth');

// All admin routes require authentication
router.use(requireAdmin);

// ── GET /api/admin/orders ─────────────────────────────────────────────────────
router.get('/orders', async (req, res) => {
  const { status, from, to, limit = 100, offset = 0 } = req.query;
  try {
    const result = await db.query(`
      SELECT
        o.reference, o.status, o.amount_paid, o.refund_amount,
        o.collection_date, o.hold_expires_at, o.created_at,
        o.collected_at, o.expired_at,
        b.model AS battery, b.brand,
        l.door_number,
        c.mobile, c.email
      FROM orders o
      JOIN batteries b  ON b.id = o.battery_id
      JOIN lockers l    ON l.id = o.locker_id
      JOIN customers c  ON c.id = o.customer_id
      WHERE ($1::text IS NULL OR o.status = $1)
        AND ($2::date IS NULL OR o.created_at::date >= $2::date)
        AND ($3::date IS NULL OR o.created_at::date <= $3::date)
      ORDER BY o.created_at DESC
      LIMIT $4 OFFSET $5
    `, [status || null, from || null, to || null, limit, offset]);
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch orders' });
  }
});

// ── GET /api/admin/revenue ────────────────────────────────────────────────────
router.get('/revenue', async (req, res) => {
  try {
    const result = await db.query(`
      SELECT
        DATE(created_at) AS date,
        COUNT(*) AS orders,
        SUM(amount_paid) AS revenue,
        SUM(refund_amount) AS refunded
      FROM orders
      WHERE status IN ('paid','collected','refunded')
        AND created_at >= NOW() - INTERVAL '30 days'
      GROUP BY DATE(created_at)
      ORDER BY date DESC
    `);
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch revenue' });
  }
});

// ── GET /api/admin/customers/search ──────────────────────────────────────────
router.get('/customers/search', async (req, res) => {
  const { q } = req.query;
  if (!q) return res.status(400).json({ error: 'q query param required' });
  try {
    const result = await db.query(`
      SELECT c.id, c.mobile, c.email, c.created_at,
             COUNT(o.id) AS total_orders,
             SUM(o.amount_paid) AS total_spent
      FROM customers c
      LEFT JOIN orders o ON o.customer_id = c.id
      WHERE c.mobile ILIKE $1 OR c.email ILIKE $1
      GROUP BY c.id
      LIMIT 20
    `, [`%${q}%`]);
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Search failed' });
  }
});

// ── POST /api/admin/batteries ─────────────────────────────────────────────────
router.post('/batteries', async (req, res) => {
  const { model, brand, category, voltage, capacity_ah, cca, price, warranty_months, fits } = req.body;
  if (!model || !brand || !price) return res.status(400).json({ error: 'model, brand and price are required' });
  try {
    const result = await db.query(`
      INSERT INTO batteries (model, brand, category, voltage, capacity_ah, cca, price, warranty_months, fits)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
      RETURNING *
    `, [model.toUpperCase(), brand, category || 'other',
        voltage || 12, capacity_ah, cca, price, warranty_months || 12, fits]);
    res.status(201).json(result.rows[0]);
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'Battery model already exists' });
    console.error(err);
    res.status(500).json({ error: 'Failed to add battery' });
  }
});

// ── PATCH /api/admin/batteries/:id ───────────────────────────────────────────
router.patch('/batteries/:id', async (req, res) => {
  const { price, is_active, fits, warranty_months } = req.body;
  try {
    const result = await db.query(`
      UPDATE batteries
      SET price           = COALESCE($1, price),
          is_active       = COALESCE($2, is_active),
          fits            = COALESCE($3, fits),
          warranty_months = COALESCE($4, warranty_months)
      WHERE id = $5 RETURNING *
    `, [price, is_active, fits, warranty_months, req.params.id]);
    if (!result.rows.length) return res.status(404).json({ error: 'Battery not found' });
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Update failed' });
  }
});

// ── GET /api/admin/audit ──────────────────────────────────────────────────────
router.get('/audit', async (req, res) => {
  try {
    const result = await db.query(`
      SELECT * FROM audit_log
      ORDER BY created_at DESC LIMIT 200
    `);
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch audit log' });
  }
});

module.exports = router;
