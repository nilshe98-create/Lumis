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
    // Trial also fires this — user gets access during the 7-day trial
    if (eventType === 'subscription.active' || eventType === 'subscription.activated') {
      const sub = event.data;
      const email = sub.customer?.email;
      const productId = sub.product_id;
      // Only our basic subscription product grants daily horoscope
      if (email && PRODUCT_CHAPTERS[productId] === 'basic_sub') {
        await supabase.from('purchases').upsert([
          { user_email: email, chapter: 'subscription', subscription_id: sub.subscription_id },
        ], { onConflict: 'user_email,chapter' });
      }
    }

    // Subscription cancelled — remove access AND stop their daily LINE messages
    if (eventType === 'subscription.cancelled' || eventType === 'subscription.canceled') {
      const sub = event.data;
      const email = sub.customer?.email;
      const productId = sub.product_id;
      if (email && PRODUCT_CHAPTERS[productId] === 'basic_sub') {
        // Remove subscription record
        await supabase.from('purchases').delete()
          .eq('user_email', email).eq('chapter', 'subscription');
        // Deactivate their LINE delivery
        await supabase.from('line_subscribers')
          .update({ active: false }).eq('email', email);
      }
    }

    res.status(200).json({ ok: true });
  } catch (err) {
    console.error('Webhook error:', err);
    res.status(500).json({ error: err.message });
  }
};
