const express = require('express');
const router  = express.Router();
const db      = require('../../config/db');
const { requireAdmin } = require('../middleware/auth');

// ── Locker hardware API client (replace with real supplier SDK) ───────────────
async function callLockerAPI(endpoint, payload) {
  if (!process.env.LOCKER_API_URL || process.env.LOCKER_API_URL.includes('your-locker')) {
    // STUB MODE — log the call, simulate success
    console.log(`[Locker API STUB] ${endpoint}`, payload);
    return { success: true, stub: true };
  }

  const response = await fetch(`${process.env.LOCKER_API_URL}${endpoint}`, {
    method:  'POST',
    headers: {
      'Content-Type':  'application/json',
      'Authorization': `Bearer ${process.env.LOCKER_API_KEY}`,
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    throw new Error(`Locker API error: ${response.status} ${await response.text()}`);
  }
  return response.json();
}

// ── GET /api/lockers/status ───────────────────────────────────────────────────
// Sync live status from hardware (called every 5 min or on demand)
router.get('/status', requireAdmin, async (req, res) => {
  try {
    // In stub mode, just return DB status
    if (!process.env.LOCKER_API_URL || process.env.LOCKER_API_URL.includes('your-locker')) {
      const result = await db.query(`
        SELECT l.door_number, l.status, l.access_code,
               b.model AS battery_model
        FROM lockers l
        LEFT JOIN batteries b ON b.id = l.battery_id
        ORDER BY l.door_number
      `);
      return res.json({ source: 'database', doors: result.rows });
    }

    // Real hardware sync
    const hwStatus = await callLockerAPI('/status/all', {});
    res.json({ source: 'hardware', doors: hwStatus });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch locker status' });
  }
});

// ── POST /api/lockers/reserve ─────────────────────────────────────────────────
// Tell hardware to assign access code to a door
router.post('/reserve', requireAdmin, async (req, res) => {
  const { door_number, access_code } = req.body;
  try {
    const result = await callLockerAPI('/reserve', { door_number, access_code });
    res.json(result);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to reserve locker door' });
  }
});

// ── POST /api/lockers/release ─────────────────────────────────────────────────
// Tell hardware to unlock and reset a door
router.post('/release', requireAdmin, async (req, res) => {
  const { door_number } = req.body;
  try {
    const result = await callLockerAPI('/release', { door_number });
    res.json(result);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to release locker door' });
  }
});

// ── POST /api/lockers/open ────────────────────────────────────────────────────
// Admin remote-open a door (e.g. customer locked out)
router.post('/open', requireAdmin, async (req, res) => {
  const { door_number } = req.body;
  try {
    const result = await callLockerAPI('/open', { door_number });
    await db.query(`
      INSERT INTO audit_log (entity, action, new_value, performed_by)
      VALUES ('locker', 'remote_open', $1, 'admin')
    `, [JSON.stringify({ door_number })]);
    res.json(result);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to open locker door' });
  }
});

module.exports = router;
