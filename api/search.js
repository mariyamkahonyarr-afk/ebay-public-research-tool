// Vercel serverless version of /api/search (same logic as server.js).
// Keys come ONLY from Vercel Environment Variables, never from frontend code.
const MARKETS = {
  US: 'EBAY_US', UK: 'EBAY_GB', DE: 'EBAY_DE', AU: 'EBAY_AU',
  CA: 'EBAY_CA', FR: 'EBAY_FR', IT: 'EBAY_IT', ES: 'EBAY_ES',
};
let tokenCache = { token: null, expiresAt: 0 };

async function getToken() {
  const now = Date.now();
  if (tokenCache.token && now < tokenCache.expiresAt) return tokenCache.token;
  const appId = process.env.EBAY_APP_ID;
  const certId = process.env.EBAY_CERT_ID;
  if (!appId || !certId) throw new Error('EBAY_APP_ID / EBAY_CERT_ID are not set in environment variables.');
  const basic = Buffer.from(`${appId}:${certId}`).toString('base64');
  const res = await fetch('https://api.ebay.com/identity/v1/oauth2/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Authorization: `Basic ${basic}` },
    body: 'grant_type=client_credentials&scope=https://api.ebay.com/oauth/api_scope',
  });
  if (!res.ok) throw new Error(`eBay token failed (${res.status}). Check Production keys and exemption.`);
  const data = await res.json();
  tokenCache = { token: data.access_token, expiresAt: now + (data.expires_in - 60) * 1000 };
  return tokenCache.token;
}

module.exports = async (req, res) => {
  try {
    const q = (req.query.q || '').trim();
    const market = (req.query.market || 'US').toUpperCase();
    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit || '20', 10) || 20));
    if (!q) return res.status(400).json({ ok: false, error: 'Search keyword is required.' });
    const token = await getToken();
    const markets = market === 'ALL' ? Object.values(MARKETS) : [MARKETS[market]];
    if (!markets[0]) return res.status(400).json({ ok: false, error: 'Unknown market.' });
    const results = await Promise.all(markets.map(async (mid) => {
      const url = `https://api.ebay.com/buy/browse/v1/item_summary/search?q=${encodeURIComponent(q)}&limit=${limit}`;
      const r = await fetch(url, { headers: { Authorization: `Bearer ${token}`, 'X-EBAY-C-MARKETPLACE-ID': mid } });
      if (!r.ok) return { market: mid, total: 0, items: [], error: `eBay search failed (${r.status})` };
      const d = await r.json();
      return {
        market: mid, total: d.total || 0,
        items: (d.itemSummaries || []).map((it) => ({
          title: it.title, price: it.price ? `${it.price.value} ${it.price.currency}` : null,
          image: it.image ? it.image.imageUrl : null, url: it.itemWebUrl,
          seller: it.seller ? it.seller.username : null, condition: it.condition || null,
        })),
      };
    }));
    return res.json({ ok: true, query: q, market, results });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
};
