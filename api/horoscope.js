// api/horoscope.js
// ONE Vercel cron at 22:00 UTC (06:00 Taiwan) drives all three broadcasts. The handler decides
// which to send today (keeps us within the Hobby plan's cron limit — a single cron job):
//   - Last day of the month -> MONTHLY (a look at the month ahead)
//   - Otherwise Sunday       -> WEEKLY  (a look at the week ahead)
//   - Otherwise              -> DAILY   (today's message)
// One message per day, never spammy. Every type is grounded in the real sky (planetary day
// ruler, moon phase, solar season) — the planetary system translated into simple, warm language.

const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

const CRON_SECRET = process.env.CRON_SECRET;
const MODEL = 'claude-sonnet-4-6';

const PUNCTUATION_RULE =
  '標點符號一律使用台灣全形標點：句子之間用全形逗號「，」，並列時用頓號「、」，句尾用全形句號「。」。不要使用半形的逗號或句號。';

const LIFE_AREAS = [
  '自我成長與內在力量', '人際關係與真誠連結', '愛情與親密關係', '工作與事業方向',
  '金錢觀與自我價值', '創造力與靈感', '健康與身體的照顧', '休息與自我關懷',
  '溝通與表達自己', '改變與新的開始', '勇氣與付諸行動', '耐心與信任過程',
  '感恩與珍惜當下', '放下與釋懷', '夢想與長遠目標'
];

// Indexed by weekday (0 = Sunday). The classical planetary ruler of each day.
const PLANET_RULERS = [
  { name: '太陽', energy: '活力、自我表達、目標感與自信', mood: '明亮、有能量、鼓舞人心' },
  { name: '月亮', energy: '情緒、直覺、內在世界與休息', mood: '溫柔、安撫、向內探索' },
  { name: '火星', energy: '行動、勇氣、熱情與設立界線', mood: '大膽、有衝勁、激勵人心' },
  { name: '水星', energy: '溝通、清晰思緒、學習與做決定', mood: '清晰、靈活、聰慧' },
  { name: '木星', energy: '成長、機會、樂觀與擴展', mood: '開闊、充滿希望、慷慨' },
  { name: '金星', energy: '愛、關係、美感與價值', mood: '溫暖、充滿愛意、重視連結' },
  { name: '土星', energy: '紀律、結構、耐心與長遠規劃', mood: '踏實、穩定、有重量感' }
];

const ANGLES = [
  '用一個生活中的小場景或畫面開場',
  '用一個溫柔的提問開場',
  '直接給予一個溫暖而具體的觀察',
  '用自然、季節或天空的意象開場',
  '從一個內在的小矛盾切入，再帶向光'
];

function moonInfo(date) {
  const synodic = 29.53058867;
  const knownNewMoon = Date.UTC(2000, 0, 6, 18, 14, 0);
  const days = (date.getTime() - knownNewMoon) / 86400000;
  const phase = ((days % synodic) + synodic) % synodic;
  const names = ['新月', '眉月', '上弦月', '盈凸月', '滿月', '虧凸月', '下弦月', '殘月'];
  const idx = Math.floor((phase / synodic) * 8) % 8;
  const waxing = phase < synodic / 2; // building vs releasing energy
  return { name: names[idx], trend: waxing ? '漸盈（能量在累積、適合開展與行動）' : '漸虧（能量在沉澱、適合收斂與整理）' };
}

const SIGN_NAMES = ['摩羯座', '水瓶座', '雙魚座', '牡羊座', '金牛座', '雙子座', '巨蟹座', '獅子座', '處女座', '天秤座', '天蠍座', '射手座'];
const SIGN_CUTOFF = [20, 19, 21, 20, 21, 21, 23, 23, 23, 23, 22, 22]; // by month (1-12)
function sunSign(month, day) {
  let idx = month - 1;
  if (day >= SIGN_CUTOFF[month - 1]) idx = month % 12;
  return SIGN_NAMES[idx];
}

function twParts() {
  const now = new Date();
  const tw = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Taipei' }));
  return { now, tw };
}

