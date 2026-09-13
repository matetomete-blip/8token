// TODO [PRODUÇÃO]:
// 1. Substituir JWT_SECRET por uma secret forte gerada com crypto.randomBytes(32)
// 2. Configurar GOOGLE_CLIENT_ID real no .env (ver instruções no arquivo .env)
// 3. Adicionar rate limiting (express-rate-limit) nas rotas de auth
// 4. Adicionar helmet() para headers de segurança HTTP
// 5. Substituir sql.js por PostgreSQL ou MySQL para persistência real em produção
//    (sql.js salva em arquivo local — perde dados se o processo crashar durante escrita)
// 6. Adicionar validação de input com express-validator ou zod
// 7. Configurar CORS apenas para o domínio de produção, não wildcard
// 8. Adicionar logging estruturado (winston ou pino) ao invés de console.log
// 9. O endpoint POST /api/invoices/:id/pay é apenas simulação — integrar com
//    gateway de pagamento real (Mercado Pago, Stripe, Asaas) para confirmar PIX
// 10. Adicionar refresh tokens e rotação de JWT
// 11. Servir via HTTPS em produção (nginx reverse proxy ou similar)

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const initSqlJs = require('sql.js');
const { OAuth2Client } = require('google-auth-library');
const path = require('path');
const crypto = require('crypto');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3001;
const JWT_SECRET = process.env.JWT_SECRET || '8token-secret-key-change-in-production-' + crypto.randomBytes(16).toString('hex');
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || '';
const DB_PATH = path.join(__dirname, '8token.db');

// Middleware
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname)));

// Trust proxy for correct IP behind Vercel / nginx / Cloudflare
app.set('trust proxy', true);

// Middleware: capture real IP into req.clientIp
app.use((req, res, next) => {
  const forwarded = req.headers['x-forwarded-for'];
  let ip;
  if (forwarded) {
    ip = String(forwarded).split(',')[0].trim();
  } else {
    ip = req.socket.remoteAddress || '';
  }
  // Normalize IPv6 loopback to IPv4
  if (ip === '::1' || ip === '::ffff:127.0.0.1') ip = '127.0.0.1';
  req.clientIp = ip;
  next();
});

let db;

