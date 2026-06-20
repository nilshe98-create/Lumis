// api/dodo-webhook.js
// Receives payment webhooks from Dodo Payments

const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

const PRODUCT_CHAPTERS = {
  'pdt_0NeisQEQvTp8XraWPadOS': 'chapter2',
  'pdt_0NeisdwJUSDrFgwNoE3M0': 'chapter3',
  'pdt_0NeiskUuoq1SbWCBmEVys': 'chapter4',
  'pdt_0NeispMKsK20aoJIIsvHg': 'chapter5',
  'pdt_0NeisuvP3bDexjKUCYsVN': 'bundle',
  'pdt_0Neit3X8xxYJh1G7m1ztZ': 'soulmate',
  'pdt_0Neit9n3LyCwUsoCRtjiX': 'starchild',
  'pdt_0NeitaqBccnHAKvtqDOA1': 'basic_sub',
};

async function unlockChapter(email, chapter, paymentId) {
  if (chapter === 'bundle') {
    // Bundle unlocks chapters 2-5 only (matches frontend USD $15 pricing)
    await supabase.from('purchases').upsert([
      { user_email: email, chapter: 'chapter2', payment_id: paymentId },
      { user_email: email, chapter: 'chapter3', payment_id: paymentId },
      { user_email: email, chapter: 'chapter4', payment_id: paymentId },
      { user_email: email, chapter: 'chapter5', payment_id: paymentId },
    ], { onConflict: 'user_email,chapter' });
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

  const event = req.body;

  try {
    const eventType = event.type;
    console.log('Dodo webhook event:', eventType);

    // One-time payment succeeded
    if (eventType === 'payment.succeeded') {
      const payment = event.data;
      const email = payment.customer?.email;
      const productId = payment.product_cart?.[0]?.product_id;
      const chapter = PRODUCT_CHAPTERS[productId];
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
      const productId = sub.product_id;
      if (email && PRODUCT_CHAPTERS[productId] === 'basic_sub') {
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
      const productId = sub.product_id;
      if (email && PRODUCT_CHAPTERS[productId] === 'basic_sub') {
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
      const productId = sub.product_id;
      if (email && PRODUCT_CHAPTERS[productId] === 'basic_sub') {
        await revokeSubscriptionAccess(email);
      }
    }

    res.status(200).json({ ok: true });
  } catch (err) {
    console.error('Webhook error:', err);
    res.status(500).json({ error: err.message });
  }
};
