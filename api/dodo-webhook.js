// api/dodo-webhook.js
// Receives payment webhooks from Dodo Payments.
//
// PRODUCT IDS ARE NO LONGER HARDCODED — products are matched BY NAME from the
// live Dodo product list (same rule as dodo-checkout.js). Keep these keywords
// in product names: "Chapter 2".."Chapter 9", "Daily"/"Horoscope", "Soulmate",
// "Star", "All".
// The bundle now unlocks ALL chapters 2-9 (matches the NT$600 全部九章 offer).

const { createClient } = require('@supabase/supabase-js');

// Webhook signature verification (Standard Webhooks — what Dodo uses).
// Loaded defensively: if the package is missing we fall back to the previous behaviour
// instead of 500-ing on every payment. Verification only ENFORCES when
// DODO_WEBHOOK_SECRET is set in Vercel, so uploading this file alone changes nothing.
let StandardWebhook = null;
try { ({ Webhook: StandardWebhook } = require('standardwebhooks')); } catch (e) { StandardWebhook = null; }

function verifyDodoSignature(req) {
  const secret = process.env.DODO_WEBHOOK_SECRET;
  if (!secret) return { ok: true, mode: 'unverified_no_secret' };
  if (!StandardWebhook) return { ok: true, mode: 'unverified_no_library' };
  try {
    const wh = new StandardWebhook(secret);
    wh.verify(JSON.stringify(req.body), {
      'webhook-id': req.headers['webhook-id'],
      'webhook-signature': req.headers['webhook-signature'],
      'webhook-timestamp': req.headers['webhook-timestamp'],
    });
    return { ok: true, mode: 'verified' };
  } catch (e) {
    return { ok: false, mode: 'invalid_signature', error: e.message };
  }
}

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

const DODO_API = 'https://live.dodopayments.com';

function classify(name) {
  const n = String(name || '').toLowerCase();
  const ch = n.match(/chapter\s*([2-9])/);
  if (ch) return 'chapter' + ch[1];
  if (n.includes('daily') || n.includes('horoscope')) return 'basic_sub';
  if (n.includes('soulmate')) return 'soulmate';
  if (n.includes('star')) return 'starchild';
  if (n.includes('all')) return 'bundle';
  return null;
}

// productId -> feature key, from the live product list, cached 5 min
let _cache = { map: null, ts: 0 };
async function getFeatureMap() {
  if (_cache.map && Date.now() - _cache.ts < 5 * 60 * 1000) return _cache.map;
  const map = {};
  for (let page = 0; page < 5; page++) {
    const r = await fetch(`${DODO_API}/products?page_size=100&page_number=${page}`, {
      headers: { Authorization: `Bearer ${process.env.DODO_API_KEY}` },
    });
    if (!r.ok) break;
    const json = await r.json();
    const items = (json && json.items) || [];
    for (const it of items) {
      const key = classify(it.name);
      if (key) map[it.product_id] = key; // include archived too: old payments may still fire events
    }
    if (items.length < 100) break;
  }
  _cache = { map, ts: Date.now() };
  return map;
}

async function featureOf(productId) {
  if (!productId) return null;
  const map = await getFeatureMap();
  return map[productId] || null;
}

// Per-use features (soulmate, starchild): each successful payment adds ONE credit.
// Stored as chapter='soulmate_credits' / 'starchild_credits' with { count } in payment_id.
async function addUseCredit(email, feature) {
  const row = feature + '_credits';
  const { data: existing } = await supabase
    .from('purchases')
    .select('payment_id')
    .eq('user_email', email).eq('chapter', row).limit(1);
  let count = 0;
  if (existing && existing.length) {
    try { count = parseInt(JSON.parse(existing[0].payment_id).count) || 0; } catch(e) { count = 0; }
  }
  count += 1;
  await supabase.from('purchases').upsert(
    { user_email: email, chapter: row, payment_id: JSON.stringify({ count }) },
    { onConflict: 'user_email,chapter' }
  );
}

