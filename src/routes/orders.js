const express  = require('express');
const router   = express.Router();
const db       = require('../../config/db');
const { requireAdmin } = require('../middleware/auth');
const { generateOrderRef, generateAccessCode } = require('../services/helpers');
const { sendWhatsApp, sendEmail } = require('../services/notifications');

// ── POST /api/orders ──────────────────────────────────────────────────────────
// Called after Stripe payment succeeds (via webhook) — creates the full order
router.post('/', async (req, res) => {
  const { battery_model, location_id, collection_date,
          customer_email, customer_mobile, stripe_payment_id, amount_paid } = req.body;

  if (!battery_model || !collection_date || !customer_mobile || !stripe_payment_id) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  const client = await db.connect();
  try {
    await client.query('BEGIN');

    // 1. Find an available locker door with this battery
    const lockerResult = await client.query(`
      SELECT l.id, l.door_number
      FROM lockers l
      JOIN batteries b ON b.id = l.battery_id
      WHERE b.model      = $1
        AND l.location_id = $2
        AND l.status      = 'available'
      LIMIT 1
      FOR UPDATE SKIP LOCKED
    `, [battery_model.toUpperCase(), location_id]);

    if (!lockerResult.rows.length) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'No available lockers for this battery. Please choose another location.' });
    }

    const locker     = lockerResult.rows[0];
    const orderRef   = generateOrderRef();
    const accessCode = generateAccessCode();
    const holdExpiry = new Date(collection_date);
    holdExpiry.setDate(holdExpiry.getDate() + 1); // 24h hold

    // 2. Upsert customer
    const custResult = await client.query(`
      INSERT INTO customers (email, mobile)
      VALUES ($1, $2)
      ON CONFLICT (email) DO UPDATE SET mobile = $2
      RETURNING id
    `, [customer_email || null, customer_mobile]);
    const customerId = custResult.rows[0].id;

    // 3. Get battery id
    const batResult = await client.query(
      'SELECT id, price FROM batteries WHERE model = $1', [battery_model.toUpperCase()]
    );
    const battery = batResult.rows[0];

    // 4. Create order
    const orderResult = await client.query(`
      INSERT INTO orders
        (reference, customer_id, locker_id, battery_id,
         collection_date, hold_expires_at, access_code,
         status, amount_paid)
      VALUES ($1,$2,$3,$4,$5,$6,$7,'paid',$8)
      RETURNING *
    `, [orderRef, customerId, locker.id, battery.id,
        collection_date, holdExpiry.toISOString(),
        accessCode, amount_paid || battery.price]);

    // 5. Lock the locker door
    await client.query(`
      UPDATE lockers
      SET status = 'reserved', access_code = $1, reserved_until = $2
      WHERE id = $3
    `, [accessCode, holdExpiry.toISOString(), locker.id]);

    // 6. Log payment
    await client.query(`
      INSERT INTO payments (order_id, stripe_payment_id, amount, status)
      VALUES ($1, $2, $3, 'succeeded')
    `, [orderResult.rows[0].id, stripe_payment_id, amount_paid || battery.price]);

    // 7. Audit log
    await client.query(`
      INSERT INTO audit_log (entity, entity_id, action, new_value)
      VALUES ('order', $1, 'created', $2)
    `, [orderResult.rows[0].id, JSON.stringify({ orderRef, battery_model, accessCode })]);

    await client.query('COMMIT');

    const order = orderResult.rows[0];

    // 8. Send notifications (non-blocking)
    setImmediate(async () => {
      try {
        // Get full details for notification
        const detail = await db.query(`
          SELECT o.*, b.model, b.brand, b.fits,
                 loc.name AS location_name, loc.address
          FROM orders o
          JOIN batteries b ON b.id = o.battery_id
          JOIN lockers l   ON l.id = o.locker_id
          JOIN locations loc ON loc.id = l.location_id
          WHERE o.id = $1
        `, [order.id]);
        const d = detail.rows[0];

        await sendWhatsApp(customer_mobile, 'confirmation', {
          orderRef, accessCode,
          batteryModel: d.model,
          brand: d.brand,
          locationName: d.location_name,
          collectionDate: new Date(collection_date).toDateString(),
          holdExpiry: holdExpiry.toDateString(),
          price: amount_paid || battery.price,
        });

        if (customer_email) {
          await sendEmail(customer_email, 'confirmation', {
            orderRef, accessCode,
            batteryModel: d.model,
            locationName: d.location_name,
            address: d.address,
            collectionDate: new Date(collection_date).toDateString(),
            holdExpiry: holdExpiry.toDateString(),
          });
        }

        await db.query(
          `INSERT INTO notifications (order_id, type, channel, recipient, status)
           VALUES ($1,'confirmation','whatsapp',$2,'sent')`,
          [order.id, customer_mobile]
        );
      } catch (notifyErr) {
        console.error('Notification failed:', notifyErr);
      }
    });

    res.status(201).json({
      success:     true,
      orderRef,
      accessCode,
      doorNumber:  locker.door_number,
      holdExpires: holdExpiry.toISOString(),
    });

  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Order creation error:', err);
    res.status(500).json({ error: 'Order creation failed' });
  } finally {
    client.release();
  }
});

