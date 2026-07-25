const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

module.exports = async function handler(req, res) {
  // POST — save birth data, save a generated reading, or consume a per-use credit
  if (req.method === 'POST') {
    const { email, action, dob, time, place, gender, key, title, content, sig, feature } = req.body || {};

    // Save a generated chapter reading (chapter1..chapter9) so it's never regenerated (no repeat API cost)
    if (action === 'save_reading' && email && key && content) {
      if (!/^chapter[1-9]$/.test(key)) return res.status(400).json({ error: 'Bad key' });
      try {
        await supabase.from('purchases').upsert({
          user_email: email,
          chapter: 'reading_' + key,
          payment_id: JSON.stringify({ title: title || '', content: String(content).slice(0, 20000), sig: sig || '' }),
          subscription_id: null,
        }, { onConflict: 'user_email,chapter' });
        return res.status(200).json({ ok: true });
      } catch(e) {
        return res.status(200).json({ ok: false });
      }
    }

    // Consume one per-use credit (soulmate / starchild) after a successful generation
    if (action === 'consume_credit' && email && (feature === 'soulmate' || feature === 'starchild')) {
      const row = feature + '_credits';
      try {
        const { data: existing } = await supabase
          .from('purchases').select('payment_id')
          .eq('user_email', email).eq('chapter', row).limit(1);
        let count = 0;
        if (existing && existing.length) { try { count = parseInt(JSON.parse(existing[0].payment_id).count) || 0; } catch(e) {} }
        count = Math.max(0, count - 1);
        await supabase.from('purchases').upsert(
          { user_email: email, chapter: row, payment_id: JSON.stringify({ count }) },
          { onConflict: 'user_email,chapter' }
        );
        return res.status(200).json({ ok: true, count });
      } catch(e) {
        return res.status(200).json({ ok: false });
      }
    }

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

  // GET — fetch purchases, birth data, saved readings, and per-use credit balances
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
      const readings = {};
      const credits = { soulmate: 0, starchild: 0 };
      let birth = null;

      (data || []).forEach(row => {
        if (row.chapter === 'birth_profile') {
          try { birth = JSON.parse(row.payment_id); } catch(e) {}
        } else if (row.chapter && row.chapter.indexOf('reading_') === 0) {
          try { readings[row.chapter.slice(8)] = JSON.parse(row.payment_id); } catch(e) {}
        } else if (row.chapter === 'soulmate_credits' || row.chapter === 'starchild_credits') {
          const feat = row.chapter.replace('_credits', '');
          try { credits[feat] = parseInt(JSON.parse(row.payment_id).count) || 0; } catch(e) { credits[feat] = 0; }
        } else if (row.chapter === 'soulmate' || row.chapter === 'starchild') {
          // Legacy permanent rows from before per-use credits existed: honor as one credit.
          if (credits[row.chapter] < 1) credits[row.chapter] = 1;
        } else {
          chapters.push(row.chapter);
        }
      });

      return res.status(200).json({ chapters, birth, readings, credits });
    } catch(e) {
      return res.status(500).json({ error: e.message });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
};
