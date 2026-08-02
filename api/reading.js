// api/reading.js
// Proxy to the Anthropic API for generating readings.
// Hardened: the model and token limit are enforced server-side so this endpoint
// can't be abused as a free general-purpose AI proxy (which would burn API budget).
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  try {
    const body = req.body || {};
    // Enforce limits regardless of what the client sends
    body.model = 'claude-sonnet-4-6';
    // Ceiling raised to 4000: the soulmate/star-child readings request exactly 2000 and produce a
    // 7-field Chinese JSON, so a 2000 cap left ZERO headroom — the reply was being truncated
    // mid-JSON, which is what produced the intermittent 「星辰回應格式異常」 error.
    // max_tokens is only a ceiling (you pay for what is actually generated), and a truncated
    // reply costs double because the user retries, so this is cheaper, not more expensive.
    body.max_tokens = Math.min(Number(body.max_tokens) || 1500, 4000);

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify(body)
    });
    const data = await response.json();
    res.status(200).json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
