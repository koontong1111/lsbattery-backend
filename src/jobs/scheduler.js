const cron = require('node-cron');
const db   = require('../../config/db');
const { sendWhatsApp, sendEmail } = require('../services/notifications');

function startJobs() {
  console.log('⏰ Starting background jobs...');

  // ── Every hour: expire overdue reservations + trigger 80% refund ────────────
  cron.schedule('0 * * * *', async () => {
    console.log('[Job] Checking expired reservations...');
    try {
      const expired = await db.query(`
        SELECT o.id, o.reference, o.amount_paid,
               c.mobile, c.email,
               b.model AS battery_model, b.brand,
               l.id AS locker_id
        FROM orders o
        JOIN customers c ON c.id = o.customer_id
        JOIN batteries b ON b.id = o.battery_id
        JOIN lockers l   ON l.id = o.locker_id
        WHERE o.status = 'paid'
          AND o.hold_expires_at < NOW()
      `);

      for (const order of expired.rows) {
        const client = await db.connect();
        try {
          await client.query('BEGIN');

          // Mark order expired
          await client.query(
            `UPDATE orders SET status = 'expired', expired_at = NOW() WHERE id = $1`,
            [order.id]
          );

          // Free the locker door
          await client.query(
            `UPDATE lockers SET status = 'available', access_code = NULL,
             reserved_until = NULL WHERE id = $1`,
            [order.locker_id]
          );

          // Trigger 80% refund via Stripe
          const paymentRes = await client.query(
            `SELECT stripe_payment_id, amount FROM payments
             WHERE order_id = $1 AND status = 'succeeded'`,
            [order.id]
          );

          let refundAmount = order.amount_paid * 0.80;

          if (paymentRes.rows.length && paymentRes.rows[0].stripe_payment_id) {
            const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
            try {
              const refund = await stripe.refunds.create({
                payment_intent: paymentRes.rows[0].stripe_payment_id,
                amount: Math.round(refundAmount * 100),
              });
              await client.query(
                `UPDATE payments SET status = 'refunded', refund_id = $1 WHERE order_id = $2`,
                [refund.id, order.id]
              );
            } catch (stripeErr) {
              console.error(`Stripe refund failed for ${order.reference}:`, stripeErr.message);
            }
          }

          await client.query(
            `UPDATE orders SET refund_amount = $1 WHERE id = $2`,
            [refundAmount, order.id]
          );

          await client.query(`
            INSERT INTO audit_log (entity, entity_id, action, performed_by)
            VALUES ('order', $1, 'expired', 'system')
          `, [order.id]);

          await client.query('COMMIT');
          console.log(`[Expiry] Order ${order.reference} expired, refund SGD ${refundAmount.toFixed(2)} issued`);

          // Notify customer
          await sendWhatsApp(order.mobile, 'expired', {
            orderRef:     order.reference,
            refundAmount: refundAmount.toFixed(2),
          });

        } catch (err) {
          await client.query('ROLLBACK');
          console.error(`Error expiring order ${order.reference}:`, err);
        } finally {
          client.release();
        }
      }

      if (expired.rows.length) {
        console.log(`[Job] Expired ${expired.rows.length} reservation(s)`);
      }

    } catch (err) {
      console.error('[Job] Expiry check failed:', err);
    }
  });

  // ── Every 30 min: send WhatsApp reminders 2h before expiry ─────────────────
  cron.schedule('*/30 * * * *', async () => {
    try {
      const upcoming = await db.query(`
        SELECT o.id, o.reference, o.access_code,
               o.hold_expires_at,
               c.mobile, c.email,
               b.model AS battery_model, b.brand,
               loc.name AS location_name,
               n.id AS already_notified
        FROM orders o
        JOIN customers c  ON c.id = o.customer_id
        JOIN batteries b  ON b.id = o.battery_id
        JOIN lockers l    ON l.id = o.locker_id
        JOIN locations loc ON loc.id = l.location_id
        LEFT JOIN notifications n
          ON n.order_id = o.id AND n.type = 'reminder'
        WHERE o.status = 'paid'
          AND o.hold_expires_at BETWEEN NOW() AND NOW() + INTERVAL '2.5 hours'
          AND n.id IS NULL
      `);

      for (const order of upcoming.rows) {
        await sendWhatsApp(order.mobile, 'reminder', {
          brand:        order.brand,
          batteryModel: order.battery_model,
          locationName: order.location_name,
          accessCode:   order.access_code,
          orderRef:     order.reference,
          holdExpiry:   new Date(order.hold_expires_at).toLocaleString('en-SG'),
        });

        await db.query(`
          INSERT INTO notifications (order_id, type, channel, recipient, status)
          VALUES ($1, 'reminder', 'whatsapp', $2, 'sent')
        `, [order.id, order.mobile]);

        console.log(`[Reminder] Sent to ${order.mobile} for order ${order.reference}`);
      }
    } catch (err) {
      console.error('[Job] Reminder job failed:', err);
    }
  });

  // ── Every night at 8pm: email admin daily summary ──────────────────────────
  cron.schedule('0 20 * * *', async () => {
    try {
      const summary = await db.query(`
        SELECT
          COUNT(*) FILTER (WHERE status = 'paid')      AS active_orders,
          COUNT(*) FILTER (WHERE status = 'collected') AS collected_today,
          COUNT(*) FILTER (WHERE status = 'expired')   AS expired_today,
          SUM(amount_paid) FILTER (WHERE status IN ('paid','collected')
            AND created_at >= CURRENT_DATE) AS revenue_today
        FROM orders
        WHERE created_at >= CURRENT_DATE
      `);

      const stock = await db.query(`
        SELECT COUNT(*) FILTER (WHERE status = 'available') AS available,
               COUNT(*) FILTER (WHERE status = 'reserved')  AS reserved
        FROM lockers
      `);

      const s = summary.rows[0];
      const st = stock.rows[0];

      await sendEmail(process.env.ADMIN_EMAIL, 'confirmation', {
        orderRef:     'DAILY REPORT',
        batteryModel: `Active: ${s.active_orders} | Collected: ${s.collected_today} | Expired: ${s.expired_today}`,
        locationName: `Doors available: ${st.available} | Reserved: ${st.reserved}`,
        address:      '46 Kian Teck Road, Singapore 628786',
        collectionDate: new Date().toDateString(),
        holdExpiry:   `Revenue today: SGD ${parseFloat(s.revenue_today || 0).toFixed(2)}`,
      });

      console.log('[Job] Daily summary email sent');
    } catch (err) {
      console.error('[Job] Daily summary failed:', err);
    }
  });

  console.log('✅ Jobs scheduled: expiry check (hourly), reminders (every 30min), daily report (8pm)');
}

module.exports = { startJobs };
