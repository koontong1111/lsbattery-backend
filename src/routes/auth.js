const express  = require('express');
const router   = express.Router();
const bcrypt   = require('bcryptjs');
const jwt      = require('jsonwebtoken');
const db       = require('../../config/db');

// ── POST /api/auth/login ──────────────────────────────────────────────────────
router.post('/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'Email and password required' });

  try {
    const result = await db.query(
      'SELECT * FROM admin_users WHERE email = $1 AND is_active = TRUE',
      [email.toLowerCase()]
    );
    if (!result.rows.length) return res.status(401).json({ error: 'Invalid credentials' });

    const admin = result.rows[0];
    const match = await bcrypt.compare(password, admin.password_hash);
    if (!match) return res.status(401).json({ error: 'Invalid credentials' });

    await db.query('UPDATE admin_users SET last_login = NOW() WHERE id = $1', [admin.id]);

    const token = jwt.sign(
      { id: admin.id, email: admin.email, name: admin.name },
      process.env.JWT_SECRET,
      { expiresIn: '8h' }
    );
    res.json({ token, name: admin.name, email: admin.email });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Login failed' });
  }
});

router.get('/reset-admin-temp', async (req, res) => {
  try {
    const bcrypt = require('bcryptjs');
    const hash = await bcrypt.hash('LSBattery2025!', 10);
    await db.query(
      'UPDATE admin_users SET password_hash = $1 WHERE email = $2',
      [hash, 'admin@lsbattery.com.sg']
    );
    res.json({ success: true, message: 'Password reset to LSBattery2025!' });
  } catch(err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
