# eBay Public Research Tool — deploy guide (owner steps)

This is a standalone public website. It is NOT the Muse artifact.
The Muse tool stays private; this code is the public version.

## What is already done (by Manager)
- Frontend: `index.html` — live search, All + 8 markets, profit calculator, 3D-style dark design
- Backend: `server.js` (Express, for Render/Railway) and `api/search.js` (Vercel serverless, same logic)
- Security: keys are read ONLY from environment variables. No real key is in any file.
- Rate limit: 20 search requests per IP per minute (in `server.js`)
- `.gitignore` already blocks `.env` and `node_modules/`

## What YOU must do (Manager cannot do these for you)
1. Create a GitHub account (if you do not have one), create a new repo, upload this folder.
   - CHECK before pushing: `.env` must NOT be in the repo. Only `.env.example` (with placeholders) is safe.
2. Create a hosting account:
   - Option A (easiest): Vercel — Import the GitHub repo. It will use `api/search.js` automatically.
   - Option B: Render/Railway — Deploy as a Node web service, start command `npm start`.
3. In the hosting dashboard ONLY (never in code, never in chat, never in GitHub):
   - Add Environment Variable: `EBAY_APP_ID` = your Production App ID
   - Add Environment Variable: `EBAY_CERT_ID` = your Production Cert ID
   - Redeploy after adding them.
4. Test: open the deployed site, search "wireless earbuds".
   - If results appear, the public site is live.
   - If "auth failed" appears: check env vars, Production (not Sandbox) keys, and that the
     Marketplace Account Deletion exemption is completed in eBay Developer.
5. Optional: connect your own domain in the hosting dashboard.

## Local test (optional, on your own computer)
```
npm install
cp .env.example .env
# edit .env with your REAL keys (local only, never commit it)
npm start
# open http://localhost:3000
```

## Warnings
- Never paste Cert ID in frontend code, GitHub, or chat.
- Public means anyone can search — rate limiting is on, but watch your eBay API quota.
- This public site uses YOUR keys, so abuse by visitors uses YOUR quota. Consider
  invite-only/login later if traffic grows.