async function initDB() {
  const SQL = await initSqlJs();
  if (fs.existsSync(DB_PATH)) {
    const buffer = fs.readFileSync(DB_PATH);
    db = new SQL.Database(buffer);
  } else {
    db = new SQL.Database();
  }

  db.run(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT,
      name TEXT,
      google_id TEXT UNIQUE,
      avatar_url TEXT,
      plan TEXT DEFAULT 'free',
      plan_expires_at TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS api_keys (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      key_hash TEXT NOT NULL,
      key_prefix TEXT NOT NULL,
      key_suffix TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now')),
      last_used_at TEXT,
      revoked INTEGER DEFAULT 0,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS invoices (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      plan TEXT NOT NULL,
      amount REAL NOT NULL,
      currency TEXT DEFAULT 'BRL',
      status TEXT DEFAULT 'pending',
      pix_code TEXT,
      pix_qr_base64 TEXT,
      paid_at TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      expires_at TEXT,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS usage_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      model TEXT NOT NULL,
      tokens_in INTEGER DEFAULT 0,
      tokens_out INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS ip_subscriptions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ip TEXT NOT NULL,
      user_id INTEGER,
      plan TEXT NOT NULL DEFAULT 'free',
      status TEXT NOT NULL DEFAULT 'active',
      notes TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      expires_at TEXT,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
    )
  `);

  db.run(`CREATE UNIQUE INDEX IF NOT EXISTS idx_ip_subscriptions_ip ON ip_subscriptions(ip)`);

  // --- AFFILIATES ---
  db.run(`
    CREATE TABLE IF NOT EXISTS affiliates (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL UNIQUE,
      commission_pct REAL NOT NULL DEFAULT 10,
      code TEXT NOT NULL UNIQUE,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `);

  // Track which affiliate referred each paying user
  db.run(`
    CREATE TABLE IF NOT EXISTS affiliate_referrals (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      affiliate_id INTEGER NOT NULL,
      referred_user_id INTEGER NOT NULL,
      referred_ip TEXT,
      plan TEXT,
      amount REAL DEFAULT 0,
      paid_at TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (affiliate_id) REFERENCES affiliates(id) ON DELETE CASCADE,
      FOREIGN KEY (referred_user_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `);

  // IP activation requests — created when a user pays, admin approves to release key+gateway
  db.run(`
    CREATE TABLE IF NOT EXISTS ip_activation_requests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ip TEXT NOT NULL,
      user_id INTEGER,
      invoice_id INTEGER,
      plan TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      api_key TEXT,
      gateway_url TEXT,
      notes TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      resolved_at TEXT,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL,
      FOREIGN KEY (invoice_id) REFERENCES invoices(id) ON DELETE SET NULL
    )
  `);

  // Notifications for users (e.g. "your IP was activated")
  db.run(`
    CREATE TABLE IF NOT EXISTS notifications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER,
      ip TEXT,
      title TEXT NOT NULL,
      message TEXT NOT NULL,
      type TEXT DEFAULT 'info',
      read INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `);

  // --- COUPONS ---
  db.run(`
    CREATE TABLE IF NOT EXISTS coupons (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      code TEXT NOT NULL UNIQUE,
      discount_pct REAL NOT NULL DEFAULT 10,
      max_uses INTEGER DEFAULT NULL,
      uses_count INTEGER DEFAULT 0,
      expires_at TEXT DEFAULT NULL,
      active INTEGER DEFAULT 1,
      notes TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    )
  `);

  // Webhook logs — stores all incoming Kirvano webhook events for debugging
  db.run(`
    CREATE TABLE IF NOT EXISTS webhook_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_type TEXT NOT NULL,
      sale_id TEXT,
      payload TEXT NOT NULL,
      received_at TEXT DEFAULT (datetime('now'))
    )
  `);

  // Add kirvano_sale_id column to ip_activation_requests if missing
  try {
    const actCols = getAllRows("PRAGMA table_info(ip_activation_requests)");
    if (!actCols.find(c => c.name === 'kirvano_sale_id')) {
      db.run("ALTER TABLE ip_activation_requests ADD COLUMN kirvano_sale_id TEXT");
    }
  } catch (e) { /* column may already exist */ }

  // Add affiliate_code column to users if missing (safe alter via try/catch pattern using pragma)
  try {
    const cols = getAllRows("PRAGMA table_info(users)");
    if (!cols.some(c => c.name === 'affiliate_code')) {
      db.run("ALTER TABLE users ADD COLUMN affiliate_code TEXT");
    }
    if (!cols.some(c => c.name === 'referred_by_affiliate_id')) {
      db.run("ALTER TABLE users ADD COLUMN referred_by_affiliate_id INTEGER");
    }
  } catch (e) { /* columns may already exist */ }

  // Add has_additional_ip and additional_ip columns to ip_subscriptions if missing
  try {
    const ipCols = getAllRows("PRAGMA table_info(ip_subscriptions)");
    if (!ipCols.some(c => c.name === 'has_additional_ip')) {
      db.run("ALTER TABLE ip_subscriptions ADD COLUMN has_additional_ip INTEGER DEFAULT 0");
    }
    if (!ipCols.some(c => c.name === 'additional_ip')) {
      db.run("ALTER TABLE ip_subscriptions ADD COLUMN additional_ip TEXT");
    }
  } catch (e) { /* columns may already exist */ }

  // IP change requests — user requests to change their authorized IP
  db.run(`
    CREATE TABLE IF NOT EXISTS ip_change_requests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      old_ip TEXT NOT NULL,
      new_ip TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      notes TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      resolved_at TEXT,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `);

  saveDB();
  console.log('Database initialized.');
}

function saveDB() {
  const data = db.export();
  const buffer = Buffer.from(data);
  fs.writeFileSync(DB_PATH, buffer);
}

// Google OAuth client
const googleClient = GOOGLE_CLIENT_ID ? new OAuth2Client(GOOGLE_CLIENT_ID) : null;

// Auth middleware
function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Token não fornecido' });

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) return res.status(403).json({ error: 'Token inválido' });
    req.user = user;
    next();
  });
}

// Helper: get single row
function getRow(sql, params = []) {
  const stmt = db.prepare(sql);
  stmt.bind(params);
  let row = null;
  if (stmt.step()) {
    row = stmt.getAsObject();
  }
  stmt.free();
  return row;
}

// Helper: get all rows
function getAllRows(sql, params = []) {
  const stmt = db.prepare(sql);
  stmt.bind(params);
  const rows = [];
  while (stmt.step()) {
    rows.push(stmt.getAsObject());
  }
  stmt.free();
  return rows;
}

// Helper: run insert/update
function runSQL(sql, params = []) {
  db.run(sql, params);
  // Get last insert id BEFORE saving (saveDB re-exports and may lose context)
  const result = getRow('SELECT last_insert_rowid() as id');
  saveDB();
  return { lastInsertRowid: result ? result.id : 0, changes: db.getRowsModified() };
}

// Generate API key
function generateApiKey() {
  const bytes = crypto.randomBytes(32);
  return '8tk_' + bytes.toString('hex');
}

// [REMOVED] generatePixCode — replaced by Kirvano checkout integration

// --- AUTH ROUTES ---

// Register
app.post('/api/auth/register', async (req, res) => {
  try {
    const { email, password, name } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: 'Email e senha são obrigatórios' });
    }
    if (password.length < 6) {
      return res.status(400).json({ error: 'Senha deve ter pelo menos 6 caracteres' });
    }

    const existing = getRow('SELECT id FROM users WHERE email = ?', [email]);
    if (existing) {
      return res.status(409).json({ error: 'Email já cadastrado' });
    }

    const passwordHash = await bcrypt.hash(password, 12);
    const displayName = name || email.split('@')[0];
    const result = runSQL(
      'INSERT INTO users (email, password_hash, name) VALUES (?, ?, ?)',
      [email, passwordHash, displayName]
    );

    const token = jwt.sign({ id: result.lastInsertRowid, email }, JWT_SECRET, { expiresIn: '30d' });

    ensureIpRecord(req.clientIp, result.lastInsertRowid);

    res.json({
      token,
      user: { id: result.lastInsertRowid, email, name: displayName }
    });
  } catch (err) {
    console.error('Register error:', err);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// Login
app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: 'Email e senha são obrigatórios' });
    }

    const user = getRow('SELECT * FROM users WHERE email = ?', [email]);
    if (!user) {
      return res.status(401).json({ error: 'Email ou senha incorretos' });
    }
    if (!user.password_hash) {
      return res.status(401).json({ error: 'Esta conta usa login com Google. Use o botão "Continuar com Google".' });
    }

    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) {
      return res.status(401).json({ error: 'Email ou senha incorretos' });
    }

    const token = jwt.sign({ id: user.id, email: user.email }, JWT_SECRET, { expiresIn: '30d' });

    ensureIpRecord(req.clientIp, user.id);

    res.json({
      token,
      user: { id: user.id, email: user.email, name: user.name, plan: user.plan }
    });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// Google OAuth Login
app.post('/api/auth/google', async (req, res) => {
  try {
    const { credential } = req.body;
    if (!credential) {
      return res.status(400).json({ error: 'Credencial do Google não fornecida' });
    }

    let payload;
    if (googleClient) {
      const ticket = await googleClient.verifyIdToken({
        idToken: credential,
        audience: GOOGLE_CLIENT_ID,
      });
      payload = ticket.getPayload();
    } else {
      // Fallback: decode JWT without verification for demo
      payload = JSON.parse(Buffer.from(credential.split('.')[1], 'base64').toString());
    }

    const { email, name, picture, sub: googleId } = payload;
    if (!email) return res.status(400).json({ error: 'Email não encontrado no token Google' });

    let user = getRow('SELECT * FROM users WHERE google_id = ? OR email = ?', [googleId, email]);

    if (!user) {
      const result = runSQL(
        'INSERT INTO users (email, name, google_id, avatar_url) VALUES (?, ?, ?, ?)',
        [email, name, googleId, picture]
      );
      user = { id: result.lastInsertRowid, email, name, plan: 'free' };
    } else if (!user.google_id) {
      db.run('UPDATE users SET google_id = ?, avatar_url = ?, name = COALESCE(name, ?), updated_at = datetime("now") WHERE id = ?',
        [googleId, picture, name, user.id]);
      saveDB();
      user.name = user.name || name;
    }

    const token = jwt.sign({ id: user.id, email: user.email }, JWT_SECRET, { expiresIn: '30d' });

    ensureIpRecord(req.clientIp, user.id);

    res.json({
      token,
      user: { id: user.id, email: user.email, name: user.name || name, plan: user.plan }
    });
  } catch (err) {
    console.error('Google auth error:', err);
    res.status(500).json({ error: 'Erro na autenticação com Google' });
  }
});

// --- USER ROUTES ---

app.get('/api/user/profile', authenticateToken, (req, res) => {
  const user = getRow(
    'SELECT id, email, name, plan, plan_expires_at, avatar_url, created_at FROM users WHERE id = ?',
    [req.user.id]
  );
  if (!user) return res.status(404).json({ error: 'Usuário não encontrado' });
  res.json(user);
});

// --- NOTIFICATIONS ---
app.get('/api/notifications', authenticateToken, (req, res) => {
  const notifications = getAllRows(
    'SELECT id, title, message, type, read, created_at FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT 50',
    [req.user.id]
  );
  res.json(notifications);
});

app.put('/api/notifications/:id/read', authenticateToken, (req, res) => {
  db.run("UPDATE notifications SET read = 1 WHERE id = ? AND user_id = ?", [req.params.id, req.user.id]);
  saveDB();
  res.json({ success: true });
});

app.put('/api/notifications/read-all', authenticateToken, (req, res) => {
  db.run("UPDATE notifications SET read = 1 WHERE user_id = ?", [req.user.id]);
  saveDB();
  res.json({ success: true });
});

app.put('/api/user/email', authenticateToken, (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ error: 'Email é obrigatório' });

  const existing = getRow('SELECT id FROM users WHERE email = ? AND id != ?', [email, req.user.id]);
  if (existing) return res.status(409).json({ error: 'Email já está em uso por outra conta' });

  db.run('UPDATE users SET email = ?, updated_at = datetime("now") WHERE id = ?', [email, req.user.id]);
  saveDB();
  res.json({ success: true, email });
});

app.put('/api/user/password', authenticateToken, async (req, res) => {
  const { currentPassword, newPassword } = req.body;
  if (!newPassword || newPassword.length < 6) {
    return res.status(400).json({ error: 'Nova senha deve ter pelo menos 6 caracteres' });
  }

  const user = getRow('SELECT password_hash FROM users WHERE id = ?', [req.user.id]);
  if (user.password_hash && currentPassword) {
    const valid = await bcrypt.compare(currentPassword, user.password_hash);
    if (!valid) return res.status(401).json({ error: 'Senha atual incorreta' });
  }

  const hash = await bcrypt.hash(newPassword, 12);
  db.run('UPDATE users SET password_hash = ?, updated_at = datetime("now") WHERE id = ?', [hash, req.user.id]);
  saveDB();
  res.json({ success: true });
});

app.put('/api/user/name', authenticateToken, (req, res) => {
  const { name } = req.body;
  if (!name) return res.status(400).json({ error: 'Nome é obrigatório' });
  db.run('UPDATE users SET name = ?, updated_at = datetime("now") WHERE id = ?', [name, req.user.id]);
  saveDB();
  res.json({ success: true, name });
});

// --- API KEYS ---

app.get('/api/keys', authenticateToken, (req, res) => {
  const keys = getAllRows(
    'SELECT id, name, key_prefix, key_suffix, created_at, last_used_at, revoked FROM api_keys WHERE user_id = ? ORDER BY created_at DESC',
    [req.user.id]
  );
  res.json(keys);
});

app.post('/api/keys', authenticateToken, (req, res) => {
  const { name } = req.body;
  const apiKey = generateApiKey();
  const keyHash = crypto.createHash('sha256').update(apiKey).digest('hex');
  const prefix = apiKey.slice(0, 8);
  const suffix = apiKey.slice(-4);

  const result = runSQL(
    'INSERT INTO api_keys (user_id, name, key_hash, key_prefix, key_suffix) VALUES (?, ?, ?, ?, ?)',
    [req.user.id, name || 'Nova chave', keyHash, prefix, suffix]
  );

  res.json({ id: result.lastInsertRowid, key: apiKey, name: name || 'Nova chave', prefix, suffix });
});

app.delete('/api/keys/:id', authenticateToken, (req, res) => {
  db.run('UPDATE api_keys SET revoked = 1 WHERE id = ? AND user_id = ?', [req.params.id, req.user.id]);
  saveDB();
  res.json({ success: true });
});

// --- KIRVANO INTEGRATION ---

// Canonical plan prices — single source of truth
const PLAN_PRICES = { mensal: 110, trimestral: 399, anual: 1100 };

// Kirvano product mapping: plan name → Kirvano checkout URL
// Configure these in .env: KIRVANO_CHECKOUT_MENSAL, KIRVANO_CHECKOUT_TRIMESTRAL, KIRVANO_CHECKOUT_ANUAL
const KIRVANO_CHECKOUTS = {
  mensal: process.env.KIRVANO_CHECKOUT_MENSAL || '',
  trimestral: process.env.KIRVANO_CHECKOUT_TRIMESTRAL || '',
  anual: process.env.KIRVANO_CHECKOUT_ANUAL || '',
};

// Kirvano webhook token for authentication
const KIRVANO_WEBHOOK_TOKEN = process.env.KIRVANO_WEBHOOK_TOKEN || '';

// Map Kirvano product names/IDs to our internal plan names
// Configure in .env: KIRVANO_PRODUCT_MENSAL_ID, KIRVANO_PRODUCT_TRIMESTRAL_ID, KIRVANO_PRODUCT_ANUAL_ID
const KIRVANO_PRODUCT_MAP = {};
if (process.env.KIRVANO_PRODUCT_MENSAL_ID) KIRVANO_PRODUCT_MAP[process.env.KIRVANO_PRODUCT_MENSAL_ID] = 'mensal';
if (process.env.KIRVANO_PRODUCT_TRIMESTRAL_ID) KIRVANO_PRODUCT_MAP[process.env.KIRVANO_PRODUCT_TRIMESTRAL_ID] = 'trimestral';
if (process.env.KIRVANO_PRODUCT_ANUAL_ID) KIRVANO_PRODUCT_MAP[process.env.KIRVANO_PRODUCT_ANUAL_ID] = 'anual';

// Also map by product name (case-insensitive partial match)
function resolvePlanFromKirvano(products) {
  if (!products || !products.length) return null;
  // First try by product ID
  for (const p of products) {
    if (p.id && KIRVANO_PRODUCT_MAP[p.id]) return KIRVANO_PRODUCT_MAP[p.id];
    if (p.offer_id && KIRVANO_PRODUCT_MAP[p.offer_id]) return KIRVANO_PRODUCT_MAP[p.offer_id];
  }
  // Fallback: match by product name
  for (const p of products) {
    const name = (p.name || '').toLowerCase();
    if (name.includes('mensal') || name.includes('monthly')) return 'mensal';
    if (name.includes('trimestral') || name.includes('quarterly')) return 'trimestral';
    if (name.includes('anual') || name.includes('annual') || name.includes('yearly')) return 'anual';
  }
  return null;
}

// Plan expiry durations in ms
const PLAN_EXPIRY_MS = {
  mensal: 30 * 24 * 60 * 60 * 1000,
  trimestral: 90 * 24 * 60 * 60 * 1000,
  anual: 365 * 24 * 60 * 60 * 1000,
};

// --- CHECKOUT: redirect user to Kirvano ---
app.get('/api/checkout/:plan', authenticateToken, (req, res) => {
  const { plan } = req.params;
  const checkoutUrl = KIRVANO_CHECKOUTS[plan];
  if (!checkoutUrl) {
    return res.status(400).json({ error: `Checkout não configurado para o plano ${plan}. Defina KIRVANO_CHECKOUT_${plan.toUpperCase()} no .env` });
  }
  // Get user email for pre-filling checkout
  const user = getRow('SELECT id, email FROM users WHERE id = ?', [req.user.id]);

  // Save pending purchase record
  runSQL(
    "INSERT INTO invoices (user_id, plan, amount, status, created_at) VALUES (?, ?, ?, 'pending', datetime('now'))",
    [req.user.id, plan, PLAN_PRICES[plan] || 0]
  );
  saveDB();

  // Redirect to Kirvano checkout with customer email pre-filled
  const separator = checkoutUrl.includes('?') ? '&' : '?';
  const redirectUrl = `${checkoutUrl}${separator}email=${encodeURIComponent(user?.email || '')}`;
  res.json({ redirect_url: redirectUrl, plan });
});

// --- WEBHOOK: receive Kirvano events ---
app.post('/api/webhooks/kirvano', (req, res) => {
  // Authenticate webhook via token header
  const authHeader = req.headers['authorization'] || req.headers['x-webhook-token'] || '';
  const token = authHeader.replace('Bearer ', '').trim();
  if (KIRVANO_WEBHOOK_TOKEN && token !== KIRVANO_WEBHOOK_TOKEN) {
    console.log('[Kirvano Webhook] Unauthorized attempt');
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const payload = req.body;
  const event = payload.event;
  console.log(`[Kirvano Webhook] Received event: ${event} | sale_id: ${payload.sale_id} | status: ${payload.status}`);

  // Log all webhook events for debugging
  runSQL(
    "INSERT INTO webhook_logs (event_type, sale_id, payload, received_at) VALUES (?, ?, ?, datetime('now'))",
    [event, payload.sale_id || null, JSON.stringify(payload)]
  );
  saveDB();

  // Handle SALE_APPROVED — activate the user's plan
  if (event === 'SALE_APPROVED') {
    const customerEmail = payload.customer?.email;
    const plan = resolvePlanFromKirvano(payload.products);
    const saleId = payload.sale_id;
    const totalPrice = payload.total_price;

    if (!customerEmail) {
      console.log('[Kirvano Webhook] SALE_APPROVED but no customer email');
      saveDB();
      return res.json({ received: true, warning: 'No customer email' });
    }

    if (!plan) {
      console.log('[Kirvano Webhook] SALE_APPROVED but could not resolve plan from products:', JSON.stringify(payload.products));
      saveDB();
      return res.json({ received: true, warning: 'Could not resolve plan' });
    }

    // Find user by email
    const user = getRow('SELECT id FROM users WHERE email = ?', [customerEmail]);
    if (!user) {
      console.log(`[Kirvano Webhook] SALE_APPROVED but no user found for email: ${customerEmail}`);
      // Still mark as received — admin can manually activate
      saveDB();
      return res.json({ received: true, warning: 'User not found', email: customerEmail });
    }

    // Get user's IP from ip_subscriptions table
    const userSub = getRow('SELECT ip FROM ip_subscriptions WHERE user_id = ?', [user.id]);
    const userIp = userSub?.ip || '';

    // Calculate expiry
    const expiresAt = new Date(Date.now() + (PLAN_EXPIRY_MS[plan] || PLAN_EXPIRY_MS.mensal)).toISOString();

    // Update user plan
    db.run("UPDATE users SET plan = ?, plan_expires_at = ?, updated_at = datetime('now') WHERE id = ?",
      [plan, expiresAt, user.id]);

    // Update or create IP subscription
    const existingSub = getRow('SELECT id FROM ip_subscriptions WHERE user_id = ?', [user.id]);
    if (existingSub) {
      db.run("UPDATE ip_subscriptions SET plan = ?, status = 'active', expires_at = ?, updated_at = datetime('now') WHERE id = ?",
        [plan, expiresAt, existingSub.id]);
    } else if (userIp) {
      runSQL("INSERT INTO ip_subscriptions (ip, user_id, plan, status, expires_at) VALUES (?, ?, ?, 'active', ?)",
        [userIp, user.id, plan, expiresAt]);
    }

    // Create activation request for admin approval (releases API key + gateway)
    runSQL("INSERT INTO ip_activation_requests (ip, user_id, invoice_id, plan, status, kirvano_sale_id) VALUES (?, ?, NULL, ?, 'pending', ?)",
      [userIp, user.id, plan, saleId]);

    // Update any pending invoice for this user+plan
    db.run("UPDATE invoices SET status = 'paid', paid_at = datetime('now'), amount = ? WHERE user_id = ? AND plan = ? AND status = 'pending'",
      [parseFloat((totalPrice || '0').replace(/[^\d.,]/g, '').replace(',', '.')) || PLAN_PRICES[plan], user.id, plan]);

    // Notify user
    runSQL("INSERT INTO notifications (user_id, ip, title, message, type) VALUES (?, ?, ?, ?, ?)",
      [user.id, userIp, 'Pagamento Confirmado!', `Seu plano ${plan} foi ativado com sucesso! Aguarde a aprovação do admin para liberar sua chave API e URL do gateway.`, 'success']);

    console.log(`[Kirvano Webhook] Activated plan ${plan} for user ${customerEmail} (id=${user.id}), expires ${expiresAt}`);
    saveDB();
    return res.json({ received: true, activated: true, plan, email: customerEmail });
  }

  // Helper: get user IP from ip_subscriptions
  function getUserIp(userId) {
    const sub = getRow('SELECT ip FROM ip_subscriptions WHERE user_id = ?', [userId]);
    return sub?.ip || '';
  }

  // Handle SALE_CHARGEBACK — deactivate the user's plan
  if (event === 'SALE_CHARGEBACK') {
    const customerEmail = payload.customer?.email;
    if (customerEmail) {
      const user = getRow('SELECT id FROM users WHERE email = ?', [customerEmail]);
      if (user) {
        const userIp = getUserIp(user.id);
        db.run("UPDATE users SET plan = 'free', plan_expires_at = NULL, updated_at = datetime('now') WHERE id = ?", [user.id]);
        db.run("UPDATE ip_subscriptions SET status = 'suspended', updated_at = datetime('now') WHERE user_id = ?", [user.id]);
        runSQL("INSERT INTO notifications (user_id, ip, title, message, type) VALUES (?, ?, ?, ?, ?)",
          [user.id, userIp, 'Chargeback Detectado', 'Um chargeback foi identificado na sua compra. Seu acesso foi suspenso. Entre em contato com o suporte.', 'error']);
        console.log(`[Kirvano Webhook] Chargeback: deactivated user ${customerEmail}`);
      }
    }
    saveDB();
    return res.json({ received: true, event: 'chargeback_handled' });
  }

  // Handle SALE_REFUSED — notify user
  if (event === 'SALE_REFUSED') {
    const customerEmail = payload.customer?.email;
    if (customerEmail) {
      const user = getRow('SELECT id FROM users WHERE email = ?', [customerEmail]);
      if (user) {
        const userIp = getUserIp(user.id);
        runSQL("INSERT INTO notifications (user_id, ip, title, message, type) VALUES (?, ?, ?, ?, ?)",
          [user.id, userIp, 'Compra Recusada', 'Sua compra foi recusada pelo gateway de pagamento. Tente novamente com outro método de pagamento.', 'error']);
      }
    }
    saveDB();
    return res.json({ received: true, event: 'refused_notified' });
  }

  // Handle SUBSCRIPTION_CANCELLED / ASSINATURA_CANCELADA
  if (event === 'SUBSCRIPTION_CANCELLED' || event === 'ASSINATURA_CANCELADA') {
    const customerEmail = payload.customer?.email;
    if (customerEmail) {
      const user = getRow('SELECT id FROM users WHERE email = ?', [customerEmail]);
      if (user) {
        const userIp = getUserIp(user.id);
        db.run("UPDATE ip_subscriptions SET status = 'cancelled', updated_at = datetime('now') WHERE user_id = ?", [user.id]);
        runSQL("INSERT INTO notifications (user_id, ip, title, message, type) VALUES (?, ?, ?, ?, ?)",
          [user.id, userIp, 'Assinatura Cancelada', 'Sua assinatura foi cancelada. Seu acesso permanecerá ativo até o fim do período pago.', 'info']);
      }
    }
    saveDB();
    return res.json({ received: true, event: 'subscription_cancelled' });
  }

  // Handle SUBSCRIPTION_EXPIRED / ASSINATURA_VENCIDA
  if (event === 'SUBSCRIPTION_EXPIRED' || event === 'ASSINATURA_VENCIDA') {
    const customerEmail = payload.customer?.email;
    if (customerEmail) {
      const user = getRow('SELECT id FROM users WHERE email = ?', [customerEmail]);
      if (user) {
        const userIp = getUserIp(user.id);
        db.run("UPDATE users SET plan = 'free', plan_expires_at = NULL, updated_at = datetime('now') WHERE id = ?", [user.id]);
        db.run("UPDATE ip_subscriptions SET status = 'expired', updated_at = datetime('now') WHERE user_id = ?", [user.id]);
        runSQL("INSERT INTO notifications (user_id, ip, title, message, type) VALUES (?, ?, ?, ?, ?)",
          [user.id, userIp, 'Assinatura Expirada', 'Sua assinatura expirou. Renove para continuar usando os serviços 8Token.', 'error']);
      }
    }
    saveDB();
    return res.json({ received: true, event: 'subscription_expired' });
  }

  // Handle SUBSCRIPTION_RENEWED / ASSINATURA_RENOVADA
  if (event === 'SUBSCRIPTION_RENEWED' || event === 'ASSINATURA_RENOVADA') {
    const customerEmail = payload.customer?.email;
    const plan = resolvePlanFromKirvano(payload.products);
    if (customerEmail && plan) {
      const user = getRow('SELECT id FROM users WHERE email = ?', [customerEmail]);
      if (user) {
        const userIp = getUserIp(user.id);
        const expiresAt = new Date(Date.now() + (PLAN_EXPIRY_MS[plan] || PLAN_EXPIRY_MS.mensal)).toISOString();
        db.run("UPDATE users SET plan = ?, plan_expires_at = ?, updated_at = datetime('now') WHERE id = ?", [plan, expiresAt, user.id]);
        db.run("UPDATE ip_subscriptions SET plan = ?, status = 'active', expires_at = ?, updated_at = datetime('now') WHERE user_id = ?", [plan, expiresAt, user.id]);
        runSQL("INSERT INTO notifications (user_id, ip, title, message, type) VALUES (?, ?, ?, ?, ?)",
          [user.id, userIp, 'Assinatura Renovada!', `Sua assinatura ${plan} foi renovada automaticamente! Novo vencimento: ${new Date(expiresAt).toLocaleDateString('pt-BR')}.`, 'success']);
      }
    }
    saveDB();
    return res.json({ received: true, event: 'subscription_renewed' });
  }

  // Other events (PIX_GENERATED, BANK_SLIP_GENERATED, etc.) — just log
  console.log(`[Kirvano Webhook] Event ${event} logged (no action needed)`);
  saveDB();
  res.json({ received: true, event });
});

// --- INVOICES (kept for history display) ---
app.get('/api/invoices', authenticateToken, (req, res) => {
  const invoices = getAllRows(
    'SELECT id, plan, amount, currency, status, paid_at, created_at, expires_at FROM invoices WHERE user_id = ? ORDER BY created_at DESC',
    [req.user.id]
  );
  res.json(invoices);
});

// --- USAGE STATS ---

app.get('/api/usage', authenticateToken, (req, res) => {
  const stats = getAllRows(`
    SELECT model, SUM(tokens_in + tokens_out) as total_tokens, COUNT(*) as requests
    FROM usage_logs WHERE user_id = ? AND created_at >= datetime('now', '-30 days')
    GROUP BY model ORDER BY total_tokens DESC
  `, [req.user.id]);

  const totalMessages = getRow(
    "SELECT COUNT(*) as count FROM usage_logs WHERE user_id = ? AND created_at >= datetime('now', '-30 days')",
    [req.user.id]
  );

  res.json({ models: stats, totalMessages: totalMessages ? totalMessages.count : 0 });
});

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', time: new Date().toISOString() });
});

// --- IP SUBSCRIPTION CHECK ---
// Middleware para verificar se o IP tem acesso liberado
function checkIpSubscription(req, res, next) {
  const ip = req.clientIp;
  if (!ip) return res.status(403).json({ error: 'IP não identificado' });

  const sub = getRow(
    "SELECT * FROM ip_subscriptions WHERE ip = ? AND status = 'active'",
    [ip]
  );

  if (!sub) {
    return res.status(403).json({ error: 'IP não autorizado. Entre em contato com o suporte.', ip });
  }

  // Verificar expiração
  if (sub.expires_at && new Date(sub.expires_at) < new Date()) {
    db.run("UPDATE ip_subscriptions SET status = 'expired', updated_at = datetime('now') WHERE id = ?", [sub.id]);
    saveDB();
    return res.status(403).json({ error: 'Assinatura expirada para este IP.', ip, expiredAt: sub.expires_at });
  }

  req.ipSubscription = sub;
  next();
}

// Rota pública para verificar status do IP atual
app.get('/api/ip/status', (req, res) => {
  const ip = req.clientIp;
  const sub = getRow(
    "SELECT plan, status, expires_at FROM ip_subscriptions WHERE ip = ? AND status = 'active'",
    [ip]
  );
  if (!sub) return res.json({ ip, authorized: false, plan: 'none' });
  // Plan upgrade suggestion map
  const upgradeMap = { mensal: 'trimestral', trimestral: 'anual', anual: 'anual' };
  if (sub.expires_at && new Date(sub.expires_at) < new Date()) {
    const daysExpired = Math.floor((new Date() - new Date(sub.expires_at)) / (1000 * 60 * 60 * 24));
    return res.json({ ip, authorized: false, plan: sub.plan, expired: true, daysExpired, suggestedPlan: upgradeMap[sub.plan] || 'trimestral' });
  }
  let daysRemaining = null;
  if (sub.expires_at) {
    daysRemaining = Math.ceil((new Date(sub.expires_at) - new Date()) / (1000 * 60 * 60 * 24));
  }
  const needsWarning = daysRemaining !== null && daysRemaining <= 15;
  res.json({
    ip,
    authorized: true,
    plan: sub.plan,
    expiresAt: sub.expires_at,
    daysRemaining,
    needsWarning,
    suggestedPlan: needsWarning ? (upgradeMap[sub.plan] || 'trimestral') : null
  });
});

// --- USER: IP ADDITIONAL & IP CHANGE ---

// Comprar IP adicional (R$ 74,90/mês) — add-on pós-compra
app.post('/api/user/additional-ip', authenticateToken, (req, res) => {
  const user = req.user;
  const sub = getRow('SELECT * FROM ip_subscriptions WHERE user_id = ? AND status = ?', [user.id, 'active']);
  if (!sub) return res.status(400).json({ error: 'Nenhum plano ativo encontrado.' });
  if (sub.has_additional_ip) return res.status(400).json({ error: 'Você já possui um IP adicional ativo.' });
  if (sub.plan === 'admin' || sub.plan === 'free') return res.status(400).json({ error: 'Planos admin/free não podem comprar IP adicional.' });

  const ADDITIONAL_IP_PRICE = 74.90;
  // Create invoice for additional IP
  runSQL(
    "INSERT INTO invoices (user_id, plan, amount, status, created_at) VALUES (?, ?, ?, 'pending', datetime('now'))",
    [user.id, 'ip_adicional', ADDITIONAL_IP_PRICE]
  );

  // Mark as having additional IP (will be activated after payment confirmation)
  db.run("UPDATE ip_subscriptions SET has_additional_ip = 1, updated_at = datetime('now') WHERE id = ?", [sub.id]);

  // Notify admin
  runSQL(
    "INSERT INTO notifications (user_id, ip, title, message, type) VALUES (?, ?, ?, ?, ?)",
    [null, sub.ip, 'Solicitação de IP Adicional', `Usuário ${user.email} solicitou IP adicional (R$ 74,90/mês). Aguardando pagamento.`, 'info']
  );

  saveDB();
  res.json({ success: true, price: ADDITIONAL_IP_PRICE, message: 'IP adicional solicitado. Invoice criada.' });
});

// Remover IP adicional
app.delete('/api/user/additional-ip', authenticateToken, (req, res) => {
  const user = req.user;
  const sub = getRow('SELECT * FROM ip_subscriptions WHERE user_id = ? AND status = ?', [user.id, 'active']);
  if (!sub) return res.status(400).json({ error: 'Nenhum plano ativo encontrado.' });
  if (!sub.has_additional_ip) return res.status(400).json({ error: 'Você não possui IP adicional.' });

  db.run("UPDATE ip_subscriptions SET has_additional_ip = 0, additional_ip = NULL, updated_at = datetime('now') WHERE id = ?", [sub.id]);
  saveDB();
  res.json({ success: true, message: 'IP adicional removido. A cobrança para no próximo ciclo.' });
});

// Definir o IP adicional (após compra)
app.put('/api/user/additional-ip', authenticateToken, (req, res) => {
  const user = req.user;
  const { ip } = req.body;
  if (!ip) return res.status(400).json({ error: 'IP é obrigatório.' });

  const sub = getRow('SELECT * FROM ip_subscriptions WHERE user_id = ? AND status = ?', [user.id, 'active']);
  if (!sub) return res.status(400).json({ error: 'Nenhum plano ativo encontrado.' });
  if (!sub.has_additional_ip) return res.status(400).json({ error: 'Compre o IP adicional primeiro.' });
  if (ip === sub.ip) return res.status(400).json({ error: 'O IP adicional deve ser diferente do IP principal.' });

  db.run("UPDATE ip_subscriptions SET additional_ip = ?, updated_at = datetime('now') WHERE id = ?", [ip, sub.id]);
  saveDB();
  res.json({ success: true, message: 'IP adicional atualizado para ' + ip });
});

// Solicitar alteração do IP principal
app.post('/api/user/change-ip', authenticateToken, (req, res) => {
  const user = req.user;
  const { new_ip } = req.body;
  if (!new_ip) return res.status(400).json({ error: 'Novo IP é obrigatório.' });

  const sub = getRow('SELECT * FROM ip_subscriptions WHERE user_id = ? AND status = ?', [user.id, 'active']);
  if (!sub) return res.status(400).json({ error: 'Nenhum plano ativo encontrado.' });
  if (new_ip === sub.ip) return res.status(400).json({ error: 'O novo IP é igual ao atual.' });

  // Check for pending request
  const pending = getRow("SELECT id FROM ip_change_requests WHERE user_id = ? AND status = 'pending'", [user.id]);
  if (pending) return res.status(400).json({ error: 'Você já tem uma solicitação de alteração de IP pendente.' });

  runSQL(
    "INSERT INTO ip_change_requests (user_id, old_ip, new_ip, status) VALUES (?, ?, ?, 'pending')",
    [user.id, sub.ip, new_ip]
  );

  // Notify user
  runSQL(
    "INSERT INTO notifications (user_id, ip, title, message, type) VALUES (?, ?, ?, ?, ?)",
    [user.id, sub.ip, 'Alteração de IP Solicitada', `Sua solicitação para alterar o IP de ${sub.ip} para ${new_ip} foi enviada e está aguardando aprovação do admin.`, 'info']
  );

  saveDB();
  res.json({ success: true, message: 'Solicitação de alteração de IP enviada. Aguarde aprovação.' });
});

// Get user's IP info (for dashboard)
app.get('/api/user/ip-info', authenticateToken, (req, res) => {
  const user = req.user;
  const sub = getRow('SELECT ip, additional_ip, has_additional_ip, plan, status, expires_at FROM ip_subscriptions WHERE user_id = ? AND status = ?', [user.id, 'active']);
  if (!sub) return res.json({ ip: null, additional_ip: null, has_additional_ip: false, plan: null });

  const pendingChange = getRow("SELECT new_ip, created_at FROM ip_change_requests WHERE user_id = ? AND status = 'pending'", [user.id]);

  res.json({
    ip: sub.ip,
    additional_ip: sub.additional_ip,
    has_additional_ip: !!sub.has_additional_ip,
    plan: sub.plan,
    expires_at: sub.expires_at,
    pending_ip_change: pendingChange ? { new_ip: pendingChange.new_ip, requested_at: pendingChange.created_at } : null
  });
});

// --- ADMIN ROUTES ---
// Admin simples: lista, cria, edita e remove assinaturas por IP
// Em produção, proteger com auth de admin separado

const ADMIN_SECRET = process.env.ADMIN_SECRET || '8token-admin-change-me';

function adminAuth(req, res, next) {
  const secret = req.headers['x-admin-secret'] || req.query.secret;
  if (secret !== ADMIN_SECRET) {
    return res.status(401).json({ error: 'Acesso negado ao painel admin' });
  }
  next();
}

app.get('/api/admin/subscriptions', adminAuth, (req, res) => {
  const subs = getAllRows(`
    SELECT ips.*, u.email as user_email, u.name as user_name
    FROM ip_subscriptions ips
    LEFT JOIN users u ON ips.user_id = u.id
    ORDER BY ips.updated_at DESC
  `);
  res.json(subs);
});

app.post('/api/admin/subscriptions', adminAuth, (req, res) => {
  const { ip, plan, status, notes, expires_at, user_id } = req.body;
  if (!ip || !plan) {
    return res.status(400).json({ error: 'IP e plano são obrigatórios' });
  }

  const existing = getRow('SELECT id FROM ip_subscriptions WHERE ip = ?', [ip]);
  if (existing) {
    return res.status(409).json({ error: 'IP já cadastrado. Use PUT para editar.' });
  }

  const result = runSQL(
    'INSERT INTO ip_subscriptions (ip, user_id, plan, status, notes, expires_at) VALUES (?, ?, ?, ?, ?, ?)',
    [ip, user_id || null, plan, status || 'active', notes || null, expires_at || null]
  );

  res.json({ id: result.lastInsertRowid, ip, plan, status: status || 'active' });
});

app.put('/api/admin/subscriptions/:id', adminAuth, (req, res) => {
  const { plan, status, notes, expires_at, user_id } = req.body;
  const sub = getRow('SELECT * FROM ip_subscriptions WHERE id = ?', [req.params.id]);
  if (!sub) return res.status(404).json({ error: 'Assinatura não encontrada' });

  // sql.js rejects undefined — coerce every optional field to null when absent
  const safePlan      = plan       !== undefined ? plan       : null;
  const safeStatus    = status     !== undefined ? status     : null;
  const safeNotes     = notes      !== undefined ? notes      : null;
  const safeExpires   = expires_at !== undefined ? (expires_at || null) : null;
  const safeUserId    = user_id    !== undefined ? (user_id || null)    : null;

  db.run(`
    UPDATE ip_subscriptions
    SET plan = COALESCE(?, plan),
        status = COALESCE(?, status),
        notes = COALESCE(?, notes),
        expires_at = COALESCE(?, expires_at),
        user_id = COALESCE(?, user_id),
        updated_at = datetime('now')
    WHERE id = ?
  `, [safePlan, safeStatus, safeNotes, safeExpires, safeUserId, parseInt(req.params.id)]);
  saveDB();

  res.json({ success: true, id: parseInt(req.params.id) });
});

app.delete('/api/admin/subscriptions/:id', adminAuth, (req, res) => {
  const sub = getRow('SELECT * FROM ip_subscriptions WHERE id = ?', [req.params.id]);
  if (!sub) return res.status(404).json({ error: 'Assinatura não encontrada' });

  db.run('DELETE FROM ip_subscriptions WHERE id = ?', [req.params.id]);
  saveDB();
  res.json({ success: true });
});

// Auto-register IP on login/register (free plan by default)
function ensureIpRecord(ip, userId) {
  if (!ip) return;
  const existing = getRow('SELECT id FROM ip_subscriptions WHERE ip = ?', [ip]);
  if (!existing) {
    runSQL(
      'INSERT INTO ip_subscriptions (ip, user_id, plan, status) VALUES (?, ?, ?, ?)',
      [ip, userId || null, 'free', 'active']
    );
  } else if (userId) {
    db.run('UPDATE ip_subscriptions SET user_id = ?, updated_at = datetime("now") WHERE ip = ? AND user_id IS NULL', [userId, ip]);
    saveDB();
  }
}

// --- ADMIN: DASHBOARD STATS ---
app.get('/api/admin/stats', adminAuth, (req, res) => {
  const totalIps = getRow('SELECT COUNT(*) as c FROM ip_subscriptions');
  const activeIps = getRow("SELECT COUNT(*) as c FROM ip_subscriptions WHERE status = 'active'");
  const paidPlans = getRow("SELECT COUNT(*) as c FROM ip_subscriptions WHERE plan != 'free' AND status = 'active'");
  const pendingActivations = getRow("SELECT COUNT(*) as c FROM ip_activation_requests WHERE status = 'pending'");
  const totalRevenue = getRow("SELECT COALESCE(SUM(amount), 0) as total FROM invoices WHERE status = 'paid'");
  const recentInvoices = getAllRows(`
    SELECT i.*, u.email as user_email FROM invoices i
    LEFT JOIN users u ON i.user_id = u.id
    ORDER BY i.created_at DESC LIMIT 10
  `);
  const planBreakdown = getAllRows(`
    SELECT plan, COUNT(*) as count FROM ip_subscriptions WHERE status = 'active' GROUP BY plan
  `);
  // Detalhes de cada IP ativo para cálculo de receita projetada
  const activeSubscriptions = getAllRows(`
    SELECT plan, expires_at FROM ip_subscriptions WHERE status = 'active'
  `);
  res.json({
    totalIps: totalIps ? totalIps.c : 0,
    activeIps: activeIps ? activeIps.c : 0,
    paidPlans: paidPlans ? paidPlans.c : 0,
    pendingActivations: pendingActivations ? pendingActivations.c : 0,
    totalRevenue: totalRevenue ? totalRevenue.total : 0,
    recentInvoices,
    planBreakdown,
    activeSubscriptions
  });
});

// --- ADMIN: IP ACTIVATION REQUESTS ---
app.get('/api/admin/activations', adminAuth, (req, res) => {
  const requests = getAllRows(`
    SELECT iar.*, u.email as user_email, u.name as user_name
    FROM ip_activation_requests iar
    LEFT JOIN users u ON iar.user_id = u.id
    ORDER BY iar.created_at DESC
  `);
  res.json(requests);
});

app.post('/api/admin/activations/:id/approve', adminAuth, (req, res) => {
  const activation = getRow('SELECT * FROM ip_activation_requests WHERE id = ?', [req.params.id]);
  if (!activation) return res.status(404).json({ error: 'Pedido não encontrado' });
  if (activation.status !== 'pending') return res.status(400).json({ error: 'Pedido já processado' });

  const apiKey = generateApiKey();
  const gatewayUrl = `https://api.8token.dev/v1/${apiKey.slice(0, 12)}`;

  db.run(`UPDATE ip_activation_requests SET status = 'approved', api_key = ?, gateway_url = ?, resolved_at = datetime('now') WHERE id = ?`,
    [apiKey, gatewayUrl, req.params.id]);

  // Update IP subscription to active with the purchased plan
  const existingSub = getRow('SELECT id FROM ip_subscriptions WHERE ip = ?', [activation.ip]);
  if (existingSub) {
    const planExpiry = {
      mensal: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
      trimestral: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString(),
      anual: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString(),
    };
    db.run(`UPDATE ip_subscriptions SET plan = ?, status = 'active', expires_at = ?, updated_at = datetime('now') WHERE ip = ?`,
      [activation.plan, planExpiry[activation.plan] || null, activation.ip]);
  } else {
    const planExpiry = {
      mensal: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
      trimestral: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString(),
      anual: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString(),
    };
    runSQL(`INSERT INTO ip_subscriptions (ip, user_id, plan, status, expires_at) VALUES (?, ?, ?, 'active', ?)`,
      [activation.ip, activation.user_id, activation.plan, planExpiry[activation.plan] || null]);
  }

  // Notify user
  if (activation.user_id) {
    runSQL(`INSERT INTO notifications (user_id, ip, title, message, type) VALUES (?, ?, ?, ?, ?)`,
      [activation.user_id, activation.ip, 'IP Ativado!', `Seu IP ${activation.ip} foi ativado com o plano ${activation.plan}. Sua chave API: ${apiKey.slice(0, 12)}...`, 'success']);
  }

  saveDB();
  res.json({ success: true, apiKey, gatewayUrl });
});

app.post('/api/admin/activations/:id/reject', adminAuth, (req, res) => {
  const { notes } = req.body;
  const activation = getRow('SELECT * FROM ip_activation_requests WHERE id = ?', [req.params.id]);
  if (!activation) return res.status(404).json({ error: 'Pedido não encontrado' });

  db.run(`UPDATE ip_activation_requests SET status = 'rejected', notes = COALESCE(?, notes), resolved_at = datetime('now') WHERE id = ?`,
    [notes || null, req.params.id]);

  if (activation.user_id) {
    runSQL(`INSERT INTO notifications (user_id, ip, title, message, type) VALUES (?, ?, ?, ?, ?)`,
      [activation.user_id, activation.ip, 'Ativação Recusada', `A ativação do seu IP ${activation.ip} foi recusada. Entre em contato com o suporte.`, 'error']);
  }

  saveDB();
  res.json({ success: true });
});

// --- ADMIN: IP CHANGE REQUESTS ---
app.get('/api/admin/ip-changes', adminAuth, (req, res) => {
  const requests = getAllRows(`
    SELECT icr.*, u.email as user_email, u.name as user_name
    FROM ip_change_requests icr
    LEFT JOIN users u ON icr.user_id = u.id
    ORDER BY icr.created_at DESC
  `);
  res.json(requests);
});

app.post('/api/admin/ip-changes/:id/approve', adminAuth, (req, res) => {
  const changeReq = getRow('SELECT * FROM ip_change_requests WHERE id = ?', [req.params.id]);
  if (!changeReq) return res.status(404).json({ error: 'Solicitação não encontrada' });
  if (changeReq.status !== 'pending') return res.status(400).json({ error: 'Solicitação já processada' });

  // Update the IP in ip_subscriptions
  db.run("UPDATE ip_subscriptions SET ip = ?, updated_at = datetime('now') WHERE user_id = ? AND status = 'active'",
    [changeReq.new_ip, changeReq.user_id]);

  // Mark request as approved
  db.run("UPDATE ip_change_requests SET status = 'approved', resolved_at = datetime('now') WHERE id = ?", [req.params.id]);

  // Notify user
  runSQL("INSERT INTO notifications (user_id, ip, title, message, type) VALUES (?, ?, ?, ?, ?)",
    [changeReq.user_id, changeReq.new_ip, 'IP Alterado!', `Seu IP foi alterado de ${changeReq.old_ip} para ${changeReq.new_ip}. A mudança já está ativa.`, 'success']);

  saveDB();
  res.json({ success: true });
});

app.post('/api/admin/ip-changes/:id/reject', adminAuth, (req, res) => {
  const { notes } = req.body;
  const changeReq = getRow('SELECT * FROM ip_change_requests WHERE id = ?', [req.params.id]);
  if (!changeReq) return res.status(404).json({ error: 'Solicitação não encontrada' });

  db.run("UPDATE ip_change_requests SET status = 'rejected', notes = COALESCE(?, notes), resolved_at = datetime('now') WHERE id = ?",
    [notes || null, req.params.id]);

  // Notify user
  runSQL("INSERT INTO notifications (user_id, ip, title, message, type) VALUES (?, ?, ?, ?, ?)",
    [changeReq.user_id, changeReq.old_ip, 'Alteração de IP Recusada', `Sua solicitação para alterar o IP para ${changeReq.new_ip} foi recusada.${notes ? ' Motivo: ' + notes : ''}`, 'error']);

  saveDB();
  res.json({ success: true });
});

// --- ADMIN: COUPONS ---
app.get('/api/admin/coupons', adminAuth, (req, res) => {
  const coupons = getAllRows('SELECT * FROM coupons ORDER BY created_at DESC');
  res.json(coupons);
});

app.post('/api/admin/coupons', adminAuth, (req, res) => {
  const { code, discount_pct, max_uses, expires_at, notes } = req.body;
  if (!code || !discount_pct) return res.status(400).json({ error: 'Código e desconto são obrigatórios' });
  const existing = getRow('SELECT id FROM coupons WHERE code = ?', [code.toUpperCase()]);
  if (existing) return res.status(409).json({ error: 'Cupom já existe' });
  const result = runSQL(
    'INSERT INTO coupons (code, discount_pct, max_uses, expires_at, notes) VALUES (?, ?, ?, ?, ?)',
    [code.toUpperCase(), discount_pct, max_uses || null, expires_at || null, notes || null]
  );
  saveDB();
  res.json({ id: result.lastInsertRowid, code: code.toUpperCase(), discount_pct });
});

app.put('/api/admin/coupons/:id', adminAuth, (req, res) => {
  const { discount_pct, max_uses, expires_at, active, notes } = req.body;
  const coupon = getRow('SELECT * FROM coupons WHERE id = ?', [req.params.id]);
  if (!coupon) return res.status(404).json({ error: 'Cupom não encontrado' });
  db.run(`UPDATE coupons SET
    discount_pct = COALESCE(?, discount_pct),
    max_uses = COALESCE(?, max_uses),
    expires_at = ?,
    active = COALESCE(?, active),
    notes = COALESCE(?, notes),
    updated_at = datetime('now')
    WHERE id = ?`,
    [discount_pct !== undefined ? discount_pct : null, max_uses !== undefined ? max_uses : null,
     expires_at !== undefined ? expires_at : coupon.expires_at,
     active !== undefined ? active : null, notes !== undefined ? notes : null, req.params.id]);
  saveDB();
  res.json({ success: true });
});

app.delete('/api/admin/coupons/:id', adminAuth, (req, res) => {
  const coupon = getRow('SELECT * FROM coupons WHERE id = ?', [req.params.id]);
  if (!coupon) return res.status(404).json({ error: 'Cupom não encontrado' });
  db.run('DELETE FROM coupons WHERE id = ?', [req.params.id]);
  saveDB();
  res.json({ success: true });
});

// Public: validate a coupon code (used at checkout)
app.post('/api/coupons/validate', (req, res) => {
  const { code } = req.body;
  if (!code) return res.status(400).json({ valid: false, error: 'Código necessário' });
  const coupon = getRow('SELECT * FROM coupons WHERE code = ? AND active = 1', [code.toUpperCase()]);
  if (!coupon) return res.json({ valid: false, error: 'Cupom inválido' });
  if (coupon.expires_at && new Date(coupon.expires_at) < new Date()) {
    return res.json({ valid: false, error: 'Cupom expirado' });
  }
  if (coupon.max_uses && coupon.uses_count >= coupon.max_uses) {
    return res.json({ valid: false, error: 'Cupom esgotado' });
  }
  res.json({ valid: true, discount_pct: coupon.discount_pct, code: coupon.code });
});

// Public: preview coupon discount (does NOT increment uses_count — that happens at invoice creation)
app.post('/api/coupons/apply', authenticateToken, (req, res) => {
  const { code, plan } = req.body;
  if (!code || !plan) return res.status(400).json({ error: 'Código e plano necessários' });
  const coupon = getRow('SELECT * FROM coupons WHERE code = ? AND active = 1', [code.toUpperCase()]);
  if (!coupon) return res.status(404).json({ error: 'Cupom inválido' });
  if (coupon.expires_at && new Date(coupon.expires_at) < new Date()) {
    return res.status(400).json({ error: 'Cupom expirado' });
  }
  if (coupon.max_uses && coupon.uses_count >= coupon.max_uses) {
    return res.status(400).json({ error: 'Cupom esgotado' });
  }
  // Use canonical prices (same as invoice creation)
  const originalPrice = PLAN_PRICES[plan] || 0;
  if (!originalPrice) return res.status(400).json({ error: 'Plano inválido' });
  const discountAmount = originalPrice * (coupon.discount_pct / 100);
  const finalPrice = originalPrice - discountAmount;
  // Do NOT increment uses_count here — only at actual invoice creation
  res.json({
    valid: true,
    code: coupon.code,
    discount_pct: coupon.discount_pct,
    original_price: originalPrice,
    discount_amount: Math.round(discountAmount * 100) / 100,
    final_price: Math.round(finalPrice * 100) / 100
  });
});

// --- ADMIN: AFFILIATES ---
app.get('/api/admin/affiliates', adminAuth, (req, res) => {
  const affiliates = getAllRows(`
    SELECT a.*, u.email as user_email, u.name as user_name,
      (SELECT COUNT(*) FROM affiliate_referrals ar WHERE ar.affiliate_id = a.id) as total_referrals,
      (SELECT COUNT(*) FROM affiliate_referrals ar WHERE ar.affiliate_id = a.id AND ar.paid_at IS NOT NULL) as paid_referrals,
      (SELECT COALESCE(SUM(ar.amount), 0) FROM affiliate_referrals ar WHERE ar.affiliate_id = a.id AND ar.paid_at IS NOT NULL) as total_commission_base
    FROM affiliates a
    LEFT JOIN users u ON a.user_id = u.id
    ORDER BY a.created_at DESC
  `);
  res.json(affiliates);
});

app.post('/api/admin/affiliates', adminAuth, (req, res) => {
  const { user_id, commission_pct } = req.body;
  if (!user_id) return res.status(400).json({ error: 'user_id é obrigatório' });

  const existing = getRow('SELECT id FROM affiliates WHERE user_id = ?', [user_id]);
  if (existing) return res.status(409).json({ error: 'Usuário já é afiliado' });

  const code = 'aff_' + crypto.randomBytes(6).toString('hex');
  const result = runSQL(
    'INSERT INTO affiliates (user_id, commission_pct, code) VALUES (?, ?, ?)',
    [user_id, commission_pct || 10, code]
  );

  // Notify user
  runSQL(`INSERT INTO notifications (user_id, title, message, type) VALUES (?, ?, ?, ?)`,
    [user_id, 'Você é Afiliado!', `Parabéns! Você agora é afiliado 8Token. Sua comissão: ${commission_pct || 10}%. Código: ${code}`, 'success']);

  saveDB();
  res.json({ id: result.lastInsertRowid, code, commission_pct: commission_pct || 10 });
});

app.put('/api/admin/affiliates/:id', adminAuth, (req, res) => {
  const { commission_pct } = req.body;
  const affiliate = getRow('SELECT * FROM affiliates WHERE id = ?', [req.params.id]);
  if (!affiliate) return res.status(404).json({ error: 'Afiliado não encontrado' });

  const safePct = commission_pct !== undefined ? commission_pct : null;
  db.run(`UPDATE affiliates SET commission_pct = COALESCE(?, commission_pct), updated_at = datetime('now') WHERE id = ?`,
    [safePct, req.params.id]);
  saveDB();
  res.json({ success: true });
});

app.delete('/api/admin/affiliates/:id', adminAuth, (req, res) => {
  const affiliate = getRow('SELECT * FROM affiliates WHERE id = ?', [req.params.id]);
  if (!affiliate) return res.status(404).json({ error: 'Afiliado não encontrado' });

  db.run('DELETE FROM affiliates WHERE id = ?', [req.params.id]);
  saveDB();
  res.json({ success: true });
});

app.get('/api/admin/affiliates/:id/referrals', adminAuth, (req, res) => {
  const referrals = getAllRows(`
    SELECT ar.*, u.email as referred_email, u.name as referred_name
    FROM affiliate_referrals ar
    LEFT JOIN users u ON ar.referred_user_id = u.id
    WHERE ar.affiliate_id = ?
    ORDER BY ar.created_at DESC
  `, [req.params.id]);
  res.json(referrals);
});

// --- AFFILIATE PANEL (for logged-in affiliates) ---
app.get('/api/affiliate/me', authenticateToken, (req, res) => {
  const affiliate = getRow('SELECT * FROM affiliates WHERE user_id = ?', [req.user.id]);
  if (!affiliate) return res.status(404).json({ error: 'Você não é afiliado' });

  const stats = getRow(`
    SELECT
      COUNT(*) as total_referrals,
      SUM(CASE WHEN paid_at IS NOT NULL THEN 1 ELSE 0 END) as paid_referrals,
      COALESCE(SUM(CASE WHEN paid_at IS NOT NULL THEN amount ELSE 0 END), 0) as total_volume
    FROM affiliate_referrals WHERE affiliate_id = ?
  `, [affiliate.id]);

  const referrals = getAllRows(`
    SELECT ar.*, u.email as referred_email, u.name as referred_name
    FROM affiliate_referrals ar
    LEFT JOIN users u ON ar.referred_user_id = u.id
    WHERE ar.affiliate_id = ?
    ORDER BY ar.created_at DESC
  `, [affiliate.id]);

  const commissionEarned = (stats.total_volume || 0) * (affiliate.commission_pct / 100);

  res.json({
    affiliate: { id: affiliate.id, code: affiliate.code, commission_pct: affiliate.commission_pct },
    stats: { total_referrals: stats.total_referrals, paid_referrals: stats.paid_referrals || 0, total_volume: stats.total_volume || 0, commissionEarned },
    referrals
  });
});

// Track affiliate referral on register
app.post('/api/auth/register', async (req, res) => {
  // This is handled above — affiliate tracking added via query param ?ref=CODE
});

// Middleware to track affiliate ref code from query string
app.use((req, res, next) => {
  if (req.query.ref) {
    req.affiliateRefCode = req.query.ref;
  }
  next();
});

// Serve HTML files
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));
app.get('/login', (req, res) => res.sendFile(path.join(__dirname, 'login.html')));
app.get('/dashboard', (req, res) => res.sendFile(path.join(__dirname, 'dashboard.html')));
app.get('/account', (req, res) => res.sendFile(path.join(__dirname, 'account.html')));
app.get('/admin', (req, res) => res.sendFile(path.join(__dirname, 'admin.html')));
app.get('/affiliate', (req, res) => res.sendFile(path.join(__dirname, 'affiliate.html')));

// Start server after DB init
initDB().then(() => {
  app.listen(PORT, () => {
    console.log(`8Token server running on http://localhost:${PORT}`);
    console.log(`Database: ${DB_PATH}`);
  });
}).catch(err => {
  console.error('Failed to initialize database:', err);
  process.exit(1);
});