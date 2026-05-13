// api/check-purchases.js
// Returns list of purchased chapters for a given user email

const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).end();

  const { email } = req.query;
  if (!email) return res.status(400).json({ error: 'Missing email' });

  try {
    const { data, error } = await supabase
      .from('purchases')
      .select('chapter')
      .eq('user_email', email);

    if (error) throw error;

    const chapters = data.map(row => row.chapter);
    res.status(200).json({ chapters });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
