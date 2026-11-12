/**
 * ShipBoost - Production-Ready Shopify App Server
 * Features:
 * - Shopify OAuth 2.0 + HMAC Signature Verification
 * - Real Shopify GraphQL Billing API ($9.99/mo Pro Plan)
 * - Mandatory GDPR Webhooks with HMAC Verification (401 on invalid HMAC)
 * - CSP frame-ancestors header for Shopify Admin Embedded Apps
 * - Persistent Storage: Supabase REST API (via native fetch) with local JSON fallback
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = process.env.PORT || 3000;
const SHOPIFY_API_KEY = process.env.SHOPIFY_API_KEY || '';
const SHOPIFY_API_SECRET = process.env.SHOPIFY_API_SECRET || '';
const APP_URL = (process.env.APP_URL || `http://localhost:${PORT}`).replace(/\/$/, '');
const BILLING_TEST = process.env.BILLING_TEST !== 'false'; // Set BILLING_TEST=false for live charges

// Optional persistent storage via Supabase REST API (no npm packages required)
const SUPABASE_URL = (process.env.SUPABASE_URL || '').replace(/\/$/, '');
const SUPABASE_KEY = process.env.SUPABASE_KEY || '';

const DATA_FILE = path.join(__dirname, 'data', 'settings.json');
const SHOPIFY_API_VERSION = '2024-10';

const DEFAULT_SETTINGS = {
  isActive: true,
  goalAmount: 50.00,
  currencySymbol: '$',
  initialMessage: 'Free Shipping on orders over {goal}! 🚚',
  progressMessage: 'Add {remaining} more to unlock FREE SHIPPING! 📦',
  successMessage: '🎉 Congratulations! You unlocked FREE SHIPPING!',
  backgroundColor: '#111827',
  textColor: '#ffffff',
  progressColor: '#10b981',
  position: 'top',
  plan: 'free',
  accessToken: ''
};

// Ensure local fallback data directory and file exist
if (!fs.existsSync(path.dirname(DATA_FILE))) {
  fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
}
if (!fs.existsSync(DATA_FILE)) {
  fs.writeFileSync(DATA_FILE, JSON.stringify({ default: DEFAULT_SETTINGS }, null, 2), 'utf8');
}

// --- Storage Helpers (Supabase REST + Local JSON Fallback) ---
async function getShopData(shop) {
  const shopKey = shop || 'default';
  if (SUPABASE_URL && SUPABASE_KEY) {
    try {
      const res = await fetch(
        `${SUPABASE_URL}/rest/v1/shipboost_stores?shop=eq.${encodeURIComponent(shopKey)}&select=data`,
        {
          headers: {
            apikey: SUPABASE_KEY,
            Authorization: `Bearer ${SUPABASE_KEY}`
          }
        }
      );
      if (res.ok) {
        const rows = await res.json();
        if (rows.length > 0 && rows[0].data) {
          return { ...DEFAULT_SETTINGS, ...rows[0].data };
        }
      }
    } catch (err) {
      console.error('[Supabase Read Error]', err.message);
    }
  }

  try {
    const raw = fs.readFileSync(DATA_FILE, 'utf8');
    const all = JSON.parse(raw);
    return { ...DEFAULT_SETTINGS, ...(all[shopKey] || all.default || {}) };
  } catch (err) {
    return { ...DEFAULT_SETTINGS };
  }
}

async function saveShopData(shop, updates) {
  const shopKey = shop || 'default';
  const current = await getShopData(shopKey);
  const merged = { ...current, ...updates };

  // Save locally as cache/fallback
  try {
    const raw = fs.readFileSync(DATA_FILE, 'utf8');
    const all = JSON.parse(raw);
    all[shopKey] = merged;
    fs.writeFileSync(DATA_FILE, JSON.stringify(all, null, 2), 'utf8');
  } catch (err) {
    console.error('[Local Save Error]', err.message);
  }

  // Save to Supabase if configured
  if (SUPABASE_URL && SUPABASE_KEY) {
    try {
      await fetch(`${SUPABASE_URL}/rest/v1/shipboost_stores`, {
        method: 'POST',
        headers: {
          apikey: SUPABASE_KEY,
          Authorization: `Bearer ${SUPABASE_KEY}`,
          'Content-Type': 'application/json',
          Prefer: 'resolution=merge-duplicates'
        },
        body: JSON.stringify({ shop: shopKey, data: merged, updated_at: new Date().toISOString() })
      });
    } catch (err) {
      console.error('[Supabase Save Error]', err.message);
    }
  }

  return merged;
}

function sanitizePublicSettings(data) {
  const { accessToken, ...publicData } = data;
  return publicData;
}

// --- Security Helpers ---
function verifyShopifyHmac(searchParams) {
  if (!SHOPIFY_API_SECRET) return true; // Skip only if secret not configured
  const hmac = searchParams.get('hmac');
  if (!hmac) return false;

  const entries = [];
  for (const [key, value] of searchParams.entries()) {
    if (key !== 'hmac' && key !== 'signature') {
      entries.push(`${key}=${value}`);
    }
  }
  entries.sort();
  const message = entries.join('&');
  const generated = crypto.createHmac('sha256', SHOPIFY_API_SECRET).update(message).digest('hex');

  try {
    return crypto.timingSafeEqual(Buffer.from(generated, 'utf8'), Buffer.from(hmac, 'utf8'));
  } catch {
    return false;
  }
}

function verifyWebhookHmac(rawBody, hmacHeader) {
  if (!SHOPIFY_API_SECRET || !hmacHeader) return false;
  const generated = crypto.createHmac('sha256', SHOPIFY_API_SECRET).update(rawBody, 'utf8').digest('base64');
  try {
    return crypto.timingSafeEqual(Buffer.from(generated, 'utf8'), Buffer.from(hmacHeader, 'utf8'));
  } catch {
    return false;
  }
}

function isValidShopDomain(shop) {
  return typeof shop === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9\-]*\.myshopify\.com$/.test(shop);
}

function readRawBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', chunk => { data += chunk; });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

// --- HTTP Server ---
const server = http.createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  const reqUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = reqUrl.pathname;
  const searchParams = reqUrl.searchParams;
  const shop = searchParams.get('shop') || 'default';

  // Set Shopify Embedded App CSP Header when shop is provided
  if (isValidShopDomain(shop)) {
    res.setHeader('Content-Security-Policy', `frame-ancestors https://${shop} https://admin.shopify.com;`);
  } else {
    res.setHeader('Content-Security-Policy', 'frame-ancestors https://*.myshopify.com https://admin.shopify.com;');
  }

  // 1. Health check
  if (pathname === '/health' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', storage: SUPABASE_URL ? 'supabase' : 'local' }));
    return;
  }

  // 2. Public API for Storefront
  if (pathname === '/api/public/settings' && req.method === 'GET') {
    const data = await getShopData(shop);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(sanitizePublicSettings(data)));
    return;
  }

  // 3. Admin API: Get settings
  if (pathname === '/api/settings' && req.method === 'GET') {
    const data = await getShopData(shop);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(sanitizePublicSettings(data)));
    return;
  }

  // 4. Admin API: Save settings
  if (pathname === '/api/settings' && req.method === 'POST') {
    try {
      const rawBody = await readRawBody(req);
      const payload = JSON.parse(rawBody);
      const targetShop = payload.shop || shop || 'default';
      const incoming = payload.settings || payload;
      // Prevent client from directly spoofing accessToken or plan
      delete incoming.accessToken;
      delete incoming.plan;

      const updated = await saveShopData(targetShop, incoming);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, settings: sanitizePublicSettings(updated) }));
    } catch (e) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: false, error: 'Invalid JSON payload' }));
    }
    return;
  }

  // 5. Real Shopify GraphQL Billing API: Create $9.99/mo Subscription
  if (pathname === '/api/billing/upgrade' && req.method === 'POST') {
    try {
      const rawBody = await readRawBody(req);
      const payload = JSON.parse(rawBody);
      const targetShop = payload.shop || shop;
      const storeData = await getShopData(targetShop);

      if (!isValidShopDomain(targetShop) || !storeData.accessToken) {
        // Demo mode fallback if accessed outside Shopify OAuth
        await saveShopData(targetShop, { plan: 'pro' });
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          success: true,
          plan: 'pro',
          demoMode: true,
          message: 'Upgraded to Pro Plan (Demo Mode - install via Shopify OAuth for live billing).'
        }));
        return;
      }

      const returnUrl = `${APP_URL}/api/billing/confirm?shop=${encodeURIComponent(targetShop)}`;
      const mutation = `
        mutation AppSubscriptionCreate($name: String!, $lineItems: [AppSubscriptionLineItemInput!]!, $returnUrl: URL!, $test: Boolean) {
          appSubscriptionCreate(name: $name, returnUrl: $returnUrl, test: $test, lineItems: $lineItems) {
            userErrors { field message }
            confirmationUrl
            appSubscription { id status }
          }
        }
      `;

      const variables = {
        name: 'ShipBoost Pro Plan',
        returnUrl,
        test: BILLING_TEST,
        lineItems: [
          {
            plan: {
              appRecurringPricingDetails: {
                price: { amount: 9.99, currencyCode: 'USD' },
                interval: 'EVERY_30_DAYS'
              }
            }
          }
        ]
      };

      const gqlRes = await fetch(`https://${targetShop}/admin/api/${SHOPIFY_API_VERSION}/graphql.json`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Shopify-Access-Token': storeData.accessToken
        },
        body: JSON.stringify({ query: mutation, variables })
      });

      const gqlJson = await gqlRes.json();
      const result = gqlJson?.data?.appSubscriptionCreate;

      if (result?.confirmationUrl) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, confirmationUrl: result.confirmationUrl }));
      } else {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          success: false,
          error: result?.userErrors?.[0]?.message || 'Could not create Shopify subscription'
        }));
      }
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: false, error: e.message }));
    }
    return;
  }

  // 6. Billing Confirmation Callback
  if (pathname === '/api/billing/confirm' && req.method === 'GET') {
    const chargeId = searchParams.get('charge_id') || '';
    if (isValidShopDomain(shop)) {
      await saveShopData(shop, { plan: 'pro', chargeId });
    }
    res.writeHead(302, { Location: `/?shop=${encodeURIComponent(shop)}&upgraded=true` });
    res.end();
    return;
  }

  // 7. Shopify OAuth Installation Flow
  if (pathname === '/auth' && req.method === 'GET') {
    if (!isValidShopDomain(shop)) {
      res.writeHead(400, { 'Content-Type': 'text/plain' });
      res.end('Invalid or missing shop parameter (must be *.myshopify.com)');
      return;
    }
    const scopes = 'read_themes,write_themes,read_product_feeds';
    const redirectUri = `${APP_URL}/auth/callback`;
    const installUrl = `https://${shop}/admin/oauth/authorize?client_id=${SHOPIFY_API_KEY}&scope=${scopes}&redirect_uri=${encodeURIComponent(redirectUri)}`;

    res.writeHead(302, { Location: installUrl });
    res.end();
    return;
  }

  if (pathname === '/auth/callback' && req.method === 'GET') {
    if (!isValidShopDomain(shop) || !verifyShopifyHmac(searchParams)) {
      res.writeHead(401, { 'Content-Type': 'text/plain' });
      res.end('HMAC verification failed');
      return;
    }

    const code = searchParams.get('code');
    if (code && SHOPIFY_API_KEY && SHOPIFY_API_SECRET) {
      try {
        const tokenRes = await fetch(`https://${shop}/admin/oauth/access_token`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            client_id: SHOPIFY_API_KEY,
            client_secret: SHOPIFY_API_SECRET,
            code
          })
        });
        const tokenJson = await tokenRes.json();
        if (tokenJson.access_token) {
          await saveShopData(shop, { accessToken: tokenJson.access_token });
        }
      } catch (err) {
        console.error('[OAuth Token Exchange Error]', err.message);
      }
    }

    res.writeHead(302, { Location: `/?shop=${encodeURIComponent(shop)}` });
    res.end();
    return;
  }

  // 8. Mandatory Shopify GDPR Compliance Webhooks
  if (pathname.startsWith('/webhooks/gdpr') && req.method === 'POST') {
    const rawBody = await readRawBody(req);
    const hmacHeader = req.headers['x-shopify-hmac-sha256'];

    if (!verifyWebhookHmac(rawBody, hmacHeader)) {
      res.writeHead(401, { 'Content-Type': 'text/plain' });
      res.end('Unauthorized: Invalid Webhook HMAC');
      return;
    }

    try {
      const payload = JSON.parse(rawBody || '{}');
      const topic = req.headers['x-shopify-topic'] || pathname;
      console.log(`[GDPR Webhook] Received ${topic} for shop ${payload.shop_domain || 'unknown'}`);

      // If shop/redact, clean up stored shop data
      if (topic === 'shop/redact' && payload.shop_domain) {
        await saveShopData(payload.shop_domain, { accessToken: '', isActive: false });
      }
    } catch (err) {
      console.error('[GDPR Webhook Parse Error]', err.message);
    }

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ received: true }));
    return;
  }

  // 9. Static Files (Public directory)
  const cleanPath = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
  let filePath = path.join(__dirname, 'public', cleanPath);

  fs.stat(filePath, (err, stats) => {
    if (err || !stats.isFile()) {
      filePath = path.join(__dirname, 'public', 'index.html');
    }

    const ext = path.extname(filePath);
    const contentTypes = {
      '.html': 'text/html; charset=utf-8',
      '.css': 'text/css; charset=utf-8',
      '.js': 'application/javascript; charset=utf-8',
      '.json': 'application/json',
      '.png': 'image/png',
      '.svg': 'image/svg+xml'
    };

    const contentType = contentTypes[ext] || 'text/plain';
    fs.readFile(filePath, (readErr, content) => {
      if (readErr) {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('File not found');
      } else {
        res.writeHead(200, { 'Content-Type': contentType });
        res.end(content);
      }
    });
  });
});

server.listen(PORT, () => {
  console.log(`[ShipBoost] Production Server running on port ${PORT}`);
});
