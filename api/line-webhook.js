// api/line-webhook.js
// Receives LINE follow/unfollow events and stores user IDs in Supabase
// Set webhook URL in LINE Developers Console to: https://lumisstar.com/api/line-webhook

import crypto from 'crypto';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

function verifySignature(body, signature) {
  const hash = crypto
    .createHmac('SHA256', process.env.LINE_CHANNEL_SECRET)
    .update(body)
    .digest('base64');
  return hash === signature;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const signature = req.headers['x-line-signature'];
  const rawBody = JSON.stringify(req.body);

  if (!verifySignature(rawBody, signature)) {
    return res.status(401).json({ error: 'Invalid signature' });
  }

  const events = req.body.events || [];

  for (const event of events) {
    const userId = event.source?.userId;
    if (!userId) continue;

    if (event.type === 'follow') {
      await supabase
        .from('line_subscribers')
        .upsert({ line_user_id: userId, active: true }, { onConflict: 'line_user_id' });
    }

    if (event.type === 'unfollow') {
      await supabase
        .from('line_subscribers')
        .update({ active: false })
        .eq('line_user_id', userId);
    }
  }

  res.status(200).json({ ok: true });
}
