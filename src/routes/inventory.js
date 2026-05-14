const express = require('express');
const router  = express.Router();
const db      = require('../../config/db');
const { requireAdmin } = require('../middleware/auth');

// ── GET /api/inventory/batteries ─────────────────────────────────────────────
// Returns all active battery models with stock count per model
router.get('/batteries', async (req, res) => {
  try {
    const result = await db.query(`
      SELECT
        b.id, b.model, b.brand, b.category,
        b.voltage, b.capacity_ah, b.cca,
        b.price, b.warranty_months, b.fits,
        COUNT(l.id) FILTER (WHERE l.status = 'available') AS in_stock,
        COUNT(l.id) FILTER (WHERE l.status = 'reserved')  AS reserved
      FROM batteries b
      LEFT JOIN lockers l ON l.battery_id = b.id
      WHERE b.is_active = TRUE
      GROUP BY b.id
      ORDER BY b.category, b.price
    `);
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch batteries' });
  }
});

// ── GET /api/inventory/batteries/search?model=NS60L ──────────────────────────
router.get('/batteries/search', async (req, res) => {
  const { model } = req.query;
  if (!model) return res.status(400).json({ error: 'model query param required' });
  try {
    const result = await db.query(`
      SELECT
        b.*,
        COUNT(l.id) FILTER (WHERE l.status = 'available') AS in_stock
      FROM batteries b
      LEFT JOIN lockers l ON l.battery_id = b.id
      WHERE b.is_active = TRUE
        AND (b.model ILIKE $1 OR b.fits ILIKE $1)
      GROUP BY b.id
      ORDER BY b.price
    `, [`%${model}%`]);
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Search failed' });
  }
});

// ── GET /api/inventory/availability/:batteryModel ─────────────────────────────
// Returns available locker doors for a specific battery model
router.get('/availability/:batteryModel', async (req, res) => {
  try {
    const result = await db.query(`
      SELECT
        loc.id AS location_id,
        loc.name AS location_name,
        loc.address,
        loc.hours,
        COUNT(l.id) AS available_doors,
        ARRAY_AGG(l.door_number ORDER BY l.door_number) AS door_numbers
      FROM lockers l
      JOIN locations loc ON loc.id = l.location_id
      JOIN batteries b   ON b.id   = l.battery_id
      WHERE b.model    = $1
        AND l.status   = 'available'
        AND loc.is_active = TRUE
      GROUP BY loc.id, loc.name, loc.address, loc.hours
      HAVING COUNT(l.id) > 0
    `, [req.params.batteryModel.toUpperCase()]);
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to check availability' });
  }
});

// ── GET /api/inventory/lockers ─────────────────────────────────────────────
// Admin: all 30 doors with status
router.get('/lockers', requireAdmin, async (req, res) => {
  try {
    const result = await db.query(`
      SELECT
        l.id, l.door_number, l.status,
        l.access_code, l.reserved_until,
        b.model AS battery_model, b.brand, b.price,
        loc.name AS location_name
      FROM lockers l
      JOIN locations loc ON loc.id = l.location_id
      LEFT JOIN batteries b ON b.id = l.battery_id
      ORDER BY l.door_number
    `);
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch lockers' });
  }
});

// ── PATCH /api/inventory/lockers/:id ─────────────────────────────────────────
// Admin: update a locker door (restock, set maintenance, etc.)
router.patch('/lockers/:id', requireAdmin, async (req, res) => {
  const { status, battery_id } = req.body;
  const validStatuses = ['available', 'maintenance', 'reserved'];
  if (status && !validStatuses.includes(status)) {
    return res.status(400).json({ error: `Invalid status. Use: ${validStatuses.join(', ')}` });
  }
  try {
    const result = await db.query(`
      UPDATE lockers
      SET
        status     = COALESCE($1, status),
        battery_id = COALESCE($2, battery_id)
      WHERE id = $3
      RETURNING *
    `, [status, battery_id, req.params.id]);
    if (!result.rows.length) return res.status(404).json({ error: 'Locker not found' });

    // Audit log
    await db.query(
      `INSERT INTO audit_log (entity, entity_id, action, new_value, performed_by)
       VALUES ('locker', $1, 'updated', $2, 'admin')`,
      [req.params.id, JSON.stringify(req.body)]
    );
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Update failed' });
  }
});

// ── GET /api/inventory/dashboard ─────────────────────────────────────────────
// Quick KPI summary for admin dashboard
router.get('/dashboard', requireAdmin, async (req, res) => {
  try {
    const [doors, revenue, orders] = await Promise.all([
      db.query(`
        SELECT
          COUNT(*) FILTER (WHERE status = 'available')   AS available,
          COUNT(*) FILTER (WHERE status = 'reserved')    AS reserved,
          COUNT(*) FILTER (WHERE status = 'maintenance') AS maintenance,
          COUNT(*) AS total
        FROM lockers
      `),
      db.query(`
        SELECT
          SUM(amount_paid) FILTER (WHERE created_at >= CURRENT_DATE)              AS today,
          SUM(amount_paid) FILTER (WHERE created_at >= CURRENT_DATE - INTERVAL '7 days') AS this_week,
          SUM(amount_paid) FILTER (WHERE DATE_TRUNC('month', created_at) = DATE_TRUNC('month', NOW())) AS this_month
        FROM orders WHERE status IN ('paid','collected')
      `),
      db.query(`
        SELECT
          COUNT(*) FILTER (WHERE status = 'paid')      AS active,
          COUNT(*) FILTER (WHERE status = 'collected') AS collected,
          COUNT(*) FILTER (WHERE status = 'expired')   AS expired,
          COUNT(*) FILTER (WHERE created_at >= CURRENT_DATE) AS today
        FROM orders
      `),
    ]);
    res.json({
      doors:   doors.rows[0],
      revenue: revenue.rows[0],
      orders:  orders.rows[0],
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to load dashboard' });
  }
});

module.exports = router;
