// api/gen-line-token.js
// POST {email} -> returns a self-contained, signed, 24-hour token used in the LIFF magic
// link (https://liff.line.me/{LIFF_ID}?token=...). Tapping the link inside LINE lets us
// prove "this LINE user is this paying subscriber" with zero typing.
//
// Design notes (why this is robust):
//  - The token is a signed HMAC blob, NOT a database row. No table to create, nothing to
//    break on a missing table. The email is baked into the signed payload.
//  - We confirm the email actually has an active subscription before issuing a token. If
//    the Dodo webhook hasn't written the subscription row yet (race right after checkout)
//    OR the webhook is misconfigured, we self-heal by asking Dodo's API directly — Dodo is
//    the source of truth and is updated the instant checkout completes — and write the row
//    ourselves so everything downstream (daily cron, redemption) works.

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

function signToken(email) {
  const payload = b64url(JSON.stringify({ email, exp: Date.now() + 24 * 60 * 60 * 1000 }));
  const sig = b64url(crypto.createHmac('sha256', TOKEN_SECRET).update(payload).digest());
  return payload + '.' + sig;
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

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { email } = req.body || {};
  if (!email) return res.status(400).json({ error: 'Missing email' });

  try {
    // 1. Does the subscription row already exist? (normal case — webhook already fired)
    const { data: sub } = await supabase
      .from('purchases')
      .select('chapter')
      .eq('user_email', email)
      .eq('chapter', 'subscription');

    let hasSub = sub && sub.length > 0;

    // 2. If not, self-heal from Dodo (handles webhook delay / misconfiguration).
    if (!hasSub) {
      const dodoSub = await findActiveDodoSub(email);
      if (dodoSub) {
        await writeSubscriptionRow(email, dodoSub);
        hasSub = true;
      }
    }

    // 3. Still nothing? Tell the frontend to let the user retry in a moment.
    if (!hasSub) {
      return res.status(200).json({ retry: true, error: 'subscription_not_ready' });
    }

    // 4. Issue the signed token.
    return res.status(200).json({ token: signToken(email) });
  } catch (err) {
    console.error('gen-line-token error:', err);
    return res.status(200).json({ retry: true, error: err.message });
  }
};
