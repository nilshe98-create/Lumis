// api/horoscope.js
// Called by cron every day at 6am Taiwan time
// Generates a daily horoscope with Claude and pushes to all active LINE subscribers

import { createClient } from '@supabase/supabase-js';
import Anthropic from '@anthropic-ai/sdk';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const CRON_SECRET = process.env.CRON_SECRET; // add this to Vercel env vars

async function generateHoroscope() {
  const today = new Date().toLocaleDateString('zh-TW', {
    timeZone: 'Asia/Taipei',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

  const message = await anthropic.messages.create({
    model: 'claude-opus-4-20250514',
    max_tokens: 400,
    messages: [
      {
        role: 'user',
        content: `你是LUMIS星座占星師。今天是${today}。
請用繁體中文寫一段今日整體運勢，約120字。
風格：神秘、優雅、正向，適合台灣用戶。
開頭用「✨ 今日星象｜${today}」
結尾邀請用戶到 lumisstar.com 查看個人完整命盤。
不要提具體日期預言，只給能量與方向指引。`,
      },
    ],
  });

  return message.content[0].text;
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

export default async function handler(req, res) {
  // Security: only allow cron or manual trigger with secret
  const authHeader = req.headers['authorization'];
  if (CRON_SECRET && authHeader !== `Bearer ${CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    // Generate horoscope
    const horoscopeText = await generateHoroscope();

    // Fetch all active subscribers
    const { data: subscribers, error } = await supabase
      .from('line_subscribers')
      .select('line_user_id')
      .eq('active', true);

    if (error) throw error;

    // Push to each user
    let sent = 0;
    let failed = 0;
    for (const sub of subscribers) {
      const ok = await pushToUser(sub.line_user_id, horoscopeText);
      ok ? sent++ : failed++;
    }

    res.status(200).json({
      ok: true,
      sent,
      failed,
      total: subscribers.length,
    });
  } catch (err) {
    console.error('Horoscope error:', err);
    res.status(500).json({ error: err.message });
  }
}
