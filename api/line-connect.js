// api/line-connect.js
// Single endpoint for the LINE LIFF magic-link flow. Handles two actions to stay under
// Vercel's Hobby-plan 12-function limit (this used to be two separate files):
//
//   POST { action: 'gen', email }
//     -> confirms the email has an active subscription (self-healing from Dodo's API if the
//        webhook hasn't written the row yet) and returns a signed, 24h, self-contained token.
//        Frontend builds the LIFF link: https://liff.line.me/{LIFF_ID}?token={token}
//
//   POST { action: 'link', token, lineUserId }
//     -> verifies the signed token (HMAC + expiry), re-confirms the subscription is active,
//        then links line_user_id + email in line_subscribers so the daily horoscope sends.
//
// The token is a signed HMAC blob (no database table needed — nothing to create, nothing to
// break on a missing table). The email is baked into the signed payload.

const crypto = require('crypto');
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

const BASIC_SUB_PRODUCT = 'pdt_0NeitaqBccnHAKvtqDOA1';
// Signing secret — reuse an existing server-only env var (never exposed to the browser).
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

function signToken(email) {
  const payload = b64url(JSON.stringify({ email, exp: Date.now() + 24 * 60 * 60 * 1000 }));
  const sig = b64url(crypto.createHmac('sha256', TOKEN_SECRET).update(payload).digest());
  return payload + '.' + sig;
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

// Ask Dodo directly whether this email has an active basic_sub subscription.
// Returns the subscription object if found, else null. Never throws (best-effort).
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
      if (items.length < 100) break; // last page reached
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

// Returns true if the email has an active subscription, self-healing from Dodo if needed.
async function ensureActiveSubscription(email) {
  const { data: sub } = await supabase
    .from('purchases')
    .select('chapter')
    .eq('user_email', email)
    .eq('chapter', 'subscription');
  if (sub && sub.length > 0) return true;

  const dodoSub = await findActiveDodoSub(email);
  if (dodoSub) {
    await writeSubscriptionRow(email, dodoSub);
    return true;
  }
  return false;
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const body = req.body || {};
  const action = body.action || (body.lineUserId ? 'link' : 'gen'); // sensible default

  try {
    // ---- ACTION: gen — issue a signed token for the LIFF link ----
    if (action === 'gen') {
      const { email } = body;
      if (!email) return res.status(400).json({ error: 'Missing email' });

      const ok = await ensureActiveSubscription(email);
      if (!ok) {
        // Webhook still catching up / no active sub yet — let the user retry in a moment.
        return res.status(200).json({ retry: true, error: 'subscription_not_ready' });
      }
      return res.status(200).json({ token: signToken(email) });
    }

    // ---- ACTION: link — verify token + link the LINE user ID ----
    if (action === 'link') {
      const { token, lineUserId } = body;
      if (!token || !lineUserId) return res.status(400).json({ error: 'Missing token or lineUserId' });

      const data = verifyToken(token);
      if (!data) return res.status(400).json({ error: '連結已過期或無效，請從付款頁面重新點擊' });
      const email = data.email;

      const ok = await ensureActiveSubscription(email);
      if (!ok) return res.status(403).json({ error: '找不到有效的訂閱，請確認訂閱狀態' });

      await supabase.from('line_subscribers').upsert(
        { line_user_id: lineUserId, email, active: true, linked_at: new Date().toISOString() },
        { onConflict: 'line_user_id' }
      );
      return res.status(200).json({ ok: true });
    }

    return res.status(400).json({ error: 'Unknown action' });
  } catch (err) {
    console.error('line-connect error:', err);
    // For the gen path, a soft retry is friendlier than a hard error.
    if (action === 'gen') return res.status(200).json({ retry: true, error: err.message });
    return res.status(500).json({ error: err.message });
  }
};
