// Public eBay Research Tool - backend (Node.js + Express)
// SECURITY: eBay App ID / Cert ID come ONLY from environment variables.
// Never put them in this file, in index.html, or in a public Git repo.
const express = require('express');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname)));

// Rate limit: max 20 search requests per IP per minute (public-site protection)
const searchLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 20,
  message: { ok: false, error: 'Too many requests. Please wait a minute and try again.' },
});

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
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: `Basic ${basic}`,
    },
    body: 'grant_type=client_credentials&scope=https://api.ebay.com/oauth/api_scope',
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`eBay token failed (${res.status}). Check Production keys and Marketplace Account Deletion exemption. ${text.slice(0, 200)}`);
  }
  const data = await res.json();
  tokenCache = { token: data.access_token, expiresAt: now + (data.expires_in - 60) * 1000 };
  return tokenCache.token;
}

async function searchMarket(token, q, marketId, limit) {
  const url = `https://api.ebay.com/buy/browse/v1/item_summary/search?q=${encodeURIComponent(q)}&limit=${limit}`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}`, 'X-EBAY-C-MARKETPLACE-ID': marketId },
  });
  if (!res.ok) return { market: marketId, total: 0, items: [], error: `eBay search failed (${res.status})` };
  const data = await res.json();
  return {
    market: marketId,
    total: data.total || 0,
    items: (data.itemSummaries || []).map((it) => ({
      title: it.title,
      price: it.price ? `${it.price.value} ${it.price.currency}` : null,
      image: it.image ? it.image.imageUrl : null,
      url: it.itemWebUrl,
      seller: it.seller ? it.seller.username : null,
      condition: it.condition || null,
    })),
  };
}

app.get('/api/search', searchLimiter, async (req, res) => {
  try {
    const q = (req.query.q || '').trim();
    const market = (req.query.market || 'US').toUpperCase();
    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit || '20', 10) || 20));
    if (!q) return res.status(400).json({ ok: false, error: 'Search keyword is required.' });
    const token = await getToken();
    if (market === 'ALL') {
      const results = await Promise.all(
        Object.values(MARKETS).map((mid) => searchMarket(token, q, mid, limit))
      );
      return res.json({ ok: true, query: q, market: 'ALL', results });
    }
    if (!MARKETS[market]) return res.status(400).json({ ok: false, error: 'Unknown market. Use ALL, US, UK, DE, AU, CA, FR, IT or ES.' });
    const result = await searchMarket(token, q, MARKETS[market], limit);
    return res.json({ ok: true, query: q, market, results: [result] });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`eBay public research tool running on port ${PORT}`));
