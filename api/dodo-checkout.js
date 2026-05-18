const DodoPayments = require('dodopayments');

// Product key → Dodo product ID mapping
const PRODUCT_MAP = {
  chapter2:   'pdt_0NeisQEQvTp8XraWPadOS',
  chapter3:   'pdt_0NeisdwJUSDrFgwNoE3M0',
  chapter4:   'pdt_0NeiskUuoq1SbWCBmEVys',
  chapter5:   'pdt_0NeispMKsK20aoJIlsvHg',
  bundle:     'pdt_0NeisuvP3bDexjKUCYsVN',
  all5chapters:'pdt_0NeisuvP3bDexjKUCYsVN',
  soulmate:   'pdt_0Neit3X8xxYJh1G7m1ztZ',
  starchild:  'pdt_0Neit9n3LyCwUsoCRtjiX',
  basic_sub:  'pdt_0NeitaqBccnHAKvtqDOA1',
  family_sub: 'pdt_0Neito7jdtmNb7Jt2Qfex',
};

// These products are recurring subscriptions
const SUBSCRIPTION_PRODUCTS = new Set(['basic_sub', 'family_sub']);

const BASE_URL = 'https://www.lumisstar.com';

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { product, email, name } = req.body || {};

  if (!product || !email) {
    return res.status(400).json({ error: 'Missing product or email' });
  }

  const productId = PRODUCT_MAP[product];
  if (!productId) {
    return res.status(400).json({ error: 'Unknown product: ' + product });
  }

  const client = new DodoPayments({
    bearerToken: process.env.DODO_API_KEY,
    environment: 'live_mode',
  });

  const returnUrl = `${BASE_URL}?dodo_status=succeeded&product=${encodeURIComponent(product)}`;
  const customer = {
    create_new_customer: false,
    email: email,
    name: name || email,
  };
  const billing = {
    city: 'Taipei',
    country: 'TW',
  };

  try {
    let checkoutUrl;

    if (SUBSCRIPTION_PRODUCTS.has(product)) {
      // Subscription flow
      const sub = await client.subscriptions.create({
        billing,
        customer,
        product_id: productId,
        payment_link: true,
        return_url: returnUrl,
      });
      checkoutUrl = sub.payment_link;
    } else {
      // One-time payment flow
      const payment = await client.payments.create({
        billing,
        customer,
        product_cart: [{ product_id: productId, quantity: 1 }],
        payment_link: true,
        return_url: returnUrl,
      });
      checkoutUrl = payment.payment_link;
    }

    if (!checkoutUrl) {
      throw new Error('No checkout URL returned from Dodo');
    }

    return res.status(200).json({ url: checkoutUrl });

  } catch (err) {
    console.error('Dodo checkout error:', err?.message || err);
    return res.status(500).json({ error: err?.message || 'Payment creation failed' });
  }
};
