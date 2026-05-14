require('dotenv').config();
const twilio    = require('twilio');
const nodemailer = require('nodemailer');

const twilioClient = twilio(
  process.env.TWILIO_ACCOUNT_SID,
  process.env.TWILIO_AUTH_TOKEN
);

// ── WHATSAPP MESSAGES ─────────────────────────────────────────────────────────
const WA_TEMPLATES = {

  confirmation: (d) => `
✅ *LS Battery — Order Confirmed!*

Hi! Your battery reservation is confirmed.

🔋 Battery: *${d.brand} ${d.batteryModel}*
📍 Location: *${d.locationName}*
📅 Collect by: *${d.collectionDate}*
🔑 Locker code: *${d.accessCode}*
📦 Order ref: *${d.orderRef}*
💰 Amount paid: *SGD ${d.price}*

⏰ Hold expires: ${d.holdExpiry}
If not collected, a refund minus 20% admin fee will be issued.

♻️ After installing — return your old battery to the *same locker slot*.

Need help? Call/WhatsApp +65 6358 4646
`.trim(),

  reminder: (d) => `
⏰ *LS Battery — Reminder*

Your battery hold expires in *2 hours*!

🔋 ${d.brand} ${d.batteryModel}
📍 ${d.locationName}
🔑 Code: *${d.accessCode}*
📦 Ref: ${d.orderRef}

Please collect before ${d.holdExpiry} to avoid a 20% admin fee on your refund.

Need help? +65 6358 4646
`.trim(),

  expired: (d) => `
❌ *LS Battery — Reservation Expired*

Your reservation *${d.orderRef}* has expired.

A refund of *SGD ${d.refundAmount}* (80% of payment) has been processed to your original payment method. Please allow 5–10 business days.

Questions? Call/WhatsApp +65 6358 4646
`.trim(),

};

async function sendWhatsApp(mobile, type, data) {
  if (!process.env.TWILIO_ACCOUNT_SID || process.env.TWILIO_ACCOUNT_SID === 'REPLACE_ME') {
    console.log(`[WhatsApp SKIPPED — Twilio not configured] To: ${mobile}, Type: ${type}`);
    return;
  }
  // Normalise Singapore number
  const to = mobile.startsWith('+') ? mobile : `+65${mobile}`;
  const body = WA_TEMPLATES[type]?.(data) || JSON.stringify(data);
  try {
    await twilioClient.messages.create({
      from: process.env.TWILIO_WHATSAPP_FROM,
      to:   `whatsapp:${to}`,
      body,
    });
    console.log(`📱 WhatsApp [${type}] sent to ${to}`);
  } catch (err) {
    console.error(`WhatsApp send failed to ${to}:`, err.message);
    throw err;
  }
}

// ── EMAIL MESSAGES ────────────────────────────────────────────────────────────
const transporter = nodemailer.createTransport({
  service: 'SendGrid',
  auth: {
    user: 'apikey',
    pass: process.env.SENDGRID_API_KEY,
  },
});

async function sendEmail(to, type, data) {
  if (!process.env.SENDGRID_API_KEY || process.env.SENDGRID_API_KEY === 'REPLACE_ME') {
    console.log(`[Email SKIPPED — SendGrid not configured] To: ${to}, Type: ${type}`);
    return;
  }
  const subjects = {
    confirmation: `LS Battery — Order Confirmed (${data.orderRef})`,
    reminder:     `LS Battery — Collect your battery before ${data.holdExpiry}`,
    expired:      `LS Battery — Your reservation has expired`,
  };
  const html = buildEmailHtml(type, data);
  try {
    await transporter.sendMail({
      from:    `"LS Battery" <${process.env.EMAIL_FROM}>`,
      to,
      subject: subjects[type] || 'LS Battery notification',
      html,
    });
    console.log(`📧 Email [${type}] sent to ${to}`);
  } catch (err) {
    console.error(`Email send failed to ${to}:`, err.message);
    throw err;
  }
}

function buildEmailHtml(type, d) {
  const base = (content) => `
  <!DOCTYPE html><html><body style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:20px;color:#0d3333">
  <div style="background:#0abfbf;padding:20px;border-radius:10px 10px 0 0;text-align:center">
    <h1 style="color:#fff;margin:0">LS Battery</h1>
  </div>
  <div style="background:#f0fafa;padding:24px;border-radius:0 0 10px 10px;border:1px solid #dff2f2">
    ${content}
    <hr style="border:none;border-top:1px solid #dff2f2;margin:20px 0">
    <p style="font-size:12px;color:#5a8f8f">LS Battery Pte Ltd · 46 Kian Teck Road, Singapore 628786<br>
    +65 6358 4646 · sales@lsbattery.com.sg · UEN: 200408291W</p>
  </div></body></html>`;

  if (type === 'confirmation') return base(`
    <h2>✅ Order Confirmed</h2>
    <table style="width:100%;border-collapse:collapse">
      <tr><td style="padding:8px;color:#5a8f8f">Order Ref</td><td style="padding:8px;font-weight:bold">${d.orderRef}</td></tr>
      <tr style="background:#fff"><td style="padding:8px;color:#5a8f8f">Battery</td><td style="padding:8px">${d.batteryModel}</td></tr>
      <tr><td style="padding:8px;color:#5a8f8f">Location</td><td style="padding:8px">${d.locationName}<br><small>${d.address}</small></td></tr>
      <tr style="background:#fff"><td style="padding:8px;color:#5a8f8f">Collect by</td><td style="padding:8px">${d.collectionDate}</td></tr>
      <tr><td style="padding:8px;color:#5a8f8f">Hold expires</td><td style="padding:8px;color:#d97706">${d.holdExpiry}</td></tr>
    </table>
    <div style="background:#0abfbf;padding:20px;border-radius:10px;text-align:center;margin-top:20px">
      <p style="color:#fff;margin:0 0 8px">Your locker access code</p>
      <h1 style="color:#fff;letter-spacing:10px;margin:0">${d.accessCode}</h1>
    </div>
    <p style="font-size:13px;color:#5a8f8f;margin-top:16px">♻️ After installing your new battery, please return the old one to the same locker slot.</p>
  `);

  return base(`<p>Notification type: ${type}</p><pre>${JSON.stringify(d, null, 2)}</pre>`);
}

module.exports = { sendWhatsApp, sendEmail };