async function callClaude(prompt, maxTokens) {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: maxTokens,
      temperature: 1.0,
      messages: [{ role: 'user', content: prompt }],
    }),
  });
  const data = await res.json();
  if (data.content && data.content[0] && data.content[0].text) return data.content[0].text;
  if (data.content && typeof data.content === 'string') return data.content;
  throw new Error('Unexpected response: ' + JSON.stringify(data));
}

async function generateDaily() {
  const { now, tw } = twParts();
  const today = now.toLocaleDateString('zh-TW', { timeZone: 'Asia/Taipei', year: 'numeric', month: 'long', day: 'numeric' });
  const planet = PLANET_RULERS[tw.getDay()];
  const start = new Date(tw.getFullYear(), 0, 0);
  const doy = Math.floor((tw - start) / 86400000);
  const area = LIFE_AREAS[doy % LIFE_AREAS.length];
  const moon = moonInfo(now);
  const angle = ANGLES[Math.floor(Math.random() * ANGLES.length)];

  const prompt = `你是 LUMIS 的星辰嚮導，溫暖、真誠、有智慧，像一位很懂你的朋友。

今天是 ${today}。
今天由「${planet.name}」主宰，能量關於：${planet.energy}。整體氛圍應該是：${planet.mood}。
目前月相：${moon.name}，${moon.trend}。
今天的主題請聚焦在：${area}。
開場方式：${angle}。

請用繁體中文寫一段「今日訊息」給台灣的年輕用戶。

【格式】
✦ 今天的你 ✦
（2 到 3 個短段落，每段 1 到 2 句，段落之間空一行；總長約 90 到 130 字）
💫 （最後加一句溫柔有力的提醒，約 15 到 20 字）

【最重要 — 每天都必須不一樣】
- 情緒基調要貼合「${planet.name}」的能量（${planet.mood}）。不要每天都是「放慢、休息」：火星日大膽有衝勁、木星日充滿機會與希望、金星日溫暖連結、水星日清晰果決、太陽日明亮自信。
- 圍繞今天的主題「${area}」具體展開，真實、新鮮、不老套。
- 絕對避免陳腔濫調與重複句型，不要再用「停下來、聽聽內心的聲音」「給自己一點空間」這類用過很多次的句子。

【風格】
- 不要用傳統算命格式（不要幸運色、幸運數字、運勢評分）。
- 誠實面對挑戰，但結尾一定帶向成長與希望。像朋友說話，溫暖、真實、不說教。
- ${PUNCTUATION_RULE}

只回傳訊息內容，不要任何其他文字。`;
  return callClaude(prompt, 600);
}

async function generateWeekly() {
  const { now, tw } = twParts();
  const today = now.toLocaleDateString('zh-TW', { timeZone: 'Asia/Taipei', month: 'long', day: 'numeric' });
  const moon = moonInfo(now);
  const start = new Date(tw.getFullYear(), 0, 0);
  const doy = Math.floor((tw - start) / 86400000);
  const focus1 = LIFE_AREAS[doy % LIFE_AREAS.length];
  const focus2 = LIFE_AREAS[(doy + 5) % LIFE_AREAS.length];

  const prompt = `你是 LUMIS 的星辰嚮導，溫暖、真誠、有智慧。

今天是 ${today}，新的一週即將開始。
本週月相走向：${moon.name}，${moon.trend}。
本週可以特別關注的兩個生活面向：${focus1}、以及${focus2}。
（參考：一週七天分別由太陽、月亮、火星、水星、木星、金星、土星主宰，各有不同能量。）

請用繁體中文寫一段「本週星辰」給台灣的年輕用戶，幫他們預覽接下來的一週。

【格式】
✦ 本週星辰 ✦
（開頭一句點出本週整體的能量基調）

（接著 2 到 3 個短段落，每段 1 到 2 句：可以提到本週前半與後半的不同節奏、值得把握的時機、可以留意的內在功課。圍繞上面兩個面向具體展開。）

💫 （最後一句本週的溫柔提醒，約 15 到 20 字）

總長約 150 到 200 字。

【原則】
- 內容要新鮮具體，貼合本週的月相走向（${moon.trend}）。漸盈就鼓勵開展行動，漸虧就鼓勵收斂整理。
- 不要用傳統算命格式（不要幸運色、運勢評分）。像朋友在週日早晨陪你看看這一週，溫暖、真實、有方向感。
- 避免陳腔濫調與重複句型。
- ${PUNCTUATION_RULE}

只回傳訊息內容，不要任何其他文字。`;
  return callClaude(prompt, 800);
}

