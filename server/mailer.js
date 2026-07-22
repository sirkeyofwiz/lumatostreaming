// Thin wrapper around Resend's HTTP API — no SDK needed, just fetch.
async function sendEmail({ to, subject, html }) {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    throw Object.assign(new Error('Email is not configured on this server.'), { code: 'NO_RESEND_KEY' });
  }
  // Without a verified sending domain in Resend, you can only send from
  // their shared test address (onboarding@resend.dev). Once you verify
  // your own domain there, set RESEND_FROM to something like
  // "LumatoStreaming <noreply@yourdomain.com>".
  const from = process.env.RESEND_FROM || 'LumatoStreaming <onboarding@resend.dev>';

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ from, to, subject, html }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw Object.assign(new Error(`Failed to send email (${res.status})`), { status: res.status, body });
  }
  return res.json();
}

module.exports = { sendEmail };
