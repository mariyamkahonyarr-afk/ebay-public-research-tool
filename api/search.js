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
    async function enrichWithSales(items, mid) {
      // Single-market only: one item-detail call per listing (max 50).
      // Detail returns estimatedAvailabilities, which eBay documents as an estimate
      // and third-party Browse SDKs describe as carrying sold + remaining quantities.
      // If a detail call fails or the field is absent, sold stays null -> 'Not specified', never invented.
      const out = await Promise.all(items.map(async (it) => {
        if (!it.itemId) return it;
        try {
          const dr = await fetch(`https://api.ebay.com/buy/browse/v1/item/${encodeURIComponent(it.itemId)}`, { headers: { Authorization: `Bearer ${token}`, 'X-EBAY-C-MARKETPLACE-ID': mid } });
          if (!dr.ok) return it;
          const dd = await dr.json();
          let sold = null;
          if (dd.estimatedAvailabilities && dd.estimatedAvailabilities[0]) {
            const ea = dd.estimatedAvailabilities[0];
            if (ea.estimatedSoldQuantity != null) sold = ea.estimatedSoldQuantity;
            else if (ea.soldQuantity != null) sold = ea.soldQuantity;
          }
          if (sold == null && dd.estimatedSoldQuantity != null) sold = dd.estimatedSoldQuantity;
          return { ...it, soldQuantity: sold, conditionDescription: dd.conditionDescription || it.conditionDescription || null, location: it.location || (dd.itemLocation ? [dd.itemLocation.city, dd.itemLocation.country].filter(Boolean).join(', ') : null) };
        } catch { return it; }
      }));
      return out;
    }
    // Optional filters (new in v2, backward compatible: ignored if absent).
    // Frontend also filters by seller name, so this works even if only index.html is redeployed.
    const seller = (req.query.seller || '').trim();
    const category = (req.query.category || '').trim();
    const filters = [];
    if (seller) filters.push(`sellers:{${seller}}`);
    if (category) filters.push(`categoryIds:{${category}}`);
    const filterParam = filters.length ? `&filter=${encodeURIComponent(filters.join(','))}` : '';
    const results = await Promise.all(markets.map(async (mid) => {
      const url = `https://api.ebay.com/buy/browse/v1/item_summary/search?q=${encodeURIComponent(q)}&limit=${limit}${filterParam}`;
      const r = await fetch(url, { headers: { Authorization: `Bearer ${token}`, 'X-EBAY-C-MARKETPLACE-ID': mid } });
      if (!r.ok) return { market: mid, total: 0, items: [], error: `eBay search failed (${r.status})` };
      const d = await r.json();
      let items = (d.itemSummaries || []).map((it) => ({
        itemId: it.itemId || null,
        title: it.title, price: it.price ? `${it.price.value} ${it.price.currency}` : null,
        priceValue: it.price ? parseFloat(it.price.value) : null,
        image: it.image ? it.image.imageUrl : null, url: it.itemWebUrl,
        seller: it.seller ? it.seller.username : null,
        feedbackScore: it.seller && it.seller.feedbackScore != null ? it.seller.feedbackScore : null,
        feedbackPercentage: it.seller && it.seller.feedbackPercentage != null ? it.seller.feedbackPercentage : null,
        location: it.itemLocation ? [it.itemLocation.city, it.itemLocation.country].filter(Boolean).join(', ') : null,
        condition: it.condition || null,
        conditionDescription: it.conditionDescription || null,
        soldQuantity: null,
      }));
      // Only enrich single-market searches: ALL would need 160 detail calls and would time out on Vercel.
      if (market !== 'ALL') items = await enrichWithSales(items, mid);
      return { market: mid, total: d.total || 0, items, salesNote: market === 'ALL' ? 'Select a single market to load per-item sales (est.). ALL would need too many item-detail calls.' : null };
    }));
    return res.json({ ok: true, query: q, market, results });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
};
