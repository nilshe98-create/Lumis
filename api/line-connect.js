// api/line-connect.js
// POST {token, lineUserId} -> verifies the signed token (HMAC + 24h expiry), re-confirms
// the email still has an active subscription, then links line_user_id + email in
// line_subscribers so the daily horoscope can be delivered.
//
// The token is self-contained (no database lookup needed to validate it). The subscription
// row should already exist (gen-line-token ensured it), but as a final safety net we
// self-heal from Dodo's API here too if it's somehow missing.

const crypto = require('crypto');
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

const BASIC_SUB_PRODUCT = 'pdt_0NeitaqBccnHAKvtqDOA1';
const TOKEN_SECRET = process.env.CRON_SECRET || process.env.SUPABASE_SERVICE_KEY || 'lumis-fallback-secret';

function b64url(buf) {
  return Buffer.from(buf).toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function b64urlDecode(str) {
  str = String(str).replace(/-/g, '+').replace(/_/g, '/');
  while (str.length % 4) str += '=';
  return Buffer.from(str, 'base64');
}

// Verify a signed token. Returns { email } if valid + unexpired, else null.
function verifyToken(token) {
  if (!token || typeof token !== 'string' || token.indexOf('.') < 0) return null;
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [payload, sig] = parts;
  const expected = b64url(crypto.createHmac('sha256', TOKEN_SECRET).update(payload).digest());
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  let data;
  try { data = JSON.parse(b64urlDecode(payload).toString('utf8')); } catch (e) { return null; }
  if (!data || !data.email || !data.exp) return null;
  if (Date.now() > data.exp) return null;
  return data;
}

async function findActiveDodoSub(email) {
  try {
    const target = email.toLowerCase();
    const base = 'https://live.dodopayments.com/subscriptions';
    for (let page = 0; page < 5; page++) {
      const url = `${base}?status=active&page_size=100&page_number=${page}`;
      const r = await fetch(url, {
        headers: { Authorization: `Bearer ${process.env.DODO_API_KEY}` },
      });
      if (!r.ok) break;
      const json = await r.json();
      const items = (json && json.items) || [];
      for (const it of items) {
        const em = it.customer && it.customer.email;
        if (em && em.toLowerCase() === target && it.product_id === BASIC_SUB_PRODUCT) {
          return it;
        }
      }
      if (items.length < 100) break;
    }
  } catch (e) {
    console.error('findActiveDodoSub error:', e.message);
  }
  return null;
}

async function writeSubscriptionRow(email, sub) {
  await supabase.from('purchases').upsert([
    {
      user_email: email,
      chapter: 'subscription',
      subscription_id: sub.subscription_id || null,
      payment_id: JSON.stringify({
        paid_until: sub.next_billing_date || null,
        cancel_at_next_billing_date: !!sub.cancel_at_next_billing_date,
      }),
    },
  ], { onConflict: 'user_email,chapter' });
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { token, lineUserId } = req.body || {};
  if (!token || !lineUserId) return res.status(400).json({ error: 'Missing token or lineUserId' });

  try {
    const data = verifyToken(token);
    if (!data) return res.status(400).json({ error: '連結已過期或無效，請從付款頁面重新點擊' });
    const email = data.email;

    // Confirm subscription still active (row should exist; self-heal from Dodo if not)
    const { data: sub } = await supabase
      .from('purchases')
      .select('chapter')
      .eq('user_email', email)
      .eq('chapter', 'subscription');

    let hasSub = sub && sub.length > 0;
    if (!hasSub) {
      const dodoSub = await findActiveDodoSub(email);
      if (dodoSub) {
        await writeSubscriptionRow(email, dodoSub);
        hasSub = true;
      }
    }
    if (!hasSub) {
      return res.status(403).json({ error: '找不到有效的訂閱，請確認訂閱狀態' });
    }

    // Link the real LINE user ID to this email
    await supabase.from('line_subscribers').upsert(
      { line_user_id: lineUserId, email, active: true, linked_at: new Date().toISOString() },
      { onConflict: 'line_user_id' }
    );

    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error('line-connect error:', err);
    return res.status(500).json({ error: err.message });
  }
};
