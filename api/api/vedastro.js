export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).end();

  const { time, location } = req.query;

  try {
    const url = `https://api.vedastro.org/api/Calculate/AllPlanetData/PlanetName/All/${location}/${time}?apiKey=${process.env.VEDASTRO_API_KEY}`;
    const response = await fetch(url);
    const data = await response.json();
    res.status(200).json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
