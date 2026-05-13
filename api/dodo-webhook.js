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
  'pdt_0NeispMKsK20aoJIlsvHg': 'chapter5',
  'pdt_0NeisuvP3bDexjKUCYsVN': 'bundle',
  'pdt_0Neit3X8xxYJh1G7m1ztZ': 'soulmate',
  'pdt_0Neit9n3LyCwUsoCRtjiX': 'starchild',
  'pdt_0NeitaqBccnHAKvtqDOA1': 'basic_sub',
  'pdt_0Neito7jdtmNb7Jt2Qfex': 'family_sub',
};

async function unlockChapter(email, chapter, paymentId) {
  if (chapter === 'bundle') {
    // Bundle unlocks chapters 2-5, soulmate, starchild
    await supabase.from('purchases').upsert([
      { user_email: email, chapter: 'chapter2', payment_id: paymentId },
      { user_email: email, chapter: 'chapter3', payment_id: paymentId },
      { user_email: email, chapter: 'chapter4', payment_id: paymentId },
      { user_email: email, chapter: 'chapter5', payment_id: paymentId },
      { user_email: email, chapter: 'soulmate', payment_id: paymentId },
      { user_email: email, chapter: 'starchild', payment_id: paymentId },
    ], { onConflict: 'user_email,chapter' });
  } else {
    await supabase.from('purchases').upsert([
      { user_email: email, chapter, payment_id: paymentId },
    ], { onConflict: 'user_email,chapter' });
  }
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

    // Subscription activated (Dodo uses both names)
    if (eventType === 'subscription.active' || eventType === 'subscription.activated') {
      const sub = event.data;
      const email = sub.customer?.email;
      const productId = sub.product_id;
      const chapter = PRODUCT_CHAPTERS[productId];
      if (email && chapter) {
        await supabase.from('purchases').upsert([
          { user_email: email, chapter, subscription_id: sub.subscription_id },
        ], { onConflict: 'user_email,chapter' });
      }
    }

    // Subscription cancelled
    if (eventType === 'subscription.cancelled' || eventType === 'subscription.canceled') {
      const sub = event.data;
      const email = sub.customer?.email;
      const productId = sub.product_id;
      const chapter = PRODUCT_CHAPTERS[productId];
      if (email && chapter) {
        await supabase.from('purchases').delete()
          .eq('user_email', email).eq('chapter', chapter);
      }
    }

    res.status(200).json({ ok: true });
  } catch (err) {
    console.error('Webhook error:', err);
    res.status(500).json({ error: err.message });
  }
};
