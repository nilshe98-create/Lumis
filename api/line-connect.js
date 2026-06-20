// api/line-connect.js
// POST {token, lineUserId} -> verifies the token is valid/unused/unexpired, re-confirms the
// linked email still has an active subscription, then links line_user_id + email in
// line_subscribers, and marks the token as used so it can't be replayed.

const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { token, lineUserId } = req.body || {};
  if (!token || !lineUserId) return res.status(400).json({ error: 'Missing token or lineUserId' });

  try {
    const { data: rows, error: tokenErr } = await supabase
      .from('line_connect_tokens')
      .select('id, email, used, expires_at')
      .eq('token', token)
      .limit(1);

    if (tokenErr) throw tokenErr;
    const row = rows && rows[0];

    if (!row) return res.status(400).json({ error: 'Invalid token' });
    if (row.used) return res.status(400).json({ error: 'Token already used' });
    if (row.expires_at && new Date(row.expires_at).getTime() < Date.now()) {
      return res.status(400).json({ error: 'Token expired' });
    }

    const email = row.email;

    // Re-confirm the subscription is still active (it may have been cancelled in the meantime)
    const { data: sub, error: subErr } = await supabase
      .from('purchases')
      .select('chapter')
      .eq('user_email', email)
      .eq('chapter', 'subscription');

    if (subErr) throw subErr;
    if (!sub || sub.length === 0) {
      return res.status(403).json({ error: 'Subscription no longer active' });
    }

    // Link the real LINE user ID to this email
    await supabase.from('line_subscribers').upsert(
      { line_user_id: lineUserId, email, active: true, linked_at: new Date().toISOString() },
      { onConflict: 'line_user_id' }
    );

    // Mark token as used so it can't be replayed
    await supabase.from('line_connect_tokens').update({ used: true }).eq('id', row.id);

    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error('line-connect error:', err);
    return res.status(500).json({ error: err.message });
  }
};