async function unlockChapter(email, chapter, paymentId) {
  // Soulmate & Star Child are per-use: grant a credit instead of a permanent unlock
  if (chapter === 'soulmate' || chapter === 'starchild') {
    await addUseCredit(email, chapter);
    return;
  }
  if (chapter === 'bundle') {
    // Bundle unlocks ALL chapters 2-9 (NT$600 全部九章)
    const rows = [];
    for (let c = 2; c <= 9; c++) {
      rows.push({ user_email: email, chapter: 'chapter' + c, payment_id: paymentId });
    }
    await supabase.from('purchases').upsert(rows, { onConflict: 'user_email,chapter' });
  } else {
    await supabase.from('purchases').upsert([
      { user_email: email, chapter, payment_id: paymentId },
    ], { onConflict: 'user_email,chapter' });
  }
}

// Store subscription access + metadata (paid_until, cancel-at-period-end flag) as JSON
// inside the payment_id column of the 'subscription' purchases row.
async function upsertSubscriptionAccess(email, subscriptionId, nextBillingDate, cancelAtNext) {
  await supabase.from('purchases').upsert([
    {
      user_email: email,
      chapter: 'subscription',
      subscription_id: subscriptionId || null,
      payment_id: JSON.stringify({
        paid_until: nextBillingDate || null,
        cancel_at_next_billing_date: !!cancelAtNext,
      }),
    },
  ], { onConflict: 'user_email,chapter' });
}

// Subscription is truly over — remove access AND stop their daily LINE messages
async function revokeSubscriptionAccess(email) {
  await supabase.from('purchases').delete()
    .eq('user_email', email).eq('chapter', 'subscription');
  await supabase.from('line_subscribers')
    .update({ active: false }).eq('email', email);
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  // Reject forged payment events. Without this, anyone who learns the webhook URL could
  // POST a fake "payment.succeeded" and unlock paid content for free.
  const sig = verifyDodoSignature(req);
  if (!sig.ok) {
    console.error('Dodo webhook REJECTED:', sig.mode, sig.error || '');
    return res.status(401).json({ error: 'Invalid signature' });
  }
  if (sig.mode !== 'verified') console.warn('Dodo webhook accepted WITHOUT verification:', sig.mode);

  const event = req.body;

  try {
    const eventType = event.type;
    console.log('Dodo webhook event:', eventType);

    // One-time payment succeeded
    if (eventType === 'payment.succeeded') {
      const payment = event.data;
      const email = payment.customer?.email;
      const productId = payment.product_cart?.[0]?.product_id;
      const chapter = await featureOf(productId);
      if (email && chapter) await unlockChapter(email, chapter, payment.payment_id);
    }

    // Subscription activated or renewed — grant/extend access.
    // 'active' also fires during the 7-day trial, so trial users get access immediately.
    if (
      eventType === 'subscription.active' ||
      eventType === 'subscription.activated' ||
      eventType === 'subscription.renewed'
    ) {
      const sub = event.data;
      const email = sub.customer?.email;
      if (email && (await featureOf(sub.product_id)) === 'basic_sub') {
        await upsertSubscriptionAccess(
          email,
          sub.subscription_id,
          sub.next_billing_date,
          sub.cancel_at_next_billing_date
        );
      }
    }

    // Subscription updated — fires on ANY field change, most importantly when the user
    // cancels (cancel_at_next_billing_date becomes true). We sync that flag + the latest
    // next_billing_date but only touch rows for subscribers who already have access,
    // so we don't accidentally create one from an unrelated update.
    if (eventType === 'subscription.updated') {
      const sub = event.data;
      const email = sub.customer?.email;
      if (email && (await featureOf(sub.product_id)) === 'basic_sub') {
        const { data: existing } = await supabase
          .from('purchases')
          .select('chapter')
          .eq('user_email', email).eq('chapter', 'subscription');
        if (existing && existing.length > 0) {
          await upsertSubscriptionAccess(
            email,
            sub.subscription_id,
            sub.next_billing_date,
            sub.cancel_at_next_billing_date
          );
        }
      }
    }

    // Subscription truly over (period ended after cancellation, or expired outright) —
    // revoke access AND stop their daily LINE messages.
    if (
      eventType === 'subscription.cancelled' ||
      eventType === 'subscription.canceled' ||
      eventType === 'subscription.expired'
    ) {
      const sub = event.data;
      const email = sub.customer?.email;
      if (email && (await featureOf(sub.product_id)) === 'basic_sub') {
        await revokeSubscriptionAccess(email);
      }
    }

    res.status(200).json({ ok: true });
  } catch (err) {
    console.error('Webhook error:', err);
    res.status(500).json({ error: err.message });
  }
};
