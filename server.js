/**
 * ShipBoost - Shopify Backend Server
 * Built with native Node.js HTTP (Zero external dependencies needed to run!)
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');
const querystring = require('querystring');
const crypto = require('crypto');

const PORT = process.env.PORT || 3000;
const SHOPIFY_API_KEY = process.env.SHOPIFY_API_KEY || 'your_api_key_here';
const SHOPIFY_API_SECRET = process.env.SHOPIFY_API_SECRET || 'your_api_secret_here';
const APP_URL = process.env.APP_URL || `http://localhost:${PORT}`;

const DATA_FILE = path.join(__dirname, 'data', 'settings.json');

// Ensure data file exists
if (!fs.existsSync(DATA_FILE)) {
  const initialData = {
    "default": {
      "isActive": true,
      "goalAmount": 50.00,
      "currencySymbol": "$",
      "initialMessage": "Free Shipping on orders over {goal}! 🚚",
      "progressMessage": "Add {remaining} more to unlock FREE SHIPPING! 📦",
      "successMessage": "🎉 Congratulations! You unlocked FREE SHIPPING!",
      "backgroundColor": "#111827",
      "textColor": "#ffffff",
      "progressColor": "#10b981",
      "position": "top",
      "plan": "free"
    }
  };
  fs.writeFileSync(DATA_FILE, JSON.stringify(initialData, null, 2), 'utf8');
}

function getSettings(shop) {
  try {
    const raw = fs.readFileSync(DATA_FILE, 'utf8');
    const all = JSON.parse(raw);
    return all[shop] || all['default'];
  } catch (err) {
    return {
      isActive: true,
      goalAmount: 50.00,
      currencySymbol: "$",
      initialMessage: "Free Shipping on orders over {goal}! 🚚",
      progressMessage: "Add {remaining} more to unlock FREE SHIPPING! 📦",
      successMessage: "🎉 Congratulations! You unlocked FREE SHIPPING!",
      backgroundColor: "#111827",
      textColor: "#ffffff",
      progressColor: "#10b981",
      position: "top",
      plan: "free"
    };
  }
}

function saveSettings(shop, settings) {
  try {
    const raw = fs.readFileSync(DATA_FILE, 'utf8');
    const all = JSON.parse(raw);
    all[shop] = { ...getSettings(shop), ...settings };
    fs.writeFileSync(DATA_FILE, JSON.stringify(all, null, 2), 'utf8');
    return all[shop];
  } catch (err) {
    console.error('Error saving settings:', err);
    return null;
  }
}

const server = http.createServer((req, res) => {
  // CORS Headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  const parsedUrl = url.parse(req.url, true);
  const pathname = parsedUrl.pathname;
  const query = parsedUrl.query;

  // 1. Public API for Storefront
  if (pathname === '/api/public/settings' && req.method === 'GET') {
    const shop = query.shop || 'default';
    const settings = getSettings(shop);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(settings));
    return;
  }

  // 2. Admin API: Get settings
  if (pathname === '/api/settings' && req.method === 'GET') {
    const shop = query.shop || 'default';
    const settings = getSettings(shop);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(settings));
    return;
  }

  // 3. Admin API: Save settings
  if (pathname === '/api/settings' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try {
        const payload = JSON.parse(body);
        const shop = payload.shop || query.shop || 'default';
        const updated = saveSettings(shop, payload.settings || payload);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, settings: updated }));
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: 'Invalid JSON payload' }));
      }
    });
    return;
  }

  // 4. Billing API: Upgrade plan
  if (pathname === '/api/billing/upgrade' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try {
        const payload = JSON.parse(body);
        const shop = payload.shop || query.shop || 'default';
        // Upgrade store to Pro Plan ($9.99/mo)
        saveSettings(shop, { plan: 'pro' });
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          success: true,
          plan: 'pro',
          message: 'Upgraded to Pro Plan ($9.99/month)!'
        }));
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: e.message }));
      }
    });
    return;
  }

  // 5. Shopify OAuth Installation Flow
  if (pathname === '/auth') {
    const shop = query.shop;
    if (!shop) {
      res.writeHead(400, { 'Content-Type': 'text/plain' });
      res.end('Missing shop parameter');
      return;
    }
    const scopes = 'write_themes,read_themes,read_products,read_cart';
    const redirectUri = `${APP_URL}/auth/callback`;
    const installUrl = `https://${shop}/admin/oauth/authorize?client_id=${SHOPIFY_API_KEY}&scope=${scopes}&redirect_uri=${encodeURIComponent(redirectUri)}`;

    res.writeHead(302, { Location: installUrl });
    res.end();
    return;
  }

  if (pathname === '/auth/callback') {
    const shop = query.shop;
    // Redirect to Admin Dashboard inside Shopify Embedded App
    res.writeHead(302, { Location: `/?shop=${encodeURIComponent(shop || 'default')}` });
    res.end();
    return;
  }

  // 6. Static Files (Public directory)
  let filePath = path.join(__dirname, 'public', pathname === '/' ? 'index.html' : pathname);

  fs.stat(filePath, (err, stats) => {
    if (err || !stats.isFile()) {
      // Fallback to index.html for SPA routes
      filePath = path.join(__dirname, 'public', 'index.html');
    }

    const ext = path.extname(filePath);
    const contentTypes = {
      '.html': 'text/html; charset=utf-8',
      '.css': 'text/css',
      '.js': 'application/javascript',
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
  console.log(`[ShipBoost] Shopify App running on http://localhost:${PORT}`);
});