// ── GET /api/orders/:ref ──────────────────────────────────────────────────────
router.get('/:ref', async (req, res) => {
  try {
    const result = await db.query(`
      SELECT
        o.reference, o.status, o.collection_date,
        o.hold_expires_at, o.access_code,
        o.amount_paid, o.created_at,
        b.model AS battery_model, b.brand, b.fits,
        l.door_number,
        loc.name AS location_name, loc.address, loc.hours,
        c.email, c.mobile
      FROM orders o
      JOIN batteries b  ON b.id  = o.battery_id
      JOIN lockers l    ON l.id  = o.locker_id
      JOIN locations loc ON loc.id = l.location_id
      JOIN customers c  ON c.id  = o.customer_id
      WHERE o.reference = $1
    `, [req.params.ref.toUpperCase()]);
    if (!result.rows.length) return res.status(404).json({ error: 'Order not found' });
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch order' });
  }
});

// ── PATCH /api/orders/:ref/collect ────────────────────────────────────────────
// Called when customer physically collects the battery
router.patch('/:ref/collect', requireAdmin, async (req, res) => {
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const orderRes = await client.query(
      `SELECT * FROM orders WHERE reference = $1 AND status = 'paid'`,
      [req.params.ref.toUpperCase()]
    );
    if (!orderRes.rows.length)
      return res.status(404).json({ error: 'Order not found or already collected' });

    const order = orderRes.rows[0];

    await client.query(
      `UPDATE orders SET status = 'collected', collected_at = NOW() WHERE id = $1`,
      [order.id]
    );
    await client.query(
      `UPDATE lockers SET status = 'available', access_code = NULL,
       reserved_until = NULL, battery_id = NULL WHERE id = $1`,
      [order.locker_id]
    );
    await client.query(`
      INSERT INTO audit_log (entity, entity_id, action, performed_by)
      VALUES ('order', $1, 'collected', 'admin')
    `, [order.id]);

    await client.query('COMMIT');
    res.json({ success: true, message: 'Order marked as collected' });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    res.status(500).json({ error: 'Failed to mark as collected' });
  } finally {
    client.release();
  }
});

// ── GET /api/orders (admin) ───────────────────────────────────────────────────
router.get('/', requireAdmin, async (req, res) => {
  const { status, limit = 50, offset = 0 } = req.query;
  try {
    const result = await db.query(`
      SELECT
        o.reference, o.status, o.collection_date,
        o.hold_expires_at, o.amount_paid, o.created_at,
        b.model AS battery_model,
        l.door_number,
        c.mobile, c.email
      FROM orders o
      JOIN batteries b  ON b.id = o.battery_id
      JOIN lockers l    ON l.id = o.locker_id
      JOIN customers c  ON c.id = o.customer_id
      WHERE ($1::text IS NULL OR o.status = $1)
      ORDER BY o.created_at DESC
      LIMIT $2 OFFSET $3
    `, [status || null, limit, offset]);
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch orders' });
  }
});

module.exports = router;