async function generateMonthly() {
  const { now, tw } = twParts();
  const y = tw.getFullYear();
  const m = tw.getMonth() + 1; // current month (1-12)
  const nextM = m === 12 ? 1 : m + 1;
  const nextMonthName = `${nextM} 月`;
  const signEarly = sunSign(nextM, 1);
  const signLate = sunSign(nextM, 28);
  const seasonNote = signEarly === signLate
    ? `下個月太陽主要落在${signEarly}的季節`
    : `下個月太陽從${signEarly}的季節走入${signLate}的季節`;

  const prompt = `你是 LUMIS 的星辰嚮導，溫暖、真誠、有智慧。

這個月即將結束，${nextMonthName}就要開始。
天象參考：${seasonNote}（請把這份能量轉化成貼近生活的語言，不要直接說出星座名稱或占星術語）。

請用繁體中文寫一段「本月星象」給台灣的年輕用戶，幫他們預覽即將到來的 ${nextMonthName}。

【格式】
✦ ${nextMonthName}的星象 ✦
（開頭一到兩句點出下個月的整體主題與能量）

（接著 3 個短段落，每段 1 到 2 句：可以談這個月適合專注的方向、可能遇到的轉折或機會、以及一個值得練習的內在功課。）

💫 （最後一句送給下個月的溫柔祝福，約 15 到 25 字）

總長約 200 到 250 字。

【原則】
- 把天象的能量翻譯成簡單、溫暖、實用的人生語言，不要出現「星座」「宮位」「行星」等術語。
- 給人方向感與希望，誠實但不製造焦慮。內容要具體、新鮮、不空泛。
- ${PUNCTUATION_RULE}

只回傳訊息內容，不要任何其他文字。`;
  return callClaude(prompt, 900);
}

// Build a LINE Flex Message so the message renders in the LUMIS dark + gold style instead of a
// plain white bubble. (LINE controls the font, but the colors and layout are ours.)
function buildFlexMessage(bodyText, headerLabel) {
  return {
    type: 'bubble',
    size: 'mega',
    body: {
      type: 'box',
      layout: 'vertical',
      backgroundColor: '#0B0B16',
      paddingAll: '22px',
      contents: [
        { type: 'text', text: 'L U M I S', color: '#C9A84C', size: 'sm', weight: 'bold', align: 'center', letterSpacing: '6px' },
        { type: 'text', text: headerLabel, color: '#9A8A4C', size: 'xs', align: 'center', margin: 'sm', letterSpacing: '2px' },
        { type: 'separator', margin: 'lg', color: '#26263A' },
        { type: 'text', text: bodyText, color: '#E6E2DA', size: 'md', wrap: true, margin: 'lg', lineSpacing: '10px' },
        { type: 'separator', margin: 'xl', color: '#26263A' },
        {
          type: 'text', text: '看你的完整星辰圖案 →', color: '#9A8A4C', size: 'xs', align: 'center', margin: 'lg',
          action: { type: 'uri', label: 'LUMIS', uri: 'https://www.lumisstar.com' }
        }
      ]
    },
    styles: { body: { backgroundColor: '#0B0B16' } }
  };
}

