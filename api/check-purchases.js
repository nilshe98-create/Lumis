const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

module.exports = async function handler(req, res) {
  // POST — save birth data
  if (req.method === 'POST') {
    const { email, action, dob, time, place, gender } = req.body || {};
    if (action === 'save_birth' && email && dob) {
      try {
        await supabase.from('purchases').upsert({
          user_email: email,
          chapter: 'birth_profile',
          payment_id: JSON.stringify({ dob, time, place, gender }),
          subscription_id: null,
        }, { onConflict: 'user_email,chapter' });
        return res.status(200).json({ ok: true });
      } catch(e) {
        return res.status(200).json({ ok: false });
      }
    }
    return res.status(400).json({ error: 'Invalid request' });
  }

  // GET — fetch purchases + birth data
  if (req.method === 'GET') {
    const email = req.query.email;
    if (!email) return res.status(400).json({ error: 'Missing email' });

    try {
      const { data, error } = await supabase
        .from('purchases')
        .select('chapter, payment_id')
        .eq('user_email', email);

      if (error) throw error;

      const chapters = [];
      let birth = null;

      (data || []).forEach(row => {
        if (row.chapter === 'birth_profile') {
          try { birth = JSON.parse(row.payment_id); } catch(e) {}
        } else {
          chapters.push(row.chapter);
        }
      });

      return res.status(200).json({ chapters, birth });
    } catch(e) {
      return res.status(500).json({ error: e.message });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
};
