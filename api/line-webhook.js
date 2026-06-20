// api/line-webhook.js
// Handles LINE bot events: follow, unfollow, and message (email linking)
// When a user sends their email, verifies they have an active subscription,
// then links their LINE account so they receive the daily horoscope.

const crypto = require('crypto');
const { createClient } = require('@supabase/supabase-js');

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

// Reply to a LINE message using the reply token
async function replyMessage(replyToken, text) {
  await fetch('https://api.line.me/v2/bot/message/reply', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${process.env.LINE_CHANNEL_TOKEN}`,
    },
    body: JSON.stringify({
      replyToken,
      messages: [{ type: 'text', text }],
    }),
  });
}

// Check if an email has an active subscription
async function hasActiveSubscription(email) {
  const { data, error } = await supabase
    .from('purchases')
    .select('chapter')
    .eq('user_email', email)
    .eq('chapter', 'subscription');
  if (error) return false;
  return (data && data.length > 0);
}

// Extract an email address from message text
function extractEmail(text) {
  if (!text) return null;
  const match = text.trim().match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/);
  return match ? match[0].toLowerCase() : null;
}

module.exports = async function handler(req, res) {
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

    // New follower - greet and ask for their email to link
    if (event.type === 'follow') {
      await replyMessage(
        event.replyToken,
        '\u2726 \u6b61\u8fce\u4f86\u5230 LUMIS \u2726\n\n\u8981\u958b\u59cb\u63a5\u6536\u6bcf\u65e5\u661f\u8fb0\u8a0a\u606f\uff0c\u8acb\u50b3\u9001\u4f60\u8a02\u95b1\u6642\u4f7f\u7528\u7684\u96fb\u5b50\u90f5\u4ef6\u7d66\u6211\uff0c\u6211\u6703\u5e6b\u4f60\u9023\u7d50\u5e33\u865f\u3002\n\n\u9084\u6c92\u8a02\u95b1\uff1f\u524d\u5f80 lumisstar.com'
      );
    }

    // User sent a message - check if it's an email for linking
    if (event.type === 'message' && event.message?.type === 'text') {
      const email = extractEmail(event.message.text);

      if (!email) {
        await replyMessage(
          event.replyToken,
          '\u8acb\u50b3\u9001\u4f60\u8a02\u95b1\u6642\u4f7f\u7528\u7684\u96fb\u5b50\u90f5\u4ef6\uff08\u4f8b\u5982\uff1ayourname@gmail.com\uff09\uff0c\u6211\u624d\u80fd\u5e6b\u4f60\u9023\u7d50\u6bcf\u65e5\u8a0a\u606f\u3002'
        );
        continue;
      }

      const subscribed = await hasActiveSubscription(email);

      if (subscribed) {
        // Link this LINE account to the subscribed email
        await supabase
          .from('line_subscribers')
          .upsert(
            { line_user_id: userId, email: email, active: true, linked_at: new Date().toISOString() },
            { onConflict: 'line_user_id' }
          );
        await replyMessage(
          event.replyToken,
          '\u2713 \u9023\u7d50\u6210\u529f\uff01\ud83c\udf89\n\n\u660e\u5929\u65e9\u4e0a6\u9ede\u958b\u59cb\uff0c\u4f60\u6703\u6536\u5230\u5c08\u5c6c\u7684\u661f\u8fb0\u8a0a\u606f\u3002\n\n\u9858\u661f\u5149\u6bcf\u5929\u9675\u4f34\u4f60 \u2726'
        );
      } else {
        await replyMessage(
          event.replyToken,
          '\u627e\u4e0d\u5230\u9019\u500b\u96fb\u5b50\u90f5\u4ef6\u7684\u8a02\u95b1\u8a18\u9304 \ud83d\ude14\n\n\u8acb\u78ba\u8a8d\u4f60\u8f38\u5165\u7684\u662f\u8a02\u95b1\u6642\u4f7f\u7528\u7684\u4fe1\u7bb1\uff0c\u6216\u524d\u5f80 lumisstar.com \u958b\u59cb 7 \u5929\u514d\u8cbb\u8a66\u7528\u3002'
        );
      }
    }

    // Unfollow - deactivate
    if (event.type === 'unfollow') {
      await supabase
        .from('line_subscribers')
        .update({ active: false })
        .eq('line_user_id', userId);
    }
  }

  res.status(200).json({ ok: true });
};
