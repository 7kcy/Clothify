// api/thumbnail.js
// Vercel serverless function — runs on Vercel's server, not in the browser,
// so it isn't subject to the browser's CORS restrictions.
// The page calls this route (same-origin) instead of calling
// thumbnails.roblox.com directly.

export default async function handler(req, res) {
  const { id } = req.query;

  if (!id || !/^\d+$/.test(String(id))) {
    res.status(400).json({ error: 'Invalid asset id' });
    return;
  }

  try {
    // 1. Ask Roblox for the thumbnail metadata (this call is server-to-server, no CORS issue)
    const metaRes = await fetch(
      `https://thumbnails.roblox.com/v1/assets?assetIds=${id}&size=420x420&format=Png&isCircular=false`
    );

    if (!metaRes.ok) {
      res.status(502).json({ error: `Roblox API returned ${metaRes.status}` });
      return;
    }

    const metaData = await metaRes.json();
    const item = metaData?.data?.[0];

    if (!item || item.state !== 'Completed' || !item.imageUrl) {
      res.status(404).json({ error: 'No thumbnail available for that asset ID' });
      return;
    }

    // 2. Fetch the actual image bytes and stream them back through our own origin
    const imgRes = await fetch(item.imageUrl);
    if (!imgRes.ok) {
      res.status(502).json({ error: 'Could not fetch image from Roblox CDN' });
      return;
    }

    const arrayBuffer = await imgRes.arrayBuffer();
    const contentType = imgRes.headers.get('content-type') || 'image/png';

    res.setHeader('Content-Type', contentType);
    res.setHeader('Cache-Control', 'public, max-age=3600, immutable');
    res.status(200).send(Buffer.from(arrayBuffer));
  } catch (err) {
    res.status(500).json({ error: err.message || 'Unknown server error' });
  }
}