// Push the Flex message; if it fails for any reason, fall back to plain text so delivery is
// never lost. Returns true if either send succeeds.
async function pushToUser(userId, flexContents, altText, plainText) {
  const headers = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${process.env.LINE_CHANNEL_TOKEN}`,
  };
  const flexRes = await fetch('https://api.line.me/v2/bot/message/push', {
    method: 'POST', headers,
    body: JSON.stringify({ to: userId, messages: [{ type: 'flex', altText, contents: flexContents }] }),
  });
  if (flexRes.ok) return true;
  const textRes = await fetch('https://api.line.me/v2/bot/message/push', {
    method: 'POST', headers,
    body: JSON.stringify({ to: userId, messages: [{ type: 'text', text: plainText }] }),
  });
  return textRes.ok;
}

// Decide which broadcast today is, and generate it.
async function buildTodaysMessage(forceType) {
  const { tw } = twParts();
  const isSunday = tw.getDay() === 0;
  const tomorrow = new Date(tw.getTime() + 86400000);
  const isLastDayOfMonth = tomorrow.getMonth() !== tw.getMonth();

  let type = forceType || (isLastDayOfMonth ? 'monthly' : (isSunday ? 'weekly' : 'daily'));
  let text, header, alt;
  if (type === 'monthly') {
    text = await generateMonthly();
    header = '本月星象 · MONTHLY';
    alt = '✦ LUMIS 本月星象 ✦';
  } else if (type === 'weekly') {
    text = await generateWeekly();
    header = '本週星辰 · WEEKLY';
    alt = '✦ LUMIS 本週星辰 ✦';
  } else {
    text = await generateDaily();
    header = '每日訊息 · DAILY';
    alt = '✦ LUMIS 今天的你 ✦';
  }
  return { type, text, header, alt };
}

module.exports = async function handler(req, res) {
  const authHeader = req.headers['authorization'];
  const q = req.query || {};
  const queryKey = q.key;
  // Optional manual override for testing a specific type: ?type=weekly | monthly | daily
  const forceType = (q.type === 'weekly' || q.type === 'monthly' || q.type === 'daily') ? q.type : null;

  // PREVIEW MODE: ?preview=1 (optionally with &type=) — generate and return the text only.
  if (q.preview === '1') {
    try {
      const { type, text } = await buildTodaysMessage(forceType);
      return res.status(200).json({ type, preview: text });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  // AUTH: the daily cron sends an Authorization header automatically. For manual testing from a
  // browser, pass ?key=YOUR_CRON_SECRET. If CRON_SECRET isn't set, access is open.
  const authed = !CRON_SECRET || authHeader === `Bearer ${CRON_SECRET}` || queryKey === CRON_SECRET;
  if (!authed) return res.status(401).json({ error: 'Unauthorized' });

  try {
    const { type, text, header, alt } = await buildTodaysMessage(forceType);
    const plainMessage = text + '\n\n\u2014 LUMIS \u2726\n\u770b\u4f60\u7684\u5b8c\u6574\u661f\u8fb0\u5716\u6848 \u2192 lumisstar.com';
    const flexContents = buildFlexMessage(text, header);

    const { data: subscribers, error } = await supabase
      .from('line_subscribers')
      .select('line_user_id, email')
      .eq('active', true);
    if (error) throw error;

    const { data: activeSubs, error: subErr } = await supabase
      .from('purchases')
      .select('user_email, payment_id')
      .eq('chapter', 'subscription');
    if (subErr) throw subErr;

    const now = Date.now();
    const paidEmails = new Set();
    for (const row of (activeSubs || [])) {
      let stillValid = true;
      if (row.payment_id) {
        try {
          const meta = JSON.parse(row.payment_id);
          if (meta && meta.paid_until) stillValid = new Date(meta.paid_until).getTime() >= now;
        } catch (e) { /* legacy non-JSON row — treat as valid */ }
      }
      if (stillValid) paidEmails.add(row.user_email);
    }

    let sent = 0, failed = 0, skipped = 0;
    const detail = [];
    for (const sub of subscribers) {
      if (!sub.email || !paidEmails.has(sub.email)) {
        skipped++;
        detail.push({ email: sub.email || '(none)', result: 'skipped_no_active_subscription' });
        continue;
      }
      const ok = await pushToUser(sub.line_user_id, flexContents, alt, plainMessage);
      if (ok) { sent++; detail.push({ email: sub.email, result: 'sent' }); }
      else { failed++; detail.push({ email: sub.email, result: 'push_failed_check_friend_or_token' }); }
    }

    res.status(200).json({ ok: true, type, sent, failed, skipped, total: subscribers.length, detail });
  } catch (err) {
    console.error('Horoscope error:', err);
    res.status(500).json({ error: err.message });
  }
};
