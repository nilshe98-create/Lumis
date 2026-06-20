<!DOCTYPE html>
<html lang="zh-Hant">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>LUMIS · 連結 LINE</title>
<script charset="utf-8" src="https://static.line-scdn.net/liff/edge/2/sdk.js"></script>
<style>
  * { box-sizing: border-box; }
  body {
    margin: 0;
    min-height: 100vh;
    display: flex;
    align-items: center;
    justify-content: center;
    background: #00000A;
    color: #E8E4DC;
    font-family: 'Noto Sans TC', 'PingFang TC', sans-serif;
    text-align: center;
    padding: 24px;
  }
  .card { max-width: 360px; }
  .title { font-size: 1.05rem; letter-spacing: 5px; color: #C9A84C; margin-bottom: 28px; font-weight: 600; }
  .spinner {
    width: 36px; height: 36px;
    border: 3px solid rgba(201,168,76,0.2);
    border-top-color: #C9A84C;
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
    margin: 0 auto 22px;
  }
  @keyframes spin { to { transform: rotate(360deg); } }
  .msg { font-size: 0.95rem; line-height: 1.9; color: #C9C9D8; letter-spacing: 0.5px; }
  .icon { font-size: 2.4rem; margin-bottom: 14px; }
  .err { color: #E08080; }
</style>
</head>
<body>
  <div class="card">
    <div class="title">LUMIS</div>
    <div id="state-loading">
      <div class="spinner"></div>
      <div class="msg">正在連結你的 LINE 帳號...</div>
    </div>
    <div id="state-success" style="display:none;">
      <div class="icon">✦</div>
      <div class="msg">連結成功！🎉<br>明天早上 6 點開始，<br>你會收到專屬的星辰訊息。<br><br>你可以關閉這個頁面了。</div>
    </div>
    <div id="state-error" style="display:none;">
      <div class="icon err">⚠</div>
      <div class="msg err" id="error-text">連結失敗，請稍後再試。</div>
    </div>
  </div>

<script>
const LIFF_ID = '2010456983-KoYPa3ey';

function show(state) {
  ['loading', 'success', 'error'].forEach(function (s) {
    document.getElementById('state-' + s).style.display = (s === state) ? 'block' : 'none';
  });
}

function setError(text) {
  document.getElementById('error-text').textContent = text;
  show('error');
}

async function main() {
  const params = new URLSearchParams(window.location.search);
  const token = params.get('token');
  if (!token) {
    setError('連結網址不完整，請從付款成功頁面重新點擊連結按鈕。');
    return;
  }

  try {
    await liff.init({ liffId: LIFF_ID });
  } catch (err) {
    setError('LINE 初始化失敗：' + (err.message || '請稍後再試。'));
    return;
  }

  try {
    if (!liff.isLoggedIn()) {
      // Redirects through LINE login, then reloads this same URL (token survives in the query string)
      liff.login({ redirectUri: window.location.href });
      return;
    }

    const profile = await liff.getProfile();
    const lineUserId = profile.userId;

    const res = await fetch('/api/line-connect', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: token, lineUserId: lineUserId })
    });
    const data = await res.json();

    if (data && data.ok) {
      show('success');
    } else {
      setError((data && data.error) || '連結失敗，請稍後再試。');
    }
  } catch (err) {
    setError('發生錯誤：' + (err.message || '請稍後再試。'));
  }
}

main();
</script>
</body>
</html>
