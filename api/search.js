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
    const results = await Promise.all(markets.map(async (mid) => {
      const url = `https://api.ebay.com/buy/browse/v1/item_summary/search?q=${encodeURIComponent(q)}&limit=${limit}`;
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
      if (market !== 'ALL') items = await enrichWithSales(items, mid);
      return { market: mid, total: d.total || 0, items, salesNote: market === 'ALL' ? 'Select a single market to load per-item sales (est.). ALL would need too many item-detail calls.' : null };
    }));
    return res.json({ ok: true, query: q, market, results });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
};
