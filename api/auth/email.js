export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const { type, email, password } = req.body;
  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;

  try {
    let endpoint = '';
    if (type === 'signup') {
      endpoint = `${SUPABASE_URL}/auth/v1/signup`;
    } else if (type === 'login') {
      endpoint = `${SUPABASE_URL}/auth/v1/token?grant_type=password`;
    } else {
      return res.status(400).json({ error: 'Invalid type' });
    }

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': SUPABASE_ANON_KEY,
        'Authorization': `Bearer ${SUPABASE_ANON_KEY}`
      },
      body: JSON.stringify({ email, password })
    });

    const data = await response.json();

    if (data.error || data.error_description) {
      return res.status(400).json({ error: data.error_description || data.error || 'Auth failed' });
    }

    // Return user info
    const user = data.user || data;
    res.status(200).json({
      email: user.email,
      name: user.email.split('@')[0],
      id: user.id
    });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
