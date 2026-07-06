// api/thumbnail.js
// Vercel serverless function — runs server-side, so it isn't subject to
// browser CORS restrictions.
//
// Shirts and Pants on Roblox are stored as a wrapper asset that points at a
// separate "texture" asset — that texture is the actual flat template image.
// Calling thumbnails.roblox.com directly on the wrapper ID renders the item
// on an R6 rig instead of returning the flat template. So we resolve the
// asset down through assetdelivery.roblox.com until we hit real image bytes,
// and only fall back to the rig thumbnail if that resolution fails.

export default async function handler(req, res) {
  const { id } = req.query;

  if (!id || !/^\d+$/.test(String(id))) {
    res.status(400).json({ error: 'Invalid asset id' });
    return;
  }

  try {
    const template = await resolveTemplateImage(String(id));
    if (template) {
      res.setHeader('Content-Type', template.contentType);
      res.setHeader('Cache-Control', 'public, max-age=3600, immutable');
      res.setHeader('X-Clothify-Source', 'template');
      res.status(200).send(template.buffer);
      return;
    }

    const rig = await fetchRigThumbnail(String(id));
    if (rig) {
      res.setHeader('Content-Type', rig.contentType);
      res.setHeader('Cache-Control', 'public, max-age=3600');
      res.setHeader('X-Clothify-Source', 'rig');
      res.status(200).send(rig.buffer);
      return;
    }

    res.status(404).json({ error: 'Could not find an image for that asset ID.' });
  } catch (err) {
    res.status(500).json({ error: err.message || 'Unknown server error' });
  }
}

// Walks the asset's raw content: if assetdelivery hands back an image
// directly, we're done. If it hands back an XML wrapper (Shirt/Pants/Decal
// container), pull the nested asset id out of it and recurse.
async function resolveTemplateImage(id, depth = 0) {
  if (depth > 4) return null;

  const assetRes = await fetch(`https://assetdelivery.roblox.com/v1/asset/?id=${id}`, {
    redirect: 'follow',
  });
  if (!assetRes.ok) return null;

  const contentType = assetRes.headers.get('content-type') || '';

  if (contentType.startsWith('image/')) {
    const buffer = Buffer.from(await assetRes.arrayBuffer());
    return { buffer, contentType };
  }

  // Not raw image bytes — likely an XML wrapper referencing a nested asset id
  const text = await assetRes.text();
  const match = text.match(/asset\/\?id=(\d+)/) || text.match(/rbxassetid:\/\/(\d+)/);

  if (match && match[1] && match[1] !== id) {
    return resolveTemplateImage(match[1], depth + 1);
  }

  return null;
}

// Standard rendered thumbnail (item on an R6 rig) — last-resort fallback
async function fetchRigThumbnail(id) {
  const metaRes = await fetch(
    `https://thumbnails.roblox.com/v1/assets?assetIds=${id}&size=420x420&format=Png&isCircular=false`
  );
  if (!metaRes.ok) return null;

  const metaData = await metaRes.json();
  const item = metaData?.data?.[0];
  if (!item || item.state !== 'Completed' || !item.imageUrl) return null;

  const imgRes = await fetch(item.imageUrl);
  if (!imgRes.ok) return null;

  const buffer = Buffer.from(await imgRes.arrayBuffer());
  const contentType = imgRes.headers.get('content-type') || 'image/png';
  return { buffer, contentType };
}
