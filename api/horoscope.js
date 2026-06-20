// api/horoscope.js
// Called by Vercel cron every day at 6am Taiwan time (22:00 UTC)
// Generates daily horoscope with Claude and pushes to all LINE subscribers

const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

const CRON_SECRET = process.env.CRON_SECRET;

async function generateHoroscope() {
  const today = new Date().toLocaleDateString('zh-TW', {
    timeZone: 'Asia/Taipei',
    year: 'numeric', month: 'long', day: 'numeric',
  });

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 350,
      messages: [{
        role: 'user',
        content: `你是 LUMIS 的星辰嚮導，溫暖、真誠、像一位懂你的朋友。今天是 ${today}。

請用繁體中文寫一段「今日訊息」，給台灣的年輕用戶。

【格式】
✦ 今天的你 ✦
（一段約 60-80 字的訊息）
💫 （一句溫柔的提醒，約 15 字）

【重要原則】
- 不要用傳統算命格式（不要說幸運色、幸運數字、運勢分數、星等）
- 如果今天的能量有挑戰，誠實說出來，不要假裝一切完美
- 但永遠把挑戰轉化成成長與鼓勵，結尾一定要充滿希望
- 像在跟朋友說話，溫暖、真實、不說教
- 讓人讀完覺得「被理解」並且「有力量面對今天」

只回傳訊息內容，不要其他文字。`,
      }],
    }),
  });
  const data = await res.json();
  // Handle multiple response formats
  if (data.content && data.content[0] && data.content[0].text) return data.content[0].text;
  if (data.content && typeof data.content === 'string') return data.content;
  throw new Error('Unexpected horoscope response format');
}

async function pushToUser(userId, text) {
  const res = await fetch('https://api.line.me/v2/bot/message/push', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${process.env.LINE_CHANNEL_TOKEN}`,
    },
    body: JSON.stringify({
      to: userId,
      messages: [{ type: 'text', text }],
    }),
  });
  return res.ok;
}

module.exports = async function handler(req, res) {
  const authHeader = req.headers['authorization'];
  if (CRON_SECRET && authHeader !== `Bearer ${CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const horoscopeText = await generateHoroscope();
    const fullMessage = horoscopeText + '\n\n\u2014 LUMIS \u2726\n\u770b\u4f60\u7684\u5b8c\u6574\u661f\u8fb0\u5716\u6848 \u2192 lumisstar.com';

    // Get all linked LINE subscribers
    const { data: subscribers, error } = await supabase
      .from('line_subscribers')
      .select('line_user_id, email')
      .eq('active', true);

    if (error) throw error;

    // Get the set of emails that currently have an active subscription
    const { data: activeSubs, error: subErr } = await supabase
      .from('purchases')
      .select('user_email')
      .eq('chapter', 'subscription');

    if (subErr) throw subErr;

    const paidEmails = new Set((activeSubs || []).map(r => r.user_email));

    let sent = 0, failed = 0, skipped = 0;
    for (const sub of subscribers) {
      // Only send to LINE users whose email has an active paid subscription
      if (!sub.email || !paidEmails.has(sub.email)) { skipped++; continue; }
      const ok = await pushToUser(sub.line_user_id, fullMessage);
      ok ? sent++ : failed++;
    }

    res.status(200).json({ ok: true, sent, failed, skipped, total: subscribers.length });
  } catch (err) {
    console.error('Horoscope error:', err);
    res.status(500).json({ error: err.message });
  }
};
