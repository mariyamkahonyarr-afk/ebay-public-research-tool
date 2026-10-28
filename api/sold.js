// Vercel serverless sold listings: eBay Finding API, sold-items-only.
// If Finding API is retired/unavailable for this keyset, returns ok:false with a clear error — never fake numbers.
module.exports = async (req, res) => {
  try {
    const q = (req.query.q || '').trim();
    const days = Math.min(30, Math.max(1, parseInt(req.query.days || '30', 10) || 30));
    if (!q) return res.status(400).json({ ok: false, error: 'Search keyword is required.' });
    const appId = process.env.EBAY_APP_ID;
    if (!appId) return res.status(500).json({ ok: false, error: 'EBAY_APP_ID is not set.' });
    const endFrom = new Date(Date.now() - days * 86400000).toISOString().replace(/\.\d+Z$/, 'Z');
    const url = `https://svcs.ebay.com/services/search/FindingService/v1?OPERATION-NAME=findCompletedItems&SERVICE-VERSION=1.0.0&SECURITY-APPNAME=${encodeURIComponent(appId)}&RESPONSE-DATA-FORMAT=JSON&REST-PAYLOAD&keywords=${encodeURIComponent(q)}&paginationInput.entriesPerPage=20&itemFilter(0).name=SoldItemsOnly&itemFilter(0).value=true&itemFilter(1).name=EndTimeFrom&itemFilter(1).value=${encodeURIComponent(endFrom)}`;
    const r = await fetch(url);
    if (!r.ok) return res.status(500).json({ ok: false, error: `eBay Finding API failed (${r.status}). Finding API may be retired for this keyset.` });
    const d = await r.json();
    const resp = d.findCompletedItemsResponse && d.findCompletedItemsResponse[0];
    if (!resp || (resp.ack && resp.ack[0] !== 'Success')) return res.status(500).json({ ok: false, error: 'eBay Finding API did not return success.' });
    const sr = resp.searchResult && resp.searchResult[0];
    const items = (sr && sr.item) || [];
    const prices = items.map(it => { try { return parseFloat(it.sellingStatus[0].currentPrice[0].__value__); } catch { return null; } }).filter(v => v != null);
    return res.json({ ok: true, query: q, days, total: sr ? parseInt(sr['@count'] || items.length, 10) : items.length, avgSoldPrice: prices.length ? (prices.reduce((a,b)=>a+b,0)/prices.length).toFixed(2) : null, items: items.map(it => ({ title: it.title ? it.title[0] : null, price: it.sellingStatus ? `${it.sellingStatus[0].currentPrice[0].__value__} ${it.sellingStatus[0].currentPrice[0]['@currencyId']}` : null, image: it.galleryURL ? it.galleryURL[0] : null, url: it.viewItemURL ? it.viewItemURL[0] : null, seller: it.sellerInfo ? it.sellerInfo[0].sellerUserName[0] : null, soldDate: it.listingInfo ? it.listingInfo[0].endTime[0].slice(0,10) : null })) });
  } catch (err) { return res.status(500).json({ ok: false, error: err.message }); }
};
