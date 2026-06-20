// api/referral.js
// Server-side referral system.
// When a new user signs up via someone's referral link, the REFERRER earns
// one free chapter (chapter2) — capped at ONE free chapter per referrer, ever.

const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

// Recreate the same ref code the frontend generates from an email
function generateRefCode(email) {
  let hash = 5381;
  for (let i = 0; i < email.length; i++) hash = ((hash << 5) + hash) + email.charCodeAt(i);
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = ''; let h = Math.abs(hash);
  for (let i = 0; i < 6; i++) { code += chars[h % chars.length]; h = Math.floor(h / chars.length); }
  return code;
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { newUserEmail, refCode } = req.body || {};
  if (!newUserEmail || !refCode) return res.status(400).json({ error: 'Missing data' });

  try {
    // 1. Don't let someone refer themselves
    if (generateRefCode(newUserEmail) === refCode) {
      return res.status(200).json({ ok: false, reason: 'self_referral' });
    }

    // 2. Has this new user already been counted as a referral before? (prevent re-trigger)
    const { data: existingReferral } = await supabase
      .from('referrals')
      .select('id')
      .eq('referred_email', newUserEmail)
      .limit(1);

    if (existingReferral && existingReferral.length > 0) {
      return res.status(200).json({ ok: false, reason: 'already_referred' });
    }

    // 3. Find the referrer by matching their ref code against all known users.
    //    We look through everyone who has a birth_profile (i.e. signed-up users).
    const { data: allProfiles } = await supabase
      .from('purchases')
      .select('user_email')
      .eq('chapter', 'birth_profile');

    let referrerEmail = null;
    const seen = new Set();
    for (const row of (allProfiles || [])) {
      const em = row.user_email;
      if (seen.has(em)) continue;
      seen.add(em);
      if (generateRefCode(em) === refCode) { referrerEmail = em; break; }
    }

    if (!referrerEmail) {
      return res.status(200).json({ ok: false, reason: 'referrer_not_found' });
    }

    // 4. Record the referral (so it can't be double-counted)
    await supabase.from('referrals').insert({
      referrer_email: referrerEmail,
      referred_email: newUserEmail,
      created_at: new Date().toISOString(),
    });

    // 5. Has the referrer already earned their ONE free chapter? Cap enforcement.
    const { data: alreadyEarned } = await supabase
      .from('purchases')
      .select('chapter')
      .eq('user_email', referrerEmail)
      .eq('payment_id', 'referral_reward');

    if (alreadyEarned && alreadyEarned.length > 0) {
      // Referrer already got their free chapter — referral still recorded, but no new reward
      return res.status(200).json({ ok: true, rewarded: false, reason: 'cap_reached' });
    }

    // 6. Grant the referrer their ONE free chapter (chapter2), if they don't already own it
    const { data: ownsCh2 } = await supabase
      .from('purchases')
      .select('chapter')
      .eq('user_email', referrerEmail)
      .eq('chapter', 'chapter2');

    if (ownsCh2 && ownsCh2.length > 0) {
      // They already own chapter2 by paying — give them chapter3 instead as the free reward
      await supabase.from('purchases').upsert(
        { user_email: referrerEmail, chapter: 'chapter3', payment_id: 'referral_reward' },
        { onConflict: 'user_email,chapter' }
      );
    } else {
      await supabase.from('purchases').upsert(
        { user_email: referrerEmail, chapter: 'chapter2', payment_id: 'referral_reward' },
        { onConflict: 'user_email,chapter' }
      );
    }

    return res.status(200).json({ ok: true, rewarded: true, referrer: referrerEmail });

  } catch (err) {
    console.error('Referral error:', err);
    return res.status(500).json({ error: err.message });
  }
};
