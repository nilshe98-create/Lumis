export default async function handler(req, res) {
  const { code } = req.query;
  if (!code) return res.status(400).json({ error: 'No code provided' });

  try {
    // Exchange code for tokens
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: process.env.GOOGLE_CLIENT_ID,
        client_secret: process.env.GOOGLE_CLIENT_SECRET,
        redirect_uri: 'https://lumis-psi.vercel.app/api/auth/callback',
        grant_type: 'authorization_code'
      })
    });

    const tokens = await tokenRes.json();
    if (!tokens.access_token) return res.status(400).json({ error: 'Token exchange failed' });

    // Get user info
    const userRes = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
      headers: { Authorization: `Bearer ${tokens.access_token}` }
    });
    const user = await userRes.json();

    // Redirect back to site with user info
    const userData = encodeURIComponent(JSON.stringify({
      email: user.email,
      name: user.name,
      picture: user.picture
    }));

    res.redirect(`/?google_auth=${userData}`);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
