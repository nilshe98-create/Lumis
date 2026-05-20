// /api/dodo-products.js
// Temporary debug endpoint — fetch exact product IDs from Dodo live mode
// Visit: https://www.lumisstar.com/api/dodo-products
// DELETE this file after getting the IDs

const DodoPayments = require('dodopayments');

module.exports = async function handler(req, res) {
  try {
    const client = new DodoPayments({
      bearerToken: process.env.DODO_API_KEY,
      environment: 'live_mode',
    });

    const result = await client.products.list();
    const products = (result.items || result.data || result || []).map(p => ({
      name: p.name,
      id: p.product_id || p.id,
      price: p.price,
      type: p.pricing_type || p.type,
    }));

    return res.status(200).json({ products });
  } catch (err) {
    return res.status(500).json({ error: err?.message || 'Failed to fetch products' });
  }
};
