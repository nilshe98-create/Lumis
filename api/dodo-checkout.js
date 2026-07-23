// api/dodo-checkout.js
// Creates Dodo checkout links.
//
// PRODUCT IDS ARE NO LONGER HARDCODED. This file asks Dodo for the live product
// list and matches products BY NAME, so recreating products in the dashboard
// never breaks payments again. Keep these keywords in your Dodo product names:
//   "Chapter 2".."Chapter 9"  -> chapter2..chapter9
//   "Daily" or "Horoscope"    -> basic_sub  (the monthly subscription)
//   "Soulmate"                -> soulmate
//   "Star"                    -> starchild
//   "All"                     -> bundle (all 9 chapters)

const DodoPayments = require('dodopayments');

const DODO_API = 'https://live.dodopayments.com';
const BASE_URL = 'https://www.lumisstar.com';
const SUBSCRIPTION_PRODUCTS = new Set(['basic_sub']);
const ALIASES = { all5chapters: 'bundle' }; // old frontend key for the bundle

// ---- name -> feature key ----
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

// ---- fetch live products, build { featureKey: productId }, cached 5 min ----
let _cache = { map: null, ts: 0 };
async function getProductMap() {
  if (_cache.map && Date.now() - _cache.ts < 5 * 60 * 1000) return _cache.map;
  const candidates = {}; // feature -> [{id, created}]
  for (let page = 0; page < 5; page++) {
    const r = await fetch(`${DODO_API}/products?page_size=100&page_number=${page}`, {
      headers: { Authorization: `Bearer ${process.env.DODO_API_KEY}` },
    });
    if (!r.ok) break;
    const json = await r.json();
    const items = (json && json.items) || [];
    for (const it of items) {
      if (it.is_deleted || it.archived || it.is_archived) continue; // skip archived if flagged
      const key = classify(it.name);
      if (!key) continue;
      (candidates[key] = candidates[key] || []).push({
        id: it.product_id,
        created: Date.parse(it.created_at || 0) || 0,
      });
    }
    if (items.length < 100) break;
  }
  const map = {};
  for (const key of Object.keys(candidates)) {
    // newest product wins — so recreated products automatically replace old ones
    candidates[key].sort((a, b) => b.created - a.created);
    map[key] = candidates[key][0].id;
  }
  _cache = { map, ts: Date.now() };
  return map;
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { product, email, name } = req.body || {};
  if (!product || !email) return res.status(400).json({ error: 'Missing product or email' });

  const key = ALIASES[product] || product;

  let productId;
  try {
    const map = await getProductMap();
    productId = map[key];
  } catch (e) {
    console.error('Product lookup failed:', e?.message || e);
  }
  if (!productId) return res.status(400).json({ error: 'Unknown product: ' + product });

  const client = new DodoPayments({
    bearerToken: process.env.DODO_API_KEY,
    environment: 'live_mode',
  });

  const returnUrl = `${BASE_URL}?dodo_status=succeeded&product=${encodeURIComponent(product)}`;

  try {
    let checkoutUrl;

    if (SUBSCRIPTION_PRODUCTS.has(key)) {
      const sub = await client.subscriptions.create({
        billing: { city: 'Taipei', country: 'TW' },
        customer: { email, name: name || email },
        product_id: productId,
        quantity: 1,
        trial_period_days: 7,
        payment_link: true,
        return_url: returnUrl,
      });
      checkoutUrl = sub.payment_link;
    } else {
      const payment = await client.payments.create({
        billing: { city: 'Taipei', country: 'TW' },
        customer: { email, name: name || email },
        product_cart: [{ product_id: productId, quantity: 1 }],
        payment_link: true,
        return_url: returnUrl,
      });
      checkoutUrl = payment.payment_link;
    }

    if (!checkoutUrl) throw new Error('No checkout URL from Dodo');
    return res.status(200).json({ url: checkoutUrl });

  } catch (err) {
    console.error('Dodo error:', err?.message || err);
    return res.status(500).json({ error: err?.message || 'Payment creation failed' });
  }
};
