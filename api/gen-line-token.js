// api/gen-line-token.js
// POST {email} -> verifies the email has an active subscription -> returns a single-use,
// 24-hour token. This token is embedded in the LIFF magic link
// (https://liff.line.me/{LIFF_ID}?token=...) so that tapping it inside LINE can prove
// "this LINE user really is this paying subscriber" without the user typing anything.

const crypto = require('crypto');
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { email } = req.body || {};
  if (!email) return res.status(400).json({ error: 'Missing email' });

  try {
    // Confirm this email actually has an active subscription before issuing a token
    const { data: sub, error: subErr } = await supabase
      .from('purchases')
      .select('chapter')
      .eq('user_email', email)
      .eq('chapter', 'subscription');

    if (subErr) throw subErr;
    if (!sub || sub.length === 0) {
      return res.status(403).json({ error: 'No active subscription for this email' });
    }

    const token = crypto.randomBytes(24).toString('hex');
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

    const { error: insertErr } = await supabase.from('line_connect_tokens').insert({
      token,
      email,
      used: false,
      expires_at: expiresAt,
    });

    if (insertErr) throw insertErr;

    return res.status(200).json({ token });
  } catch (err) {
    console.error('gen-line-token error:', err);
    return res.status(500).json({ error: err.message });
  }
};
