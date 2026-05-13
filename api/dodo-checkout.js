// api/dodo-checkout.js
// Creates a Dodo Payments checkout session

const PRODUCT_MAP = {
  chapter2: 'pdt_0NeisQEQvTp8XraWPadOS',
  chapter3: 'pdt_0NeisdwJUSDrFgwNoE3M0',
  chapter4: 'pdt_0NeiskUuoq1SbWCBmEVys',
  chapter5: 'pdt_0NeispMKsK20aoJIlsvHg',
  bundle: 'pdt_0NeisuvP3bDexjKUCYsVN',
  soulmate: 'pdt_0Neit3X8xxYJh1G7m1ztZ',
  starchild: 'pdt_0Neit9n3LyCwUsoCRtjiX',
  basic_sub: 'pdt_0NeitaqBccnHAKvtqDOA1',
  family_sub: 'pdt_0Neito7jdtmNb7Jt2Qfex',
};

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const { product, email, name } = req.body;
  if (!product || !email) return res.status(400).json({ error: 'Missing product or email' });

  const productId = PRODUCT_MAP[product];
  if (!productId) return res.status(400).json({ error: 'Invalid product' });

  try {
    const dodoModule = await import('dodopayments');
    const DodoPayments = dodoModule.default || dodoModule;
    const client = new DodoPayments({
      bearerToken: process.env.DODO_API_KEY,
      environment: 'test_mode',
    });

    const session = await client.checkoutSessions.create({
      product_cart: [{ product_id: productId, quantity: 1 }],
      customer: { email, name: name || email },
      billing_address: {
        street: 'N/A',
        city: 'Taipei',
        state: 'TPE',
        country: 'TW',
        zipcode: '100',
      },
      return_url: `https://www.lumisstar.com?dodo_status=succeeded&product=${product}&email=${encodeURIComponent(email)}`,
      metadata: { product_key: product, user_email: email },
    });

    res.status(200).json({ url: session.url });
  } catch (err) {
    console.error('Dodo checkout error:', err);
    res.status(500).json({ error: err.message });
  }
};
