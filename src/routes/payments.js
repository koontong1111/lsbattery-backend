const express = require('express');
const router  = express.Router();
const stripe  = require('stripe')(process.env.STRIPE_SECRET_KEY);
const db      = require('../../config/db');

// ── POST /api/payments/stripe/intent ─────────────────────────────────────────
// Step 1: Create a payment intent (called when customer clicks Pay)
router.post('/stripe/intent', async (req, res) => {
  const { battery_model, customer_email, customer_mobile,
          location_id, collection_date } = req.body;

  if (!battery_model || !customer_mobile) {
    return res.status(400).json({ error: 'battery_model and customer_mobile are required' });
  }

  try {
    // Get battery price
    const batResult = await db.query(
      'SELECT id, model, brand, price FROM batteries WHERE model = $1 AND is_active = TRUE',
      [battery_model.toUpperCase()]
    );
    if (!batResult.rows.length)
      return res.status(404).json({ error: 'Battery model not found' });

    const battery = batResult.rows[0];
    const amountCents = Math.round(battery.price * 100); // Stripe uses cents

    // Create Stripe PaymentIntent
    const paymentIntent = await stripe.paymentIntents.create({
      amount:   amountCents,
      currency: 'sgd',
      payment_method_types: ['card', 'paynow'],
      metadata: {
        battery_model,
        location_id:     String(location_id),
        collection_date,
        customer_mobile,
        customer_email:  customer_email || '',
      },
      description: `LS Battery — ${battery.brand} ${battery.model}`,
      receipt_email: customer_email || undefined,
    });

    res.json({
      clientSecret:    paymentIntent.client_secret,
      paymentIntentId: paymentIntent.id,
      amount:          battery.price,
      currency:        'SGD',
      batteryModel:    battery.model,
      brand:           battery.brand,
    });

  } catch (err) {
    console.error('Stripe intent error:', err);
    res.status(500).json({ error: 'Failed to create payment intent' });
  }
});

// ── POST /api/payments/stripe/webhook ────────────────────────────────────────
// Step 2: Stripe calls this after payment — triggers order creation
router.post('/stripe/webhook', async (req, res) => {
  const sig = req.headers['stripe-signature'];
  let event;

  try {
    event = stripe.webhooks.constructEvent(
      req.body,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (err) {
    console.error('Webhook signature failed:', err.message);
    return res.status(400).json({ error: `Webhook error: ${err.message}` });
  }

  // ── payment_intent.succeeded ──────────────────────────────────────────────
  if (event.type === 'payment_intent.succeeded') {
    const pi = event.data.object;
    const {
      battery_model, location_id, collection_date,
      customer_mobile, customer_email,
    } = pi.metadata;

    try {
      // Check order doesn't already exist (idempotency)
      const existing = await db.query(
        `SELECT id FROM payments WHERE stripe_payment_id = $1`,
        [pi.id]
      );
      if (existing.rows.length) {
        console.log('Webhook already processed:', pi.id);
        return res.json({ received: true });
      }

      // Call orders route logic directly
      const axios = require('axios'); // or inline the order creation logic
      await fetch(`http://localhost:${process.env.PORT || 3000}/api/orders`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          battery_model,
          location_id:       parseInt(location_id),
          collection_date,
          customer_mobile,
          customer_email,
          stripe_payment_id: pi.id,
          amount_paid:       pi.amount / 100,
        }),
      });

      console.log(`✅ Order created for payment ${pi.id}`);
    } catch (err) {
      console.error('Order creation after webhook failed:', err);
      // Don't return 500 — Stripe will retry
    }
  }

  // ── payment_intent.payment_failed ────────────────────────────────────────
  if (event.type === 'payment_intent.payment_failed') {
    const pi = event.data.object;
    console.log(`❌ Payment failed: ${pi.id} — ${pi.last_payment_error?.message}`);

    try {
      await db.query(`
        INSERT INTO payments (stripe_payment_id, amount, status, failure_reason, order_id)
        VALUES ($1, $2, 'failed', $3, NULL)
        ON CONFLICT (stripe_payment_id) DO NOTHING
      `, [
        pi.id,
        pi.amount / 100,
        pi.last_payment_error?.message || 'Unknown error',
      ]);
    } catch (err) {
      console.error('Failed to log payment failure:', err);
    }
  }

  res.json({ received: true });
});

// ── POST /api/payments/refund ─────────────────────────────────────────────────
// Admin: issue 80% refund for expired uncollected order
router.post('/refund', async (req, res) => {
  const { order_reference } = req.body;
  if (!order_reference) return res.status(400).json({ error: 'order_reference required' });

  try {
    const orderRes = await db.query(`
      SELECT o.*, p.stripe_payment_id, p.amount
      FROM orders o
      JOIN payments p ON p.order_id = o.id
      WHERE o.reference = $1 AND o.status = 'expired'
        AND p.status = 'succeeded'
    `, [order_reference.toUpperCase()]);

    if (!orderRes.rows.length)
      return res.status(404).json({ error: 'Eligible order not found' });

    const order = orderRes.rows[0];
    const refundAmount = Math.round(order.amount * 0.80 * 100); // 80% refund in cents

    const refund = await stripe.refunds.create({
      payment_intent: order.stripe_payment_id,
      amount: refundAmount,
      reason: 'requested_by_customer',
    });

    await db.query(`
      UPDATE orders SET status = 'refunded', refund_amount = $1 WHERE id = $2
    `, [refundAmount / 100, order.id]);

    await db.query(`
      UPDATE payments SET status = 'refunded', refund_id = $1 WHERE order_id = $2
    `, [refund.id, order.id]);

    res.json({
      success:      true,
      refundId:     refund.id,
      refundAmount: refundAmount / 100,
      message:      `Refund of SGD ${(refundAmount / 100).toFixed(2)} issued (80% of original payment, 20% admin fee retained)`,
    });

  } catch (err) {
    console.error('Refund error:', err);
    res.status(500).json({ error: 'Refund failed: ' + err.message });
  }
});

module.exports = router;
