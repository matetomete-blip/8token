require('dotenv').config();

// Polyfill WebSocket para Node.js < 22 (Supabase SDK exige WS nativo)
if (typeof globalThis.WebSocket === 'undefined') {
  try { globalThis.WebSocket = require('ws'); } catch (e) { /* ws not installed, will fail at Supabase init */ }
}

const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { createClient } = require('@supabase/supabase-js');
const { OAuth2Client } = require('google-auth-library');
const crypto = require('crypto');

const app = express();
const JWT_SECRET = process.env.JWT_SECRET || '8token-jwt-secret-stable-fallback-2026';
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || '';
const ADMIN_SECRET = process.env.ADMIN_SECRET || '8token-admin-change-me';

// Supabase client — realtime desativado (exige WS nativo do Node 22+)
const supabaseUrl = process.env.SUPABASE_URL || 'https://wbkmaeqkypqrkawumdjw.supabase.co';
const supabaseKey = process.env.SUPABASE_KEY || process.env.service_role || '';
const supabase = createClient(supabaseUrl, supabaseKey, {
  realtime: { enabled: false },
  global: { headers: { 'X-Client-Info': '8token-server/1.0' } }
});

// ── Envio de e-mail via API HTTP da Resend ──────────────────────────────
// Funciona na Vercel sem SMTP (só precisa de RESEND_API_KEY nas env vars).
// TODO: configurar RESEND_API_KEY e EMAIL_FROM nas env vars da Vercel.
const RESEND_API_KEY = process.env.RESEND_API_KEY || '';
const EMAIL_FROM = process.env.EMAIL_FROM || '8Token <onboarding@resend.dev>';
const ADMIN_EMAIL_NOTIFY = process.env.ADMIN_EMAIL || 'matetomete@gmail.com';

async function sendEmail(to, subject, html) {
  if (!RESEND_API_KEY) {
    console.warn('[email] RESEND_API_KEY ausente — e-mail não enviado:', subject);
    return false;
  }
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + RESEND_API_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: EMAIL_FROM, to: Array.isArray(to) ? to : [to], subject, html })
    });
    if (!res.ok) console.error('[email] Resend erro', res.status, await res.text().catch(() => ''));
    return res.ok;
  } catch (e) {
    console.error('[email] Falha ao enviar:', e.message);
    return false;
  }
}

// Middleware
app.use(cors());
app.use(express.json({ limit: '10mb' }));

// Trust proxy for correct IP behind Vercel
app.set('trust proxy', true);

// Middleware: capture real IP
app.use((req, res, next) => {
  const forwarded = req.headers['x-forwarded-for'];
  let ip;
  if (forwarded) {
    ip = String(forwarded).split(',')[0].trim();
  } else {
    ip = req.socket?.remoteAddress || '';
  }
  if (ip === '::1' || ip === '::ffff:127.0.0.1') ip = '127.0.0.1';
  req.clientIp = ip;
  next();
});

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

// Admin auth middleware
function adminAuth(req, res, next) {
  const secret = req.headers['x-admin-secret'] || req.query.key;
  if (secret !== ADMIN_SECRET) return res.status(403).json({ error: 'Acesso negado' });
  next();
}

// Helper: ensure IP record exists for user
async function ensureIpRecord(ip, userId) {
  if (!ip || !userId) return;
  const { data } = await supabase.from('ip_subscriptions').select('id').eq('user_id', userId).eq('status', 'active').single();
  if (!data) {
    await supabase.from('ip_subscriptions').insert({ ip, user_id: userId, plan: 'free', status: 'active' });
  }
}

// Generate API key
function generateApiKey() {
  return '8tk_' + crypto.randomBytes(32).toString('hex');
}

// Canonical plan prices
const PLAN_PRICES = { mensal: 199.70, trimestral: 399, anual: 1100 };

// Kirvano config
const KIRVANO_CHECKOUTS = {
  mensal: process.env.KIRVANO_CHECKOUT_MENSAL || '',
  trimestral: process.env.KIRVANO_CHECKOUT_TRIMESTRAL || '',
  anual: process.env.KIRVANO_CHECKOUT_ANUAL || '',
};
const KIRVANO_WEBHOOK_TOKEN = process.env.KIRVANO_WEBHOOK_TOKEN || '';
const KIRVANO_PRODUCT_MAP = {};
if (process.env.KIRVANO_PRODUCT_MENSAL_ID) KIRVANO_PRODUCT_MAP[process.env.KIRVANO_PRODUCT_MENSAL_ID] = 'mensal';
if (process.env.KIRVANO_PRODUCT_TRIMESTRAL_ID) KIRVANO_PRODUCT_MAP[process.env.KIRVANO_PRODUCT_TRIMESTRAL_ID] = 'trimestral';
if (process.env.KIRVANO_PRODUCT_ANUAL_ID) KIRVANO_PRODUCT_MAP[process.env.KIRVANO_PRODUCT_ANUAL_ID] = 'anual';
if (process.env.KIRVANO_PRODUCT_IP_ADICIONAL_ID) KIRVANO_PRODUCT_MAP[process.env.KIRVANO_PRODUCT_IP_ADICIONAL_ID] = 'ip_adicional';

function resolvePlanFromKirvano(products) {
  if (!products || !products.length) return null;
  for (const p of products) {
    if (p.id && KIRVANO_PRODUCT_MAP[p.id]) return KIRVANO_PRODUCT_MAP[p.id];
    if (p.offer_id && KIRVANO_PRODUCT_MAP[p.offer_id]) return KIRVANO_PRODUCT_MAP[p.offer_id];
  }
  for (const p of products) {
    const name = (p.name || '').toLowerCase();
    if (name.includes('ip adicional') || name.includes('additional ip') || name.includes('+1 ip') || name.includes('ip_adicional')) return 'ip_adicional';
    if (name.includes('mensal') || name.includes('monthly')) return 'mensal';
    if (name.includes('trimestral') || name.includes('quarterly')) return 'trimestral';
    if (name.includes('anual') || name.includes('annual') || name.includes('yearly')) return 'anual';
  }
  return null;
}

const PLAN_EXPIRY_MS = {
  mensal: 30 * 24 * 60 * 60 * 1000,
  trimestral: 90 * 24 * 60 * 60 * 1000,
  anual: 365 * 24 * 60 * 60 * 1000,
};

// --- AUTH ROUTES ---

app.post('/api/auth/register', async (req, res) => {
  try {
    const { email, password, name } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'Email e senha são obrigatórios' });
    if (password.length < 6) return res.status(400).json({ error: 'Senha deve ter pelo menos 6 caracteres' });

    // Check if already exists in custom table
    const { data: existingCustom } = await supabase.from('users').select('id').eq('email', email).single();
    if (existingCustom) return res.status(409).json({ error: 'Email já cadastrado' });

    const displayName = name || email.split('@')[0];
    const passwordHash = await bcrypt.hash(password, 12);
    const userId = crypto.randomUUID();

    // Create in custom users table — role is separate from plan
    const role = email === 'matetomete@gmail.com' ? 'admin' : 'user';
    const plan = 'free';
    const { data: newUser, error } = await supabase.from('users').insert({
      id: userId,
      email,
      password_hash: passwordHash,
      name: displayName,
      plan,
      role
    }).select().single();

    if (error) {
      // If insert fails (e.g. duplicate), try to find existing
      const { data: found } = await supabase.from('users').select('*').eq('email', email).single();
      if (found) {
        const token = jwt.sign({ id: found.id, email: found.email }, JWT_SECRET, { expiresIn: '30d' });
        await ensureIpRecord(req.clientIp, found.id);
        return res.json({ token, user: { id: found.id, email: found.email, name: found.name, plan: found.plan } });
      }
      throw error;
    }

    const token = jwt.sign({ id: newUser.id, email }, JWT_SECRET, { expiresIn: '30d' });
    await ensureIpRecord(req.clientIp, newUser.id);
    res.json({ token, user: { id: newUser.id, email, name: displayName, plan } });
  } catch (err) {
    console.error('Register error:', err);
    res.status(500).json({ error: 'Erro ao criar conta: ' + (err.message || 'Erro interno') });
  }
});

app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'Email e senha são obrigatórios' });

    // Try custom users table first
    let { data: user } = await supabase.from('users').select('*').eq('email', email).single();

    if (!user) return res.status(401).json({ error: 'Email ou senha incorretos' });

    // Verify password
    if (user.password_hash) {
      const valid = await bcrypt.compare(password, user.password_hash);
      if (!valid) return res.status(401).json({ error: 'Email ou senha incorretos' });
    } else {
      // No password set yet — try Supabase Auth signIn to verify, then store hash
      const { error: signInErr } = await supabase.auth.signInWithPassword({ email, password });
      if (signInErr) return res.status(401).json({ error: 'Email ou senha incorretos' });
      const passwordHash = await bcrypt.hash(password, 12);
      await supabase.from('users').update({ password_hash: passwordHash }).eq('id', user.id);
    }

    // Auto-promote matetomete@gmail.com to admin role (separate from plan)
    if (email === 'matetomete@gmail.com' && user.role !== 'admin') {
      await supabase.from('users').update({ role: 'admin' }).eq('id', user.id);
      user.role = 'admin';
    }

    const token = jwt.sign({ id: user.id, email: user.email }, JWT_SECRET, { expiresIn: '30d' });
    await ensureIpRecord(req.clientIp, user.id);
    res.json({ token, user: { id: user.id, email: user.email, name: user.name, plan: user.plan, role: user.role || 'user' } });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

app.post('/api/auth/google', async (req, res) => {
  try {
    const { credential } = req.body;
    if (!credential) return res.status(400).json({ error: 'Credencial do Google não fornecida' });

    let payload;
    if (googleClient) {
      const ticket = await googleClient.verifyIdToken({ idToken: credential, audience: GOOGLE_CLIENT_ID });
      payload = ticket.getPayload();
    } else {
      payload = JSON.parse(Buffer.from(credential.split('.')[1], 'base64').toString());
    }

    const { email, name, picture, sub: googleId } = payload;
    if (!email) return res.status(400).json({ error: 'Email não encontrado no token Google' });

    let { data: user } = await supabase.from('users').select('*').or(`google_id.eq.${googleId},email.eq.${email}`).single();

    if (!user) {
      const { data: newUser } = await supabase.from('users').insert({ email, name, google_id: googleId, avatar_url: picture, plan: 'free' }).select().single();
      user = newUser;
    } else if (!user.google_id) {
      await supabase.from('users').update({ google_id: googleId, avatar_url: picture, name: user.name || name }).eq('id', user.id);
      user.name = user.name || name;
    }

    // Auto-promote matetomete@gmail.com to admin role via Google login too
    if (email === 'matetomete@gmail.com' && user.role !== 'admin') {
      await supabase.from('users').update({ role: 'admin' }).eq('id', user.id);
      user.role = 'admin';
    }

    const token = jwt.sign({ id: user.id, email: user.email }, JWT_SECRET, { expiresIn: '30d' });
    await ensureIpRecord(req.clientIp, user.id);
    res.json({ token, user: { id: user.id, email: user.email, name: user.name || name, plan: user.plan, role: user.role || 'user' } });
  } catch (err) {
    console.error('Google auth error:', err);
    res.status(500).json({ error: 'Erro na autenticação com Google' });
  }
});

// --- ADMIN: SET PASSWORD (reset admin password directly) ---
app.post('/api/admin/set-password', adminAuth, async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'Email e senha são obrigatórios' });
    if (password.length < 6) return res.status(400).json({ error: 'Senha deve ter pelo menos 6 caracteres' });
    const passwordHash = await bcrypt.hash(password, 12);
    const { data, error } = await supabase.from('users').update({ password_hash: passwordHash }).eq('email', email).select().single();
    if (error || !data) return res.status(404).json({ error: 'Usuário não encontrado: ' + email });
    res.json({ success: true, message: 'Senha atualizada para ' + email });
  } catch (err) {
    console.error('Set password error:', err);
    res.status(500).json({ error: 'Erro ao definir senha: ' + err.message });
  }
});

// --- USER ROUTES ---

app.get('/api/user/profile', authenticateToken, async (req, res) => {
  const { data: user } = await supabase.from('users').select('id, email, name, plan, role, plan_expires_at, avatar_url, created_at').eq('id', req.user.id).single();
  if (!user) return res.status(404).json({ error: 'Usuário não encontrado' });
  res.json(user);
});

// --- NOTIFICATIONS ---
app.get('/api/notifications', authenticateToken, async (req, res) => {
  const { data } = await supabase.from('notifications').select('id, title, message, type, read, created_at').eq('user_id', req.user.id).order('created_at', { ascending: false }).limit(50);
  res.json(data || []);
});

app.put('/api/notifications/:id/read', authenticateToken, async (req, res) => {
  await supabase.from('notifications').update({ read: true }).eq('id', req.params.id).eq('user_id', req.user.id);
  res.json({ success: true });
});

app.put('/api/notifications/read-all', authenticateToken, async (req, res) => {
  await supabase.from('notifications').update({ read: true }).eq('user_id', req.user.id);
  res.json({ success: true });
});

app.put('/api/user/email', authenticateToken, async (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ error: 'Email é obrigatório' });
  const { data: existing } = await supabase.from('users').select('id').eq('email', email).neq('id', req.user.id).single();
  if (existing) return res.status(409).json({ error: 'Email já está em uso' });
  await supabase.from('users').update({ email }).eq('id', req.user.id);
  res.json({ success: true, email });
});

app.put('/api/user/password', authenticateToken, async (req, res) => {
  const { currentPassword, newPassword } = req.body;
  if (!newPassword || newPassword.length < 6) return res.status(400).json({ error: 'Nova senha deve ter pelo menos 6 caracteres' });
  const { data: user } = await supabase.from('users').select('password_hash').eq('id', req.user.id).single();
  if (user.password_hash && currentPassword) {
    const valid = await bcrypt.compare(currentPassword, user.password_hash);
    if (!valid) return res.status(401).json({ error: 'Senha atual incorreta' });
  }
  const hash = await bcrypt.hash(newPassword, 12);
  await supabase.from('users').update({ password_hash: hash }).eq('id', req.user.id);
  res.json({ success: true });
});

app.put('/api/user/name', authenticateToken, async (req, res) => {
  const { name } = req.body;
  if (!name) return res.status(400).json({ error: 'Nome é obrigatório' });
  await supabase.from('users').update({ name }).eq('id', req.user.id);
  res.json({ success: true, name });
});

// --- API KEYS ---
app.get('/api/keys', authenticateToken, async (req, res) => {
  const { data } = await supabase.from('api_keys').select('id, name, key_prefix, key_suffix, key_encrypted, created_at, last_used_at, revoked').eq('user_id', req.user.id).order('created_at', { ascending: false });
  // Decrypt keys for display
  const keys = (data || []).map(k => {
    let full_key = null;
    if (k.key_encrypted) {
      try {
        const decipher = crypto.createDecipheriv('aes-256-cbc', Buffer.from(process.env.JWT_SECRET || 'fallback-secret-key-32chars!!', 'utf8').slice(0, 32), Buffer.alloc(16, 0));
        full_key = decipher.update(k.key_encrypted, 'hex', 'utf8') + decipher.final('utf8');
      } catch (e) { /* decryption failed, leave null */ }
    }
    return { ...k, full_key };
  });
  res.json(keys);
});

app.post('/api/keys', authenticateToken, async (req, res) => {
  const { name } = req.body;
  const apiKey = generateApiKey();
  const keyHash = crypto.createHash('sha256').update(apiKey).digest('hex');
  const prefix = apiKey.slice(0, 8);
  const suffix = apiKey.slice(-4);
  // Encrypt the full key for storage (so user can reveal it later)
  let keyEncrypted = null;
  try {
    const cipher = crypto.createCipheriv('aes-256-cbc', Buffer.from(process.env.JWT_SECRET || 'fallback-secret-key-32chars!!', 'utf8').slice(0, 32), Buffer.alloc(16, 0));
    keyEncrypted = cipher.update(apiKey, 'utf8', 'hex') + cipher.final('hex');
  } catch (e) { console.error('Key encryption failed:', e.message); }
  const { data } = await supabase.from('api_keys').insert({ user_id: req.user.id, name: name || 'Nova chave', key_hash: keyHash, key_prefix: prefix, key_suffix: suffix, key_encrypted: keyEncrypted }).select().single();
  res.json({ id: data.id, key: apiKey, name: name || 'Nova chave', prefix, suffix });
});

app.delete('/api/keys/:id', authenticateToken, async (req, res) => {
  await supabase.from('api_keys').update({ revoked: true }).eq('id', req.params.id).eq('user_id', req.user.id);
  res.json({ success: true });
});

// --- CHECKOUT ---
app.get('/api/checkout/:plan', authenticateToken, async (req, res) => {
  const { plan } = req.params;
  const checkoutUrl = KIRVANO_CHECKOUTS[plan];
  if (!checkoutUrl) return res.status(400).json({ error: `Checkout não configurado para o plano ${plan}` });
  const { data: user } = await supabase.from('users').select('id, email').eq('id', req.user.id).single();
  await supabase.from('invoices').insert({ user_id: req.user.id, plan, amount: PLAN_PRICES[plan] || 0, status: 'pending' });
  const separator = checkoutUrl.includes('?') ? '&' : '?';
  res.json({ redirect_url: `${checkoutUrl}${separator}email=${encodeURIComponent(user?.email || '')}`, plan });
});

// --- WEBHOOK ---
app.post('/api/webhooks/kirvano', async (req, res) => {
  // Read webhook token from DB settings (admin-configurable) — fall back to env var
  let dbWebhookToken = '';
  try {
    const { data: cfgRow } = await supabase.from('settings').select('value').eq('key', 'kirvano_config').single();
    if (cfgRow) {
      const cfg = JSON.parse(cfgRow.value);
      dbWebhookToken = cfg.webhook_token || '';
    }
  } catch (_) { /* ignore — proceed with env var or no auth */ }

  const effectiveToken = dbWebhookToken || KIRVANO_WEBHOOK_TOKEN;
  const authHeader = req.headers['authorization'] || req.headers['x-webhook-token'] || req.headers['x-webhook-secret'] || '';
  const token = authHeader.replace('Bearer ', '').trim();

  // Only enforce auth if a token is actually configured; Kirvano may not send any header
  if (effectiveToken && token && token !== effectiveToken) return res.status(401).json({ error: 'Unauthorized' });

  const payload = req.body;
  const event = payload.event;
  console.log(`[Kirvano Webhook] ${event} | sale_id: ${payload.sale_id}`);

  await supabase.from('webhook_logs').insert({
    event_type: event,
    event: event,
    sale_id: payload.sale_id || null,
    status: payload.status || null,
    customer_email: payload.customer?.email || null,
    customer_ip: payload.ip || null,
    plan: resolvePlanFromKirvano(payload.products) || null,
    payload: payload
  });

  if (event === 'SALE_APPROVED') {
    const customerEmail = payload.customer?.email;
    const plan = resolvePlanFromKirvano(payload.products);
    if (!customerEmail || !plan) return res.json({ received: true, warning: 'Missing data' });

    const { data: user } = await supabase.from('users').select('id, plan').eq('email', customerEmail).single();
    if (!user) return res.json({ received: true, warning: 'User not found' });

    // Handle IP Adicional separately (independent subscription, 30 days expiry)
    if (plan === 'ip_adicional') {
      const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();

      // Find existing active subscription to update has_additional_ip
      const { data: existingSub } = await supabase
        .from('ip_subscriptions')
        .select('id')
        .eq('user_id', user.id)
        .eq('status', 'active')
        .order('created_at', { ascending: false })
        .limit(1)
        .single();

      if (existingSub) {
        await supabase
          .from('ip_subscriptions')
          .update({ has_additional_ip: true, additional_ip_expires_at: expiresAt })
          .eq('id', existingSub.id);
        console.log('[Kirvano Webhook] IP Adicional activated for user:', user.id);
      } else {
        // Create a placeholder subscription if none exists (shouldn't happen normally)
        await supabase.from('ip_subscriptions').insert({
          user_id: user.id,
          ip: 'pending',
          plan: 'free',
          status: 'active',
          has_additional_ip: true,
          additional_ip_expires_at: expiresAt
        });
      }

      // Record invoice
      await supabase.from('invoices').insert({
        user_id: user.id,
        plan: 'ip_adicional',
        amount: 74.90,
        status: 'paid',
        paid_at: new Date().toISOString(),
        kirvano_sale_id: payload.sale_id,
        paid_by_webhook: true
      });

      return res.json({ received: true, plan: 'ip_adicional' });
    }

    const expiresAt = new Date(Date.now() + (PLAN_EXPIRY_MS[plan] || 30 * 24 * 60 * 60 * 1000)).toISOString();
    const previousPlan = user.plan;

    // Atomic update: users.plan + ip_subscriptions + invoice + audit log
    // Step 1: Update users.plan atomically
    const { error: userUpdateErr } = await supabase
      .from('users')
      .update({ plan, plan_expires_at: expiresAt })
      .eq('id', user.id);
    if (userUpdateErr) {
      console.error('[Kirvano Webhook] Failed to update user plan:', userUpdateErr);
      return res.status(500).json({ error: 'Failed to update user' });
    }

    // Step 2: Upsert ip_subscriptions (source of truth for plan/status)
    const { data: existingSub } = await supabase
      .from('ip_subscriptions')
      .select('id, plan')
      .eq('user_id', user.id)
      .eq('status', 'active')
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    let subId = null;
    if (existingSub) {
      const { error: subUpdateErr } = await supabase
        .from('ip_subscriptions')
        .update({ plan, status: 'active', expires_at: expiresAt, auto_renew: true })
        .eq('id', existingSub.id);
      if (subUpdateErr) {
        console.error('[Kirvano Webhook] Failed to update subscription:', subUpdateErr);
      }
      subId = existingSub.id;
    } else {
      // No active subscription — create one using the request IP or a placeholder
      const ip = req.clientIp || 'pending-activation';
      const { data: newSub, error: subInsertErr } = await supabase
        .from('ip_subscriptions')
        .insert({ user_id: user.id, ip, plan, status: 'active', expires_at: expiresAt, auto_renew: true })
        .select('id')
        .single();
      if (subInsertErr) {
        console.error('[Kirvano Webhook] Failed to create subscription:', subInsertErr);
      } else {
        subId = newSub.id;
      }
    }

    // Step 3: Update/create invoice with kirvano_sale_id and paid_by_webhook
    const { data: existingInvoice } = await supabase
      .from('invoices')
      .select('id')
      .eq('user_id', user.id)
      .eq('plan', plan)
      .eq('status', 'pending')
      .limit(1)
      .single();

    if (existingInvoice) {
      await supabase
        .from('invoices')
        .update({ status: 'paid', paid_at: new Date().toISOString(), kirvano_sale_id: payload.sale_id, paid_by_webhook: true })
        .eq('id', existingInvoice.id);
    } else {
      await supabase.from('invoices').insert({
        user_id: user.id,
        plan,
        amount: PLAN_PRICES[plan] || 0,
        status: 'paid',
        paid_at: new Date().toISOString(),
        kirvano_sale_id: payload.sale_id,
        paid_by_webhook: true
      });
    }

    // Step 4: Audit log for plan change via webhook
    if (previousPlan !== plan) {
      await supabase.from('plan_audit_log').insert({
        user_id: user.id,
        actor: 'webhook',
        action: 'sale_approved',
        field_changed: 'plan',
        old_value: previousPlan,
        new_value: plan
      });
    }

    // Step 5: Create activation request
    const apiKey = generateApiKey();
    // Get gateway URL from settings or use default
    const { data: gwSetting } = await supabase.from('site_settings').select('value').eq('key', 'gateway_url').single();
    const gatewayUrl = gwSetting?.value || 'https://8token.tech/v1';
    await supabase.from('ip_activation_requests').insert({
      user_id: user.id, ip: req.clientIp, plan, status: 'pending', api_key: apiKey,
      gateway_url: gatewayUrl, kirvano_sale_id: payload.sale_id
    });
  }

  res.json({ received: true });
});

// --- IP STATUS ---
app.get('/api/ip/status', async (req, res) => {
  const ip = req.clientIp;
  const { data: sub } = await supabase.from('ip_subscriptions').select('plan, status, expires_at').eq('ip', ip).eq('status', 'active').single();
  if (!sub) return res.json({ active: false, ip });
  if (sub.expires_at && new Date(sub.expires_at) < new Date()) {
    await supabase.from('ip_subscriptions').update({ status: 'expired' }).eq('ip', ip);
    return res.json({ active: false, ip, expired: true });
  }
  res.json({ active: true, ip, plan: sub.plan, expires_at: sub.expires_at });
});

// --- USER: IP ADDITIONAL & CHANGE ---
app.post('/api/user/additional-ip', authenticateToken, async (req, res) => {
  const { data: sub } = await supabase.from('ip_subscriptions').select('*').eq('user_id', req.user.id).eq('status', 'active').single();
  if (!sub) return res.status(400).json({ error: 'Nenhum plano ativo encontrado.' });
  if (sub.has_additional_ip) return res.status(400).json({ error: 'Você já possui um IP adicional ativo.' });
  if (sub.plan === 'free') return res.status(400).json({ error: 'Plano free não pode comprar IP adicional.' });
  await supabase.from('invoices').insert({ user_id: req.user.id, plan: 'ip_adicional', amount: 74.90, status: 'pending' });
  await supabase.from('ip_subscriptions').update({ has_additional_ip: true }).eq('id', sub.id);
  res.json({ success: true, price: 74.90, message: 'IP adicional solicitado.' });
});

app.delete('/api/user/additional-ip', authenticateToken, async (req, res) => {
  const { data: sub } = await supabase.from('ip_subscriptions').select('*').eq('user_id', req.user.id).eq('status', 'active').single();
  if (!sub || !sub.has_additional_ip) return res.status(400).json({ error: 'Você não possui IP adicional.' });
  await supabase.from('ip_subscriptions').update({ has_additional_ip: false, additional_ip: null }).eq('id', sub.id);
  res.json({ success: true, message: 'IP adicional removido.' });
});

app.put('/api/user/additional-ip', authenticateToken, async (req, res) => {
  const { ip } = req.body;
  if (!ip) return res.status(400).json({ error: 'IP é obrigatório.' });
  const { data: sub } = await supabase.from('ip_subscriptions').select('*').eq('user_id', req.user.id).eq('status', 'active').single();
  if (!sub || !sub.has_additional_ip) return res.status(400).json({ error: 'Compre o IP adicional primeiro.' });
  if (ip === sub.ip) return res.status(400).json({ error: 'O IP adicional deve ser diferente do principal.' });
  await supabase.from('ip_subscriptions').update({ additional_ip: ip }).eq('id', sub.id);
  res.json({ success: true, message: 'IP adicional atualizado para ' + ip });
});

app.post('/api/user/change-ip', authenticateToken, async (req, res) => {
  const { new_ip } = req.body;
  if (!new_ip) return res.status(400).json({ error: 'Novo IP é obrigatório.' });
  const { data: sub } = await supabase.from('ip_subscriptions').select('*').eq('user_id', req.user.id).eq('status', 'active').single();
  if (!sub) return res.status(400).json({ error: 'Nenhum plano ativo encontrado.' });
  if (new_ip === sub.ip) return res.status(400).json({ error: 'O novo IP é igual ao atual.' });
  const { data: pending } = await supabase.from('ip_change_requests').select('id').eq('user_id', req.user.id).eq('status', 'pending').single();
  if (pending) return res.status(400).json({ error: 'Você já tem uma solicitação pendente.' });
  await supabase.from('ip_change_requests').insert({ user_id: req.user.id, old_ip: sub.ip, new_ip, status: 'pending' });
  await supabase.from('notifications').insert({ user_id: req.user.id, title: 'Alteração de IP Solicitada', message: `Solicitação para alterar IP de ${sub.ip} para ${new_ip} enviada.`, type: 'info' });
  sendEmail(ADMIN_EMAIL_NOTIFY, '8Token — Nova solicitação de troca de IP',
    `<p>O usuário <strong>${req.user.email}</strong> solicitou a troca de IP de <strong>${sub.ip}</strong> para <strong>${new_ip}</strong>.</p><p>Aprove ou recuse no painel admin.</p>`).catch(() => {});
  res.json({ success: true, message: 'Solicitação enviada. Aguarde aprovação.' });
});

// Retorna o IP real da rede do usuário (detectado pelo middleware)
app.get('/api/user/current-ip', authenticateToken, (req, res) => {
  res.json({ ip: req.clientIp || null });
});

// Libera o IP atual da rede como IP principal (auto-aprovação imediata)
app.post('/api/user/authorize-current-ip', authenticateToken, async (req, res) => {
  const currentIp = req.clientIp;
  if (!currentIp) return res.status(400).json({ error: 'Não foi possível detectar seu IP.' });
  const { data: sub } = await supabase.from('ip_subscriptions')
    .select('*').eq('user_id', req.user.id).eq('status', 'active')
    .order('created_at', { ascending: false }).limit(1).single();
  if (!sub) return res.status(400).json({ error: 'Nenhum plano ativo encontrado.' });
  if (sub.ip === currentIp) return res.json({ success: true, message: 'IP da rede já está liberado!', ip: currentIp });
  // Atualiza o IP principal imediatamente
  await supabase.from('ip_subscriptions').update({ ip: currentIp }).eq('id', sub.id);
  // Cancela qualquer solicitação pendente anterior
  await supabase.from('ip_change_requests').update({ status: 'cancelled' })
    .eq('user_id', req.user.id).eq('status', 'pending');
  await supabase.from('notifications').insert({
    user_id: req.user.id, title: 'IP Autorizado Automaticamente',
    message: `Seu IP ${currentIp} foi liberado com sucesso.`, type: 'success'
  });
  res.json({ success: true, message: 'IP da rede liberado com sucesso!', ip: currentIp });
});

app.get('/api/user/ip-info', authenticateToken, async (req, res) => {
  // Get ALL active subscriptions for this user (supports multiple IPs)
  // Try with additional_ip_expires_at first, fallback without it if column doesn't exist
  let subs;
  const result1 = await supabase.from('ip_subscriptions').select('id, ip, additional_ip, has_additional_ip, additional_ip_expires_at, plan, status, expires_at, created_at').eq('user_id', req.user.id).eq('status', 'active').order('created_at', { ascending: false });
  if (result1.error) {
    // Fallback: query without additional_ip_expires_at if column doesn't exist
    const result2 = await supabase.from('ip_subscriptions').select('id, ip, additional_ip, has_additional_ip, plan, status, expires_at, created_at').eq('user_id', req.user.id).eq('status', 'active').order('created_at', { ascending: false });
    subs = result2.data;
  } else {
    subs = result1.data;
  }
  if (!subs || !subs.length) return res.json({ ip: null, additional_ip: null, has_additional_ip: false, additional_ip_expires_at: null, plan: null, all_ips: [] });
  // Primary = most recent subscription
  const primary = subs[0];
  // Collect all unique IPs
  const allIps = subs.map(s => ({ id: s.id, ip: s.ip, plan: s.plan, status: s.status, expires_at: s.expires_at }));
  let pending = null;
  try {
    const { data: pendingData } = await supabase.from('ip_change_requests').select('new_ip, created_at').eq('user_id', req.user.id).eq('status', 'pending').single();
    pending = pendingData;
  } catch (e) { /* no pending request */ }
  res.json({
    ip: primary.ip,
    additional_ip: primary.additional_ip,
    has_additional_ip: !!primary.has_additional_ip,
    additional_ip_expires_at: primary.additional_ip_expires_at || null,
    plan: primary.plan,
    status: primary.status,
    expires_at: primary.expires_at,
    all_ips: allIps,
    pending_ip_change: pending ? { new_ip: pending.new_ip, requested_at: pending.created_at } : null
  });
});

// --- ADMIN ROUTES ---
app.get('/api/admin/stats', adminAuth, async (req, res) => {
  const { count: totalIps } = await supabase.from('ip_subscriptions').select('*', { count: 'exact', head: true });
  const { count: activeIps } = await supabase.from('ip_subscriptions').select('*', { count: 'exact', head: true }).eq('status', 'active');
  const { count: paidPlans } = await supabase.from('ip_subscriptions').select('*', { count: 'exact', head: true }).neq('plan', 'free').eq('status', 'active');
  let planBreakdown = [];
  try {
    const { data: rpcData } = await supabase.rpc('get_plan_breakdown');
    planBreakdown = rpcData || [];
  } catch (e) { /* rpc not available, use fallback */ }
  // Fallback: manual breakdown
  let breakdown = [];
  if (!planBreakdown || !planBreakdown.length) {
    const { data: subs } = await supabase.from('ip_subscriptions').select('plan').eq('status', 'active');
    const counts = {};
    (subs || []).forEach(s => { counts[s.plan] = (counts[s.plan] || 0) + 1; });
    breakdown = Object.entries(counts).map(([plan, count]) => ({ plan, count }));
  }
  // Active subscriptions with expires_at for revenue projection
  const { data: activeSubs } = await supabase.from('ip_subscriptions').select('plan, expires_at').eq('status', 'active');
  const { count: totalUsers } = await supabase.from('users').select('*', { count: 'exact', head: true });
  const { data: recentInvoices } = await supabase.from('invoices').select('*').eq('status', 'paid').order('paid_at', { ascending: false }).limit(10);
  const totalRevenue = (recentInvoices || []).reduce((sum, inv) => sum + (inv.amount || 0), 0);

  res.json({
    totalIps: totalIps || 0,
    activeIps: activeIps || 0,
    paidPlans: paidPlans || 0,
    totalUsers: totalUsers || 0,
    planBreakdown: breakdown,
    activeSubscriptions: (activeSubs || []).map(s => ({ plan: s.plan, expires_at: s.expires_at })),
    totalRevenue,
    recentInvoices: recentInvoices || []
  });
});

app.get('/api/admin/subscriptions', adminAuth, async (req, res) => {
  const { data } = await supabase.from('ip_subscriptions').select('*, users(email, name)').order('created_at', { ascending: false });
  res.json(data || []);
});

app.post('/api/admin/subscriptions', adminAuth, async (req, res) => {
  const { ip, user_id, plan, status, notes, expires_at } = req.body;
  if (!ip) return res.status(400).json({ error: 'IP é obrigatório' });
  // Allow multiple IPs per user — only check if this exact IP already exists
  const { data: existing } = await supabase.from('ip_subscriptions').select('id').eq('ip', ip).single();
  if (existing) return res.status(409).json({ error: 'Este IP já está cadastrado' });
  const { data } = await supabase.from('ip_subscriptions').insert({ ip, user_id, plan: plan || 'free', status: status || 'active', notes, expires_at }).select().single();
  res.json(data);
});

app.put('/api/admin/subscriptions/:id', adminAuth, async (req, res) => {
  const { plan, status, notes, expires_at, ip, user_data } = req.body;
  const update = {};
  if (plan !== undefined) update.plan = plan;
  if (status !== undefined) update.status = status;
  if (notes !== undefined) update.notes = notes;
  if (expires_at !== undefined) update.expires_at = expires_at;
  if (ip !== undefined) update.ip = ip;

  // Step 1: Get the current subscription to know its IP before updating
  const { data: currentSub } = await supabase.from('ip_subscriptions').select('id, ip, user_id').eq('id', req.params.id).single();
  if (!currentSub) return res.status(404).json({ error: 'Subscription not found' });

  // Step 2: Update THIS subscription
  const { data: updatedSub, error: subError } = await supabase.from('ip_subscriptions').update(update).eq('id', req.params.id).select('user_id, ip, plan, status, expires_at').single();
  if (subError) return res.status(500).json({ error: subError.message });

  // Step 3 REMOVED: No longer bulk-update all subs with the same IP.
  // Each subscription is edited individually by its ID — editing one user must NOT affect others.

  // Step 4: Find the user_id to sync — use THIS subscription's user_id only
  let syncedUserId = updatedSub?.user_id;

  // Step 5: Sync users.plan so dashboard reflects admin changes immediately
  if (syncedUserId) {
    const userUpdate = {};
    if (plan !== undefined) userUpdate.plan = plan;
    if (expires_at !== undefined) userUpdate.plan_expires_at = expires_at;
    if (user_data) {
      if (user_data.name !== undefined) userUpdate.name = user_data.name;
      if (user_data.email !== undefined) userUpdate.email = user_data.email;
      if (user_data.role !== undefined) userUpdate.role = user_data.role;
    }
    if (Object.keys(userUpdate).length > 0) {
      const { error: userError } = await supabase.from('users').update(userUpdate).eq('id', syncedUserId);
      if (userError) {
        console.error(`[Admin PUT] Failed to sync user ${syncedUserId}:`, userError);
      } else {
        console.log(`[Admin PUT] ✅ Synced user ${syncedUserId} → plan=${plan}, expires=${expires_at}`);
      }
    }
  } else {
    console.warn(`[Admin PUT] ⚠️ Sub ${req.params.id} (IP ${targetIp}) has no user_id and no linked sub — users.plan NOT synced`);
  }

  res.json({ success: true, synced_user_id: syncedUserId || null });
});

app.delete('/api/admin/subscriptions/:id', adminAuth, async (req, res) => {
  await supabase.from('ip_subscriptions').delete().eq('id', req.params.id);
  res.json({ success: true });
});

// --- ADMIN: IP VALIDATION (Hermes API) ---
app.post('/api/admin/ips/validate', adminAuth, async (req, res) => {
  const { ip, status = 'active', plan = 'mensal', expires_at } = req.body;
  if (!ip) return res.status(400).json({ error: 'IP é obrigatório' });

  // Find ALL subscriptions with this IP — update each individually by ID (not bulk by IP)
  const { data: subs } = await supabase.from('ip_subscriptions').select('*').eq('ip', ip);
  if (subs && subs.length > 0) {
    for (const sub of subs) {
      const update = { status };
      if (plan) update.plan = plan;
      if (expires_at) update.expires_at = expires_at;
      await supabase.from('ip_subscriptions').update(update).eq('id', sub.id);
      // Sync users.plan for THIS specific user only
      if (sub.user_id && (plan || expires_at)) {
        const userUpdate = {};
        if (plan) userUpdate.plan = plan;
        if (expires_at) userUpdate.plan_expires_at = expires_at;
        await supabase.from('users').update(userUpdate).eq('id', sub.user_id);
      }
    }
  } else {
    const expiresAt = expires_at || new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
    await supabase.from('ip_subscriptions').insert({ ip, status, plan, expires_at: expiresAt });
  }
  res.json({ success: true, ip, status, plan });
});

app.post('/api/admin/ips/invalidate', adminAuth, async (req, res) => {
  const { ip } = req.body;
  if (!ip) return res.status(400).json({ error: 'IP é obrigatório' });
  // Find ALL subscriptions with this IP — suspend each individually by ID (not bulk by IP)
  const { data: subs } = await supabase.from('ip_subscriptions').select('id, user_id').eq('ip', ip);
  if (subs && subs.length > 0) {
    for (const sub of subs) {
      await supabase.from('ip_subscriptions').update({ status: 'suspended' }).eq('id', sub.id);
    }
  }
  res.json({ success: true, ip, status: 'suspended', affected: (subs || []).length });
});

app.get('/api/admin/ips/:ip/status', adminAuth, async (req, res) => {
  const { ip } = req.params;
  const { data: sub } = await supabase.from('ip_subscriptions').select('*, users(email, name)').eq('ip', ip).single();
  if (!sub) return res.status(404).json({ error: 'IP não encontrado' });
  
  const now = new Date();
  let effectiveStatus = sub.status;
  if (sub.expires_at && new Date(sub.expires_at) < now && sub.status === 'active') {
    effectiveStatus = 'expired';
    await supabase.from('ip_subscriptions').update({ status: 'expired' }).eq('ip', ip);
  }
  
  res.json({ 
    ip: sub.ip, 
    status: effectiveStatus, 
    plan: sub.plan, 
    expires_at: sub.expires_at,
    user: sub.users ? { email: sub.users.email, name: sub.users.name } : null,
    additional_ip: sub.additional_ip,
    has_additional_ip: sub.has_additional_ip
  });
});

// --- ADMIN: SUB-AFFILIATES ---
app.post('/api/admin/affiliates/:id/sub-affiliate', adminAuth, async (req, res) => {
  const { parent_affiliate_id } = req.body;
  const { id } = req.params;
  
  if (!parent_affiliate_id) return res.status(400).json({ error: 'parent_affiliate_id é obrigatório' });
  
  const { data: parent } = await supabase.from('affiliates').select('*').eq('id', parent_affiliate_id).single();
  if (!parent) return res.status(404).json({ error: 'Afiliado pai não encontrado' });
  
  const { data: child } = await supabase.from('affiliates').select('*').eq('id', id).single();
  if (!child) return res.status(404).json({ error: 'Afiliado filho não encontrado' });
  
  await supabase.from('affiliates').update({ parent_affiliate_id }).eq('id', id);
  res.json({ success: true, message: `Afiliado ${child.code} agora é subafiliado de ${parent.code}` });
});

app.delete('/api/admin/affiliates/:id/sub-affiliate', adminAuth, async (req, res) => {
  const { id } = req.params;
  await supabase.from('affiliates').update({ parent_affiliate_id: null }).eq('id', id);
  res.json({ success: true });
});

app.get('/api/admin/affiliates/:id/tree', adminAuth, async (req, res) => {
  const { id } = req.params;
  
  // Busca afiliado e todos os subafiliados recursivamente
  const { data: affiliate } = await supabase.from('affiliates').select('*, users(email, name)').eq('id', id).single();
  if (!affiliate) return res.status(404).json({ error: 'Afiliado não encontrado' });
  
  const { data: allAffiliates } = await supabase.from('affiliates').select('*, users(email, name)');
  
  function buildTree(affiliateId) {
    const aff = allAffiliates.find(a => a.id === affiliateId);
    if (!aff) return null;
    
    const children = allAffiliates
      .filter(a => a.parent_affiliate_id === affiliateId)
      .map(a => buildTree(a.id))
      .filter(Boolean);
    
    return { ...aff, children };
  }
  
  res.json(buildTree(id));
});

// --- ADMIN: TEST ACCOUNTS ---
app.post('/api/admin/test-accounts/create', adminAuth, async (req, res) => {
  try {
    const accounts = [];
    
    // Admin
    const adminEmail = 'admin@test.8token.com';
    const adminPass = await bcrypt.hash('admin123', 12);
    const { data: adminUser } = await supabase.from('users').insert({ 
      email: adminEmail, 
      password_hash: adminPass, 
      name: 'Admin Teste' 
    }).select().single();
    await supabase.from('ip_subscriptions').insert({
      ip: '0.0.0.0',
      user_id: adminUser.id,
      plan: 'anual',
      status: 'active',
      expires_at: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString()
    });
    accounts.push({ type: 'admin', email: adminEmail, password: 'admin123' });
    
    // Afiliado
    const affEmail = 'afiliado@test.8token.com';
    const affPass = await bcrypt.hash('afiliado123', 12);
    const { data: affUser } = await supabase.from('users').insert({ 
      email: affEmail, 
      password_hash: affPass, 
      name: 'Afiliado Teste' 
    }).select().single();
    const { data: affiliate } = await supabase.from('affiliates').insert({ 
      user_id: affUser.id, 
      commission_pct: 15, 
      code: 'aff_test_' + crypto.randomBytes(4).toString('hex') 
    }).select().single();
    accounts.push({ type: 'affiliate', email: affEmail, password: 'afiliado123', code: affiliate.code });
    
    // Subafiliado
    const subAffEmail = 'subafiliado@test.8token.com';
    const subAffPass = await bcrypt.hash('sub123', 12);
    const { data: subAffUser } = await supabase.from('users').insert({ 
      email: subAffEmail, 
      password_hash: subAffPass, 
      name: 'Subafiliado Teste' 
    }).select().single();
    const { data: subAffiliate } = await supabase.from('affiliates').insert({ 
      user_id: subAffUser.id, 
      commission_pct: 10, 
      code: 'subaff_test_' + crypto.randomBytes(4).toString('hex'),
      parent_affiliate_id: affiliate.id
    }).select().single();
    accounts.push({ type: 'sub-affiliate', email: subAffEmail, password: 'sub123', code: subAffiliate.code });
    
    // Usuário com plano ativo
    const activeEmail = 'ativo@test.8token.com';
    const activePass = await bcrypt.hash('ativo123', 12);
    const { data: activeUser } = await supabase.from('users').insert({ 
      email: activeEmail, 
      password_hash: activePass, 
      name: 'Usuário Ativo',
      plan: 'mensal',
      plan_expires_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString()
    }).select().single();
    await supabase.from('ip_subscriptions').insert({ 
      ip: '192.168.1.100', 
      user_id: activeUser.id, 
      plan: 'mensal', 
      status: 'active',
      expires_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString()
    });
    accounts.push({ type: 'active-user', email: activeEmail, password: 'ativo123' });
    
    // Usuário com plano expirado
    const expiredEmail = 'expirado@test.8token.com';
    const expiredPass = await bcrypt.hash('expirado123', 12);
    const { data: expiredUser } = await supabase.from('users').insert({ 
      email: expiredEmail, 
      password_hash: expiredPass, 
      name: 'Usuário Expirado',
      plan: 'mensal',
      plan_expires_at: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString()
    }).select().single();
    await supabase.from('ip_subscriptions').insert({ 
      ip: '192.168.1.101', 
      user_id: expiredUser.id, 
      plan: 'mensal', 
      status: 'expired',
      expires_at: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString()
    });
    accounts.push({ type: 'expired-user', email: expiredEmail, password: 'expirado123' });
    
    res.json({ success: true, accounts });
  } catch (err) {
    console.error('Test accounts error:', err);
    res.status(500).json({ error: 'Erro ao criar contas teste' });
  }
});

// --- ADMIN: EXPIRED PLANS NOTIFICATION ---
app.get('/api/admin/expired-plans', adminAuth, async (req, res) => {
  const now = new Date().toISOString();
  const { data } = await supabase.from('ip_subscriptions')
    .select('*, users(email, name)')
    .eq('status', 'active')
    .lt('expires_at', now);
  
  // Atualiza status para expired
  if (data && data.length > 0) {
    await supabase.from('ip_subscriptions')
      .update({ status: 'expired' })
      .in('id', data.map(d => d.id));
  }
  
  res.json({ expired: data || [], count: (data || []).length });
});

app.get('/api/admin/expiring-soon', adminAuth, async (req, res) => {
  const now = new Date();
  const in7days = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString();
  const { data } = await supabase.from('ip_subscriptions')
    .select('*, users(email, name)')
    .eq('status', 'active')
    .gt('expires_at', now.toISOString())
    .lt('expires_at', in7days);
  
  res.json({ expiring: data || [], count: (data || []).length });
});

// --- ADMIN: ACTIVATIONS ---
app.get('/api/admin/activations', adminAuth, async (req, res) => {
  const { data } = await supabase.from('ip_activation_requests').select('*, users(email, name)').order('created_at', { ascending: false });
  res.json(data || []);
});

app.post('/api/admin/activations/:id/approve', adminAuth, async (req, res) => {
  const { data: activation } = await supabase.from('ip_activation_requests').select('*').eq('id', req.params.id).single();
  if (!activation) return res.status(404).json({ error: 'Não encontrada' });
  await supabase.from('ip_activation_requests').update({ status: 'approved', resolved_at: new Date().toISOString() }).eq('id', req.params.id);
  await supabase.from('notifications').insert({ user_id: activation.user_id, title: 'IP Ativado!', message: `Seu IP ${activation.ip} foi ativado com sucesso.`, type: 'success' });
  res.json({ success: true });
});

app.post('/api/admin/activations/:id/reject', adminAuth, async (req, res) => {
  const { data: activation } = await supabase.from('ip_activation_requests').select('*').eq('id', req.params.id).single();
  if (!activation) return res.status(404).json({ error: 'Não encontrada' });
  await supabase.from('ip_activation_requests').update({ status: 'rejected', resolved_at: new Date().toISOString() }).eq('id', req.params.id);
  await supabase.from('notifications').insert({ user_id: activation.user_id, title: 'Ativação Recusada', message: `A ativação do seu IP foi recusada.`, type: 'error' });
  res.json({ success: true });
});

// --- ADMIN: IP CHANGES ---
app.get('/api/admin/ip-changes', adminAuth, async (req, res) => {
  const { data } = await supabase.from('ip_change_requests').select('*, users(email, name)').order('created_at', { ascending: false });
  res.json(data || []);
});

app.post('/api/admin/ip-changes/:id/approve', adminAuth, async (req, res) => {
  const { data: changeReq } = await supabase.from('ip_change_requests').select('*').eq('id', req.params.id).single();
  if (!changeReq) return res.status(404).json({ error: 'Não encontrada' });
  if (changeReq.status !== 'pending') return res.status(400).json({ error: 'Já processada' });
  await supabase.from('ip_subscriptions').update({ ip: changeReq.new_ip }).eq('user_id', changeReq.user_id).eq('status', 'active');
  await supabase.from('ip_change_requests').update({ status: 'approved', resolved_at: new Date().toISOString() }).eq('id', req.params.id);
  await supabase.from('notifications').insert({ user_id: changeReq.user_id, title: 'IP Alterado!', message: `Seu IP foi alterado de ${changeReq.old_ip} para ${changeReq.new_ip}.`, type: 'success' });
  const { data: approvedUser } = await supabase.from('users').select('email').eq('id', changeReq.user_id).single();
  if (approvedUser?.email) sendEmail(approvedUser.email, '8Token — IP alterado com sucesso',
    `<p>Olá! Sua solicitação foi aprovada.</p><p>Seu IP autorizado agora é <strong>${changeReq.new_ip}</strong> (antes: ${changeReq.old_ip}).</p>`).catch(() => {});
  res.json({ success: true });
});

app.post('/api/admin/ip-changes/:id/reject', adminAuth, async (req, res) => {
  const { notes } = req.body;
  const { data: changeReq } = await supabase.from('ip_change_requests').select('*').eq('id', req.params.id).single();
  if (!changeReq) return res.status(404).json({ error: 'Não encontrada' });
  await supabase.from('ip_change_requests').update({ status: 'rejected', notes, resolved_at: new Date().toISOString() }).eq('id', req.params.id);
  await supabase.from('notifications').insert({ user_id: changeReq.user_id, title: 'Alteração de IP Recusada', message: `Sua solicitação foi recusada.${notes ? ' Motivo: ' + notes : ''}`, type: 'error' });
  const { data: rejectedUser } = await supabase.from('users').select('email').eq('id', changeReq.user_id).single();
  if (rejectedUser?.email) sendEmail(rejectedUser.email, '8Token — Solicitação de IP recusada',
    `<p>Olá! Infelizmente sua solicitação de troca de IP para <strong>${changeReq.new_ip}</strong> foi recusada.${notes ? '</p><p>Motivo: ' + notes : ''}</p>`).catch(() => {});
  res.json({ success: true });
});

// --- ADMIN: COUPONS ---
app.get('/api/admin/coupons', adminAuth, async (req, res) => {
  const { data } = await supabase.from('coupons').select('*').order('created_at', { ascending: false });
  res.json(data || []);
});

app.post('/api/admin/coupons', adminAuth, async (req, res) => {
  const { code, discount_pct, max_uses, expires_at, notes } = req.body;
  if (!code || !discount_pct) return res.status(400).json({ error: 'Código e desconto são obrigatórios' });
  const { data: existing } = await supabase.from('coupons').select('id').eq('code', code.toUpperCase()).single();
  if (existing) return res.status(409).json({ error: 'Cupom já existe' });
  const { data } = await supabase.from('coupons').insert({ code: code.toUpperCase(), discount_pct, max_uses, expires_at, notes }).select().single();
  res.json(data);
});

app.put('/api/admin/coupons/:id', adminAuth, async (req, res) => {
  const { discount_pct, max_uses, expires_at, active, notes } = req.body;
  const update = {};
  if (discount_pct !== undefined) update.discount_pct = discount_pct;
  if (max_uses !== undefined) update.max_uses = max_uses;
  if (expires_at !== undefined) update.expires_at = expires_at;
  if (active !== undefined) update.active = active;
  if (notes !== undefined) update.notes = notes;
  await supabase.from('coupons').update(update).eq('id', req.params.id);
  res.json({ success: true });
});

app.delete('/api/admin/coupons/:id', adminAuth, async (req, res) => {
  await supabase.from('coupons').delete().eq('id', req.params.id);
  res.json({ success: true });
});

app.post('/api/coupons/validate', async (req, res) => {
  const { code } = req.body;
  if (!code) return res.status(400).json({ valid: false, error: 'Código necessário' });
  const { data: coupon } = await supabase.from('coupons').select('*').eq('code', code.toUpperCase()).eq('active', true).single();
  if (!coupon) return res.json({ valid: false, error: 'Cupom inválido' });
  if (coupon.expires_at && new Date(coupon.expires_at) < new Date()) return res.json({ valid: false, error: 'Cupom expirado' });
  if (coupon.max_uses && coupon.uses_count >= coupon.max_uses) return res.json({ valid: false, error: 'Cupom esgotado' });
  res.json({ valid: true, discount_pct: coupon.discount_pct, code: coupon.code });
});

app.post('/api/coupons/apply', authenticateToken, async (req, res) => {
  const { code, plan } = req.body;
  if (!code || !plan) return res.status(400).json({ error: 'Código e plano necessários' });
  const { data: coupon } = await supabase.from('coupons').select('*').eq('code', code.toUpperCase()).eq('active', true).single();
  if (!coupon) return res.status(404).json({ error: 'Cupom inválido' });
  if (coupon.expires_at && new Date(coupon.expires_at) < new Date()) return res.status(400).json({ error: 'Cupom expirado' });
  if (coupon.max_uses && coupon.uses_count >= coupon.max_uses) return res.status(400).json({ error: 'Cupom esgotado' });
  const originalPrice = PLAN_PRICES[plan] || 0;
  if (!originalPrice) return res.status(400).json({ error: 'Plano inválido' });
  const discountAmount = originalPrice * (coupon.discount_pct / 100);
  res.json({ valid: true, code: coupon.code, discount_pct: coupon.discount_pct, original_price: originalPrice, discount_amount: Math.round(discountAmount * 100) / 100, final_price: Math.round((originalPrice - discountAmount) * 100) / 100 });
});

// --- ADMIN: AFFILIATES ---
app.get('/api/admin/affiliates', adminAuth, async (req, res) => {
  const { data } = await supabase.from('affiliates').select('*, users(email, name)').order('created_at', { ascending: false });
  res.json(data || []);
});

app.post('/api/admin/affiliates', adminAuth, async (req, res) => {
  const { user_id, commission_pct } = req.body;
  if (!user_id) return res.status(400).json({ error: 'user_id é obrigatório' });
  const { data: existing } = await supabase.from('affiliates').select('id').eq('user_id', user_id).single();
  if (existing) return res.status(409).json({ error: 'Usuário já é afiliado' });
  const code = 'aff_' + crypto.randomBytes(6).toString('hex');
  const { data } = await supabase.from('affiliates').insert({ user_id, commission_pct: commission_pct || 10, code }).select().single();
  await supabase.from('notifications').insert({ user_id, title: 'Você é Afiliado!', message: `Parabéns! Comissão: ${commission_pct || 10}%. Código: ${code}`, type: 'success' });
  res.json(data);
});

app.put('/api/admin/affiliates/:id', adminAuth, async (req, res) => {
  const { commission_pct } = req.body;
  await supabase.from('affiliates').update({ commission_pct }).eq('id', req.params.id);
  res.json({ success: true });
});

app.delete('/api/admin/affiliates/:id', adminAuth, async (req, res) => {
  await supabase.from('affiliates').delete().eq('id', req.params.id);
  res.json({ success: true });
});

// --- AFFILIATE PANEL ---
app.get('/api/affiliate/me', authenticateToken, async (req, res) => {
  const { data: affiliate } = await supabase.from('affiliates').select('*').eq('user_id', req.user.id).single();
  if (!affiliate) return res.status(404).json({ error: 'Você não é afiliado' });
  const { data: referrals } = await supabase.from('affiliate_referrals').select('*, users(email, name)').eq('affiliate_id', affiliate.id).order('created_at', { ascending: false });
  const paidReferrals = (referrals || []).filter(r => r.paid_at);
  const totalVolume = paidReferrals.reduce((sum, r) => sum + (r.amount || 0), 0);
  res.json({
    affiliate: { id: affiliate.id, code: affiliate.code, commission_pct: affiliate.commission_pct },
    stats: { total_referrals: (referrals || []).length, paid_referrals: paidReferrals.length, total_volume: totalVolume, commissionEarned: totalVolume * (affiliate.commission_pct / 100) },
    referrals: referrals || []
  });
});

// --- INVOICES & USAGE ---
app.get('/api/invoices', authenticateToken, async (req, res) => {
  const { data } = await supabase.from('invoices').select('*').eq('user_id', req.user.id).order('created_at', { ascending: false });
  res.json(data || []);
});

app.get('/api/usage', authenticateToken, async (req, res) => {
  const { data } = await supabase.from('usage_logs').select('*').eq('user_id', req.user.id).order('created_at', { ascending: false }).limit(100);
  res.json(data || []);
});

// --- ADMIN: SETUP (one-time: promote admin + create test accounts) ---
app.post('/api/admin/setup', adminAuth, async (req, res) => {
  try {
    const results = [];

    // 1. Promote matetomete@gmail.com to admin role in custom table
    const { data: adminUser } = await supabase.from('users').select('*').eq('email', 'matetomete@gmail.com').single();
    if (adminUser) {
      await supabase.from('users').update({ role: 'admin' }).eq('id', adminUser.id);
      results.push({ action: 'promote-admin', email: 'matetomete@gmail.com', status: 'updated', id: adminUser.id });
    } else {
      // Try to sync from Supabase Auth
      // Create admin record directly in custom table using the known Supabase Auth UID from the screenshot
      const knownUid = 'cc492624-1fdd-4d15-92d9-3caea304e662';
      const { data: newUser, error: insErr } = await supabase.from('users').insert({
        id: knownUid, email: 'matetomete@gmail.com', name: 'Admin', plan: 'anual', role: 'admin'
      }).select().single();
      if (newUser) {
        results.push({ action: 'promote-admin', email: 'matetomete@gmail.com', status: 'created', id: newUser.id });
      } else if (insErr && insErr.code === '23505') {
        // Already exists — just promote
        await supabase.from('users').update({ role: 'admin' }).eq('email', 'matetomete@gmail.com');
        results.push({ action: 'promote-admin', email: 'matetomete@gmail.com', status: 'already-exists-promoted' });
      } else {
        results.push({ action: 'promote-admin', email: 'matetomete@gmail.com', status: 'error', error: insErr?.message });
      }
    }

    // 2. Create 5 test accounts
    const testAccounts = [
      { email: 'admin@test.8token.com', password: 'admin123', name: 'Admin Teste', plan: 'anual', role: 'admin', ip: '127.0.0.1', ipStatus: 'active', ipPlan: 'anual' },
      { email: 'afiliado@test.8token.com', password: 'afiliado123', name: 'Afiliado Teste', plan: 'free', ip: null, ipStatus: null, ipPlan: null, affiliate: true, commission: 15 },
      { email: 'subafiliado@test.8token.com', password: 'sub123', name: 'Subafiliado Teste', plan: 'free', ip: null, ipStatus: null, ipPlan: null, affiliate: true, commission: 10 },
      { email: 'ativo@test.8token.com', password: 'ativo123', name: 'Usuário Ativo', plan: 'mensal', ip: '192.168.1.100', ipStatus: 'active', ipPlan: 'mensal', expiresDays: 30 },
      { email: 'expirado@test.8token.com', password: 'expirado123', name: 'Usuário Expirado', plan: 'mensal', ip: '192.168.1.101', ipStatus: 'expired', ipPlan: 'mensal', expiresDays: -5 },
    ];

    for (const acct of testAccounts) {
      try {
        // Check if already exists
        const { data: existing } = await supabase.from('users').select('id').eq('email', acct.email).single();
        if (existing) {
          // Update plan if needed
          await supabase.from('users').update({ plan: acct.plan, name: acct.name }).eq('id', existing.id);
          results.push({ action: 'test-account', email: acct.email, status: 'already-exists-updated', id: existing.id });
          continue;
        }

        const passwordHash = await bcrypt.hash(acct.password, 12);
        const planExpiresAt = acct.expiresDays !== undefined
          ? new Date(Date.now() + acct.expiresDays * 24 * 60 * 60 * 1000).toISOString()
          : null;

        const { data: newUser, error: insertErr } = await supabase.from('users').insert({
          email: acct.email,
          password_hash: passwordHash,
          name: acct.name,
          plan: acct.plan,
          plan_expires_at: planExpiresAt
        }).select().single();

        if (insertErr || !newUser) {
          results.push({ action: 'test-account', email: acct.email, status: 'error', error: insertErr?.message });
          continue;
        }

        // Create IP subscription if needed
        if (acct.ip) {
          const ipExpiresAt = acct.expiresDays !== undefined
            ? new Date(Date.now() + acct.expiresDays * 24 * 60 * 60 * 1000).toISOString()
            : null;
          await supabase.from('ip_subscriptions').insert({
            ip: acct.ip,
            user_id: newUser.id,
            plan: acct.ipPlan,
            status: acct.ipStatus,
            expires_at: ipExpiresAt
          });
        }

        // Create affiliate record if needed
        if (acct.affiliate) {
          const code = 'aff_' + crypto.randomBytes(6).toString('hex');
          await supabase.from('affiliates').insert({
            user_id: newUser.id,
            commission_pct: acct.commission,
            code
          });
        }

        results.push({ action: 'test-account', email: acct.email, status: 'created', id: newUser.id });
      } catch (acctErr) {
        results.push({ action: 'test-account', email: acct.email, status: 'error', error: acctErr.message });
      }
    }

    // 3. Link subaffiliate to affiliate
    const { data: affUser } = await supabase.from('users').select('id').eq('email', 'afiliado@test.8token.com').single();
    const { data: subUser } = await supabase.from('users').select('id').eq('email', 'subafiliado@test.8token.com').single();
    if (affUser && subUser) {
      const { data: affRecord } = await supabase.from('affiliates').select('id').eq('user_id', affUser.id).single();
      const { data: subRecord } = await supabase.from('affiliates').select('id').eq('user_id', subUser.id).single();
      if (affRecord && subRecord) {
        await supabase.from('affiliates').update({ parent_affiliate_id: affRecord.id }).eq('id', subRecord.id);
        results.push({ action: 'link-subaffiliate', status: 'linked', parent: affRecord.id, child: subRecord.id });
      }
    }

    res.json({ success: true, results });
  } catch (err) {
    console.error('Setup error:', err);
    res.status(500).json({ error: 'Erro no setup: ' + err.message });
  }
});

// --- ADMIN: WEBHOOK KIRVANO CONFIG ---
app.post('/api/admin/webhook-config', adminAuth, async (req, res) => {
  try {
    const { webhook_token, product_mensal_id, product_trimestral_id, product_anual_id, checkout_mensal_url, checkout_trimestral_url, checkout_anual_url } = req.body;
    if (!webhook_token) return res.status(400).json({ error: 'Token do webhook é obrigatório' });
    // Store config in a settings table (create if not exists)
    const configData = {
      key: 'kirvano_config',
      value: JSON.stringify({
        webhook_token,
        product_mensal_id: product_mensal_id || '',
        product_trimestral_id: product_trimestral_id || '',
        product_anual_id: product_anual_id || '',
        checkout_mensal_url: checkout_mensal_url || '',
        checkout_trimestral_url: checkout_trimestral_url || '',
        checkout_anual_url: checkout_anual_url || ''
      }),
      updated_at: new Date().toISOString()
    };
    // Try update first, then insert
    const { data: existing } = await supabase.from('settings').select('id').eq('key', 'kirvano_config').single();
    if (existing) {
      await supabase.from('settings').update({ value: configData.value, updated_at: configData.updated_at }).eq('key', 'kirvano_config');
    } else {
      await supabase.from('settings').insert(configData);
    }
    res.json({ success: true, message: 'Configuração do webhook salva' });
  } catch (err) {
    console.error('Webhook config error:', err);
    res.status(500).json({ error: 'Erro ao salvar configuração: ' + err.message });
  }
});

app.get('/api/admin/webhook-config', adminAuth, async (req, res) => {
  try {
    const { data } = await supabase.from('settings').select('value').eq('key', 'kirvano_config').single();
    if (!data) return res.json({ configured: false });
    const config = JSON.parse(data.value);
    res.json({ configured: true, ...config });
  } catch (err) {
    res.json({ configured: false });
  }
});

app.post('/api/admin/webhook-test', adminAuth, async (req, res) => {
  try {
    // Simulate a test webhook event
    const testPayload = {
      event: 'SALE_APPROVED',
      test: true,
      timestamp: new Date().toISOString(),
      customer: { email: 'teste@webhook.8token.com' },
      product: { id: 'test_product' }
    };
    // Log the test event
    await supabase.from('webhook_logs').insert({
      event: 'TEST_EVENT',
      status: 'test_ok',
      customer_email: 'teste@webhook.8token.com',
      payload: testPayload,
      created_at: new Date().toISOString()
    });
    res.json({ success: true, message: 'Evento de teste registrado nos logs' });
  } catch (err) {
    res.status(500).json({ error: 'Erro no teste: ' + err.message });
  }
});

// TEMP: Migrate webhook_logs table — add missing columns
app.post('/api/admin/migrate-webhook-logs', adminAuth, async (req, res) => {
  try {
    const { data, error } = await supabase.rpc('exec_sql', { sql: `
      ALTER TABLE webhook_logs ADD COLUMN IF NOT EXISTS event TEXT;
      ALTER TABLE webhook_logs ADD COLUMN IF NOT EXISTS status TEXT;
      ALTER TABLE webhook_logs ADD COLUMN IF NOT EXISTS customer_email TEXT;
      ALTER TABLE webhook_logs ADD COLUMN IF NOT EXISTS customer_ip TEXT;
      ALTER TABLE webhook_logs ADD COLUMN IF NOT EXISTS plan TEXT;
    `});
    if (error) throw error;
    res.json({ success: true, message: 'Colunas adicionadas com sucesso' });
  } catch (err) {
    // Fallback: try individual inserts to test which columns exist
    const testPayload = { event_type: 'MIGRATION_TEST', event: 'MIGRATION_TEST', sale_id: 'mig-test', status: 'TEST', customer_email: 'mig@test.com', customer_ip: '0.0.0.0', plan: 'test', payload: { test: true } };
    const { error: insertErr } = await supabase.from('webhook_logs').insert(testPayload);
    if (insertErr) {
      // Try minimal insert
      const { error: minErr } = await supabase.from('webhook_logs').insert({ event_type: 'MIGRATION_TEST', sale_id: 'mig-test', payload: { test: true } });
      if (minErr) return res.status(500).json({ error: 'Tabela webhook_logs não aceita insert: ' + minErr.message, detail: insertErr.message });
      return res.json({ success: false, message: 'Colunas extras não existem na tabela. Adicione manualmente no Supabase SQL Editor:', sql: 'ALTER TABLE webhook_logs ADD COLUMN IF NOT EXISTS event TEXT; ALTER TABLE webhook_logs ADD COLUMN IF NOT EXISTS status TEXT; ALTER TABLE webhook_logs ADD COLUMN IF NOT EXISTS customer_email TEXT; ALTER TABLE webhook_logs ADD COLUMN IF NOT EXISTS customer_ip TEXT; ALTER TABLE webhook_logs ADD COLUMN IF NOT EXISTS plan TEXT;', minimal_insert_works: true });
    }
    // Clean up test row
    await supabase.from('webhook_logs').delete().eq('sale_id', 'mig-test');
    res.json({ success: true, message: 'Tabela webhook_logs já tem todas as colunas necessárias' });
  }
});

// Remote deploy endpoint — runs git pull + pm2 restart on the VPS
app.post('/api/admin/deploy', adminAuth, async (req, res) => {
  const { exec } = require('child_process');
  const cmd = 'cd /opt/8token && git pull && pm2 restart 8token';
  exec(cmd, { timeout: 30000 }, (err, stdout, stderr) => {
    if (err) return res.status(500).json({ error: err.message, stderr });
    res.json({ success: true, output: stdout, stderr });
  });
});

app.get('/api/admin/webhook-logs', adminAuth, async (req, res) => {
  try {
    const { data } = await supabase.from('webhook_logs').select('*').order('created_at', { ascending: false }).limit(50);
    res.json(data || []);
  } catch (err) {
    res.status(500).json({ error: 'Erro ao carregar logs: ' + err.message });
  }
});

// --- ADMIN: BROADCAST NOTIFICATION ---
app.post('/api/admin/notifications/broadcast', adminAuth, async (req, res) => {
  try {
    const { title, message, type = 'info', target_plan = 'all' } = req.body;
    if (!title || !message) return res.status(400).json({ error: 'Título e mensagem são obrigatórios' });

    // Busca usuários pelo plano alvo
    let query = supabase.from('users').select('id');
    if (target_plan && target_plan !== 'all') {
      query = query.eq('plan', target_plan);
    }
    const { data: users, error: fetchErr } = await query;
    if (fetchErr) throw fetchErr;
    if (!users || !users.length) return res.status(404).json({ error: 'Nenhum usuário encontrado para este plano' });

    // Insere notificação para cada usuário
    const notifications = users.map(u => ({
      user_id: u.id,
      title,
      message,
      type,
      read: false
    }));

    // Supabase aceita até 1000 inserts por chamada
    const batchSize = 500;
    for (let i = 0; i < notifications.length; i += batchSize) {
      const batch = notifications.slice(i, i + batchSize);
      const { error } = await supabase.from('notifications').insert(batch);
      if (error) throw error;
    }

    res.json({ success: true, count: users.length, message: `Notificação enviada para ${users.length} usuário(s)` });
  } catch (err) {
    console.error('Broadcast notification error:', err);
    res.status(500).json({ error: 'Erro ao enviar notificação: ' + err.message });
  }
});

// --- USER: UNREAD COUNT ---
app.get('/api/notifications/unread-count', authenticateToken, async (req, res) => {
  const { count } = await supabase.from('notifications')
    .select('*', { count: 'exact', head: true })
    .eq('user_id', req.user.id)
    .eq('read', false);
  res.json({ count: count || 0 });
});

// --- ADMIN: SITE SETTINGS (gateway URL, etc.) ---
app.get('/api/admin/settings', adminAuth, async (req, res) => {
  const { data } = await supabase.from('site_settings').select('*');
  const settings = {};
  (data || []).forEach(row => { settings[row.key] = row.value; });
  res.json(settings);
});

app.put('/api/admin/settings', adminAuth, async (req, res) => {
  const entries = Object.entries(req.body);
  if (!entries.length) return res.status(400).json({ error: 'Nenhuma configuração enviada.' });
  for (const [key, value] of entries) {
    await supabase.from('site_settings').upsert({ key, value: String(value), updated_at: new Date().toISOString() }, { onConflict: 'key' });
  }
  res.json({ success: true, message: `${entries.length} configuração(ões) salva(s).` });
});

// Public endpoint: returns gateway URL only for authenticated users with active plan
app.get('/api/user/gateway-url', authenticateToken, async (req, res) => {
  // Verify user has at least one active paid subscription
  const { data: subs } = await supabase
    .from('ip_subscriptions')
    .select('id')
    .eq('user_id', req.user.id)
    .eq('status', 'active')
    .neq('plan', 'free')
    .limit(1);
  if (!subs || !subs.length) {
    return res.status(403).json({ error: 'Plano ativo necessário para acessar o gateway.' });
  }
  const { data: setting } = await supabase.from('site_settings').select('value').eq('key', 'gateway_url').single();
  const gatewayUrl = setting?.value || 'https://8token.tech/v1';
  res.json({ gateway_url: gatewayUrl });
});

// =============================================================================
// CRM DASHBOARD ENDPOINTS
// =============================================================================

// Helper: compute effective status from subscription data
function computeCrmStatus(sub) {
  if (!sub) return 'none';
  if (sub.status === 'cancelled') return 'cancelled';
  if (sub.expires_at && new Date(sub.expires_at) <= new Date()) return 'expired';
  if (sub.status === 'active') return 'active';
  return sub.status || 'none';
}

// GET /api/admin/crm/users — paginated, filterable user list for CRM table
app.get('/api/admin/crm/users', adminAuth, async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const perPage = Math.min(100, Math.max(1, parseInt(req.query.per_page) || 25));
    const search = (req.query.search || '').trim();
    const statusFilter = req.query.status || '';
    const planFilter = req.query.plan || '';
    const expiryWindow = req.query.expiry_window || ''; // 'this_month', 'next_month', 'expiring_7d'

    // Build base query for users with their active subscriptions via JOIN
    let query = supabase
      .from('users')
      .select('id, email, name, plan, created_at, updated_at, last_login_at', { count: 'exact' })
      .order('created_at', { ascending: false });

    // Search filter
    if (search) {
      query = query.or(`email.ilike.%${search}%,name.ilike.%${search}%`);
    }

    // Plan filter
    if (planFilter) {
      query = query.eq('plan', planFilter);
    }

    // Pagination
    const from = (page - 1) * perPage;
    const to = from + perPage - 1;
    query = query.range(from, to);

    const { data: users, error, count } = await query;
    if (error) throw error;

    // For each user, fetch IPs and compute status
    const enrichedUsers = [];
    for (const u of (users || [])) {
      const { data: subs } = await supabase
        .from('ip_subscriptions')
        .select('ip, status, plan, expires_at, has_additional_ip, additional_ip')
        .eq('user_id', u.id)
        .order('created_at', { ascending: false });

      const ips = (subs || []).map(s => ({
        ip: s.ip,
        status: s.status,
        plan: s.plan,
        expires_at: s.expires_at,
        is_additional: !!s.has_additional_ip
      }));

      // Effective plan/status from most recent active subscription (canonical source)
      const activeSub = (subs || []).find(s => s.status === 'active');
      const effectivePlan = activeSub ? activeSub.plan : (u.plan || 'free');
      const effectiveStatus = computeCrmStatus(activeSub || (subs && subs[0]));

      // Status filter (applied post-enrichment since it depends on subscription)
      if (statusFilter && effectiveStatus !== statusFilter) continue;

      // Expiry window filter
      if (expiryWindow && activeSub && activeSub.expires_at) {
        const expDate = new Date(activeSub.expires_at);
        const now = new Date();
        if (expiryWindow === 'this_month') {
          if (expDate.getMonth() !== now.getMonth() || expDate.getFullYear() !== now.getFullYear()) continue;
        } else if (expiryWindow === 'next_month') {
          const nextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1);
          const afterNextMonth = new Date(now.getFullYear(), now.getMonth() + 2, 1);
          if (expDate < nextMonth || expDate >= afterNextMonth) continue;
        } else if (expiryWindow === 'expiring_7d') {
          const in7d = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
          if (expDate < now || expDate > in7d) continue;
        }
      }

      // Last webhook event for this user
      const { data: lastWebhook } = await supabase
        .from('webhook_logs')
        .select('created_at')
        .eq('sale_id', null) // generic match
        .order('created_at', { ascending: false })
        .limit(1);

      enrichedUsers.push({
        id: u.id,
        email: u.email,
        name: u.name,
        plan: effectivePlan,
        status: effectiveStatus,
        expires_at: activeSub ? activeSub.expires_at : null,
        last_login_at: u.last_login_at || null,
        updated_at: u.updated_at || u.created_at,
        ip_count: ips.length,
        ips,
        created_at: u.created_at,
        last_webhook_event: lastWebhook ? lastWebhook.created_at : null
      });
    }

    // Compute segment counts (full scan, not paginated)
    const { data: allUsers } = await supabase.from('users').select('id, plan');
    const segments = { active_paid: 0, free_only: 0, expired: 0, cancelled: 0, no_subscription: 0 };
    for (const au of (allUsers || [])) {
      const { data: aSub } = await supabase
        .from('ip_subscriptions')
        .select('status, plan, expires_at')
        .eq('user_id', au.id)
        .eq('status', 'active')
        .order('created_at', { ascending: false })
        .limit(1)
        .single();
      const st = computeCrmStatus(aSub);
      if (st === 'active' && aSub && aSub.plan !== 'free') segments.active_paid++;
      else if (st === 'active' && (!aSub || aSub.plan === 'free')) segments.free_only++;
      else if (st === 'expired') segments.expired++;
      else if (st === 'cancelled') segments.cancelled++;
      else segments.no_subscription++;
    }

    res.json({
      users: enrichedUsers,
      pagination: { page, per_page: perPage, total: count || 0 },
      segments
    });
  } catch (err) {
    console.error('CRM users error:', err);
    res.status(500).json({ error: 'Erro ao carregar usuários CRM: ' + err.message });
  }
});

// GET /api/admin/crm/users/:id — full user detail for side panel
app.get('/api/admin/crm/users/:id', adminAuth, async (req, res) => {
  try {
    const { id } = req.params;

    const { data: user, error: userErr } = await supabase
      .from('users')
      .select('id, email, name, plan, created_at, updated_at, last_login_at')
      .eq('id', id)
      .single();
    if (userErr || !user) return res.status(404).json({ error: 'Usuário não encontrado' });

    // Subscriptions
    const { data: subscriptions } = await supabase
      .from('ip_subscriptions')
      .select('id, ip, plan, status, expires_at, auto_renew, cancellation_reason, renewed_from_id, created_at')
      .eq('user_id', id)
      .order('created_at', { ascending: false });

    const activeSub = (subscriptions || []).find(s => s.status === 'active');
    const effectiveStatus = computeCrmStatus(activeSub || (subscriptions && subscriptions[0]));

    // Invoices
    const { data: invoices } = await supabase
      .from('invoices')
      .select('id, amount, status, paid_by_webhook, kirvano_sale_id, created_at')
      .eq('user_id', id)
      .order('created_at', { ascending: false });

    // Audit log
    const { data: audit_log } = await supabase
      .from('plan_audit_log')
      .select('id, actor, action, field_changed, old_value, new_value, created_at')
      .eq('user_id', id)
      .order('created_at', { ascending: false })
      .limit(100);

    // IP history (all subscriptions including inactive)
    const { data: ipHistoryRaw } = await supabase
      .from('ip_subscriptions')
      .select('ip, status, plan, created_at, expires_at')
      .eq('user_id', id)
      .order('created_at', { ascending: true });

    // Deduplicate IPs and compute first/last seen
    const ipMap = {};
    for (const rec of (ipHistoryRaw || [])) {
      if (!ipMap[rec.ip]) {
        ipMap[rec.ip] = { ip: rec.ip, first_seen: rec.created_at, last_seen: rec.created_at, is_active: rec.status === 'active' };
      } else {
        ipMap[rec.ip].last_seen = rec.created_at;
        if (rec.status === 'active') ipMap[rec.ip].is_active = true;
      }
    }
    const ip_history = Object.values(ipMap);

    res.json({
      user: {
        ...user,
        status: effectiveStatus,
        expires_at: activeSub ? activeSub.expires_at : null
      },
      subscriptions: subscriptions || [],
      invoices: invoices || [],
      audit_log: audit_log || [],
      ip_history
    });
  } catch (err) {
    console.error('CRM user detail error:', err);
    res.status(500).json({ error: 'Erro ao carregar detalhes do usuário: ' + err.message });
  }
});

// PUT /api/admin/crm/users/:id — admin edit user data and plan
app.put('/api/admin/crm/users/:id', adminAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const { name, email, plan } = req.body;

    const { data: user } = await supabase.from('users').select('id, plan').eq('id', id).single();
    if (!user) return res.status(404).json({ error: 'Usuário não encontrado' });

    const updateFields = {};
    if (name !== undefined) updateFields.name = name;
    if (email !== undefined) updateFields.email = email;
    if (plan !== undefined) updateFields.plan = plan;
    updateFields.updated_at = new Date().toISOString();

    const { error: updateErr } = await supabase.from('users').update(updateFields).eq('id', id);
    if (updateErr) throw updateErr;

    // Sync plan to active subscriptions if plan changed
    let syncedCount = 0;
    if (plan !== undefined && plan !== user.plan) {
      const { data: activeSubs } = await supabase
        .from('ip_subscriptions')
        .select('id')
        .eq('user_id', id)
        .eq('status', 'active');

      if (activeSubs && activeSubs.length > 0) {
        const ids = activeSubs.map(s => s.id);
        await supabase.from('ip_subscriptions').update({ plan }).in('id', ids);
        syncedCount = ids.length;
      }

      // Audit log
      const { data: auditEntry } = await supabase
        .from('plan_audit_log')
        .insert({
          user_id: id,
          actor: 'admin',
          action: 'plan_change',
          field_changed: 'plan',
          old_value: user.plan,
          new_value: plan
        })
        .select('id')
        .single();

      return res.json({
        success: true,
        user: { id, plan, updated_at: updateFields.updated_at },
        synced_subscriptions: syncedCount,
        audit_entry_id: auditEntry ? auditEntry.id : null
      });
    }

    res.json({
      success: true,
      user: { id, plan: plan || user.plan, updated_at: updateFields.updated_at },
      synced_subscriptions: 0,
      audit_entry_id: null
    });
  } catch (err) {
    console.error('CRM user update error:', err);
    res.status(500).json({ error: 'Erro ao atualizar usuário: ' + err.message });
  }
});

// POST /api/admin/crm/users/:id/sync-plan — force sync users.plan with ip_subscriptions
app.post('/api/admin/crm/users/:id/sync-plan', adminAuth, async (req, res) => {
  try {
    const { id } = req.params;

    const { data: user } = await supabase.from('users').select('id, plan').eq('id', id).single();
    if (!user) return res.status(404).json({ error: 'Usuário não encontrado' });

    // Source of truth: most recent active subscription
    const { data: activeSub } = await supabase
      .from('ip_subscriptions')
      .select('plan')
      .eq('user_id', id)
      .eq('status', 'active')
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    const canonicalPlan = activeSub ? activeSub.plan : 'free';
    const previousPlan = user.plan;

    if (previousPlan === canonicalPlan) {
      return res.json({
        success: true,
        previous_user_plan: previousPlan,
        new_user_plan: canonicalPlan,
        subscriptions_updated: 0,
        audit_entry_id: null
      });
    }

    // Update user plan
    await supabase.from('users').update({ plan: canonicalPlan }).eq('id', id);

    // Audit log
    const { data: auditEntry } = await supabase
      .from('plan_audit_log')
      .insert({
        user_id: id,
        actor: 'admin',
        action: 'sync_plan',
        field_changed: 'plan',
        old_value: previousPlan,
        new_value: canonicalPlan
      })
      .select('id')
      .single();

    res.json({
      success: true,
      previous_user_plan: previousPlan,
      new_user_plan: canonicalPlan,
      subscriptions_updated: 0,
      audit_entry_id: auditEntry ? auditEntry.id : null
    });
  } catch (err) {
    console.error('CRM sync-plan error:', err);
    res.status(500).json({ error: 'Erro ao sincronizar plano: ' + err.message });
  }
});

// GET /api/admin/crm/metrics/expiry — KPI cards: expiry metrics
app.get('/api/admin/crm/metrics/expiry', adminAuth, async (req, res) => {
  try {
    const now = new Date();
    const endOfThisMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);
    const endOfNextMonth = new Date(now.getFullYear(), now.getMonth() + 2, 0, 23, 59, 59, 999);
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

    // Active total
    const { count: activeTotal } = await supabase
      .from('ip_subscriptions')
      .select('*', { count: 'exact', head: true })
      .eq('status', 'active')
      .neq('plan', 'free');

    // Expiring this month (active, expires_at between now and end of month)
    const { count: expiringThisMonth } = await supabase
      .from('ip_subscriptions')
      .select('*', { count: 'exact', head: true })
      .eq('status', 'active')
      .gte('expires_at', now.toISOString())
      .lte('expires_at', endOfThisMonth.toISOString());

    // Expiring next month
    const startOfNextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1);
    const { count: expiringNextMonth } = await supabase
      .from('ip_subscriptions')
      .select('*', { count: 'exact', head: true })
      .eq('status', 'active')
      .gte('expires_at', startOfNextMonth.toISOString())
      .lte('expires_at', endOfNextMonth.toISOString());

    // Churn rate 30d: expired in last 30 days / active total
    const { count: recentlyExpired } = await supabase
      .from('ip_subscriptions')
      .select('*', { count: 'exact', head: true })
      .eq('status', 'expired')
      .gte('expires_at', thirtyDaysAgo.toISOString())
      .lte('expires_at', now.toISOString());

    const churnRate30d = (activeTotal || 0) > 0
      ? Math.round(((recentlyExpired || 0) / (activeTotal || 1)) * 10000) / 100
      : 0;

    // Expiring by week (next 4 weeks)
    const expiringByWeek = [];
    for (let w = 0; w < 4; w++) {
      const weekStart = new Date(now.getTime() + w * 7 * 24 * 60 * 60 * 1000);
      const weekEnd = new Date(weekStart.getTime() + 7 * 24 * 60 * 60 * 1000);
      const { count } = await supabase
        .from('ip_subscriptions')
        .select('*', { count: 'exact', head: true })
        .eq('status', 'active')
        .gte('expires_at', weekStart.toISOString())
        .lt('expires_at', weekEnd.toISOString());
      expiringByWeek.push({ week_start: weekStart.toISOString(), count: count || 0 });
    }

    res.json({
      expiring_this_month: expiringThisMonth || 0,
      expiring_next_month: expiringNextMonth || 0,
      active_total: activeTotal || 0,
      churn_rate_30d: churnRate30d,
      expiring_by_week: expiringByWeek
    });
  } catch (err) {
    console.error('CRM expiry metrics error:', err);
    res.status(500).json({ error: 'Erro ao carregar métricas de expiração: ' + err.message });
  }
});

// GET /api/admin/crm/revenue/projection — MRR and revenue projection
app.get('/api/admin/crm/revenue/projection', adminAuth, async (req, res) => {
  try {
    const { data: activeSubs } = await supabase
      .from('ip_subscriptions')
      .select('plan, expires_at')
      .eq('status', 'active')
      .neq('plan', 'free');

    const mrrByPlan = { mensal: 0, trimestral: 0, anual: 0 };
    let projectedNext30d = 0;
    let projectedNext90d = 0;
    const now = new Date();
    const in30d = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
    const in90d = new Date(now.getTime() + 90 * 24 * 60 * 60 * 1000);

    for (const sub of (activeSubs || [])) {
      const price = PLAN_PRICES[sub.plan] || 0;
      if (!price) continue;

      // Monthly normalized revenue
      let monthlyRevenue = 0;
      if (sub.plan === 'mensal') monthlyRevenue = price;
      else if (sub.plan === 'trimestral') monthlyRevenue = price / 3;
      else if (sub.plan === 'anual') monthlyRevenue = price / 12;

      mrrByPlan[sub.plan] = (mrrByPlan[sub.plan] || 0) + monthlyRevenue;

      // Projection: only count if subscription is still active in the window
      if (sub.expires_at) {
        const expDate = new Date(sub.expires_at);
        if (expDate > now && expDate <= in30d) projectedNext30d += price;
        if (expDate > now && expDate <= in90d) projectedNext90d += price;
      }
    }

    const mrrTotal = Object.values(mrrByPlan).reduce((sum, v) => sum + v, 0);

    res.json({
      mrr_total: Math.round(mrrTotal * 100) / 100,
      mrr_by_plan: {
        mensal: Math.round((mrrByPlan.mensal || 0) * 100) / 100,
        trimestral: Math.round((mrrByPlan.trimestral || 0) * 100) / 100,
        anual: Math.round((mrrByPlan.anual || 0) * 100) / 100
      },
      projected_next_30d: Math.round(projectedNext30d * 100) / 100,
      projected_next_90d: Math.round(projectedNext90d * 100) / 100,
      currency: 'BRL'
    });
  } catch (err) {
    console.error('CRM revenue projection error:', err);
    res.status(500).json({ error: 'Erro ao calcular projeção de receita: ' + err.message });
  }
});

// GET /api/admin/crm/ip-history/:user_id — full IP history for audit
app.get('/api/admin/crm/ip-history/:user_id', adminAuth, async (req, res) => {
  try {
    const { user_id } = req.params;

    const { data: records } = await supabase
      .from('ip_subscriptions')
      .select('id, ip, status, plan, created_at, expires_at')
      .eq('user_id', user_id)
      .order('created_at', { ascending: true });

    const ipRecords = (records || []).map(r => ({
      ip: r.ip,
      status: r.status === 'active' && r.expires_at && new Date(r.expires_at) <= new Date() ? 'inactive' : r.status,
      plan: r.plan,
      first_seen: r.created_at,
      last_seen: r.expires_at || r.created_at,
      subscription_id: r.id
    }));

    res.json({ user_id, ip_records: ipRecords });
  } catch (err) {
    console.error('CRM IP history error:', err);
    res.status(500).json({ error: 'Erro ao carregar histórico de IPs: ' + err.message });
  }
});

// =============================================================================
// PROXY LEVE — OpenAI-Compatible Gateway para GhostCLI
// =============================================================================

const GHOSTCLI_BASE_URL = process.env.GHOSTCLI_BASE_URL || 'https://ghostcli.dev/v1';
const GHOSTCLI_API_KEY = process.env.GHOSTCLI_API_KEY || '';

// --- Cache em memória para validação de chaves (TTL 300s) ---
const keyCache = new Map(); // keyHash → { userId, revoked, cachedAt }
const subCache = new Map(); // userId → { ip, additional_ip, has_additional_ip, plan, status, expires_at, cachedAt }
const CACHE_TTL_MS = 5 * 60 * 1000; // 300s — reduz queries ao Supabase em 5×

function getCached(map, key) {
  const entry = map.get(key);
  if (!entry) return null;
  if (Date.now() - entry.cachedAt > CACHE_TTL_MS) { map.delete(key); return null; }
  return entry;
}

function setCached(map, key, value) {
  map.set(key, { ...value, cachedAt: Date.now() });
}

// Invalidar cache (chamado quando admin revoga chave ou muda IP)
function invalidateKeyCache(keyHash) { keyCache.delete(keyHash); }
function invalidateSubCache(userId) { subCache.delete(userId); }
function invalidateAllCache() { keyCache.clear(); subCache.clear(); }

// --- Middleware: validateApiKey ---
// Valida chave 8tk_* + IP binding + plano ativo em cada request ao proxy
async function validateApiKey(req, res, next) {
  try {
    const authHeader = req.headers['authorization'] || '';
    const apiKey = authHeader.replace('Bearer ', '').trim();
    if (!apiKey || !apiKey.startsWith('8tk_')) {
      return res.status(401).json({ error: 'Chave API inválida. Use Authorization: Bearer 8tk_xxx' });
    }

    const keyHash = crypto.createHash('sha256').update(apiKey).digest('hex');

    // 1+2. JOIN único: buscar chave + subscription em 1 query (corta latência pela metade)
    let keyData = getCached(keyCache, keyHash);
    let sub = keyData ? getCached(subCache, keyData.userId) : null;

    if (!keyData || !sub) {
      // Query única com JOIN via PostgREST foreign table
      const { data, error } = await supabase.from('api_keys')
        .select('id, user_id, revoked, ip_subscriptions(ip, additional_ip, has_additional_ip, plan, status, expires_at)')
        .eq('key_hash', keyHash)
        .single();

      if (!data || error) return res.status(401).json({ error: 'Chave API não encontrada' });
      if (data.revoked) return res.status(401).json({ error: 'Chave API revogada' });

      keyData = { id: data.id, userId: data.user_id, revoked: data.revoked };
      setCached(keyCache, keyHash, keyData);

      // Pegar a primeira subscription ativa do array retornado pelo JOIN
      const activeSub = (data.ip_subscriptions || []).find(s => s.status === 'active');
      if (!activeSub) return res.status(403).json({ error: 'Nenhum plano ativo encontrado' });
      sub = activeSub;
      setCached(subCache, keyData.userId, sub);
    }
    if (keyData.revoked) return res.status(401).json({ error: 'Chave API revogada' });

    // 3. Verificar expiração
    if (sub.expires_at && new Date(sub.expires_at) < new Date()) {
      return res.status(403).json({ error: 'Plano expirado. Renove sua assinatura.' });
    }

    // 4. Verificar IP binding
    const clientIp = req.clientIp;
    const allowedIps = [sub.ip];
    if (sub.has_additional_ip && sub.additional_ip) allowedIps.push(sub.additional_ip);
    if (!allowedIps.includes(clientIp)) {
      return res.status(403).json({
        error: `IP não autorizado. Seu IP (${clientIp}) não está vinculado a esta chave. IPs autorizados: ${allowedIps.join(', ')}`
      });
    }

    // 5. Atachar dados ao request
    req.apiKeyUser = { id: keyData.id, user_id: keyData.userId };
    req.subscription = sub;

    // 6. Atualizar last_used_at (async, sem bloquear)
    supabase.from('api_keys').update({ last_used_at: new Date().toISOString() }).eq('id', keyData.id).then(() => {}).catch(() => {});

    next();
  } catch (err) {
    console.error('[validateApiKey] Error:', err);
    res.status(500).json({ error: 'Erro interno na validação' });
  }
}

// --- Tracking de uso ---
async function trackUsage(req, data, latencyMs) {
  try {
    const usage = data.usage || {};
    await supabase.from('usage_logs').insert({
      user_id: req.apiKeyUser.user_id,
      api_key_id: req.apiKeyUser.id,
      model: data.model || req.body?.model || 'unknown',
      tokens_in: usage.prompt_tokens || 0,
      tokens_out: usage.completion_tokens || 0,
      latency_ms: latencyMs || 0, // Usa TTFB real (não inclui tempo do insert)
      ip: req.clientIp,
      status: 'success'
    });
  } catch (e) {
    console.error('[usage] Failed to log:', e.message);
  }
}

// Parsear última chunk SSE para extrair usage em streaming
function parseSseUsage(fullResponse) {
  try {
    const lines = fullResponse.split('\n');
    for (let i = lines.length - 1; i >= 0; i--) {
      const line = lines[i].trim();
      if (line.startsWith('data: ') && line !== 'data: [DONE]') {
        const json = JSON.parse(line.slice(6));
        if (json.usage) return json;
      }
    }
  } catch (e) { /* ignore parse errors */ }
  return null;
}

// --- Proxy routes ---
async function proxyRequest(req, res, path) {
  const startTime = Date.now();
  let ttfb = 0; // Time To First Byte — latência real do upstream
  try {
    const upstream = await fetch(`${GHOSTCLI_BASE_URL}${path}`, {
      method: req.method,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${GHOSTCLI_API_KEY}`,
      },
      body: ['GET', 'HEAD'].includes(req.method) ? undefined : JSON.stringify(req.body),
    });
    ttfb = Date.now() - startTime; // Captura latência real ANTES de qualquer processing

    // Forward status and headers
    res.status(upstream.status);
    upstream.headers.forEach((value, key) => {
      const lk = key.toLowerCase();
      if (!['transfer-encoding', 'connection', 'content-length'].includes(lk)) {
        res.setHeader(key, value);
      }
    });

    if (req.body?.stream && upstream.ok) {
      // Streaming SSE: pipe chunks and capture usage from final chunk
      let fullResponse = '';
      const reader = upstream.body.getReader();
      const decoder = new TextDecoder();

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value, { stream: true });
        fullResponse += chunk;
        res.write(chunk);
      }
      res.end();

      // Track usage fire-and-forget (não bloqueia resposta)
      const sseData = parseSseUsage(fullResponse);
      if (sseData) trackUsage(req, sseData, ttfb).catch(() => {});
    } else {
      // Non-streaming: read full response
      const contentType = upstream.headers.get('content-type') || '';
      if (contentType.includes('application/json')) {
        const data = await upstream.json();
        res.json(data);
        // Track usage fire-and-forget (não bloqueia resposta)
        if (upstream.ok) trackUsage(req, data, ttfb).catch(() => {});
      } else {
        const buffer = Buffer.from(await upstream.arrayBuffer());
        res.send(buffer);
      }
    }
  } catch (err) {
    console.error('[proxy] Error:', err.message);
    if (!res.headersSent) {
      res.status(502).json({ error: 'Erro ao conectar com o provedor upstream' });
    }
  }
}

app.post('/v1/chat/completions', validateApiKey, (req, res) => proxyRequest(req, res, '/chat/completions'));
app.post('/v1/completions', validateApiKey, (req, res) => proxyRequest(req, res, '/completions'));
app.get('/v1/models', validateApiKey, (req, res) => proxyRequest(req, res, '/models'));
app.post('/v1/messages', validateApiKey, (req, res) => proxyRequest(req, res, '/messages'));
app.post('/v1/embeddings', validateApiKey, (req, res) => proxyRequest(req, res, '/embeddings'));

// =============================================================================
// USER: USAGE STATS (métricas de consumo para o dashboard do cliente)
// =============================================================================
app.get('/api/user/usage-stats', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;

    // Totais gerais
    const { data: allLogs } = await supabase.from('usage_logs')
      .select('model, tokens_in, tokens_out, created_at')
      .eq('user_id', userId)
      .order('created_at', { ascending: false });

    const logs = allLogs || [];
    const totalMessages = logs.length;
    const totalTokensIn = logs.reduce((s, l) => s + (l.tokens_in || 0), 0);
    const totalTokensOut = logs.reduce((s, l) => s + (l.tokens_out || 0), 0);

    // Por modelo
    const byModel = {};
    logs.forEach(l => {
      const m = l.model || 'unknown';
      if (!byModel[m]) byModel[m] = { model: m, messages: 0, tokens_in: 0, tokens_out: 0 };
      byModel[m].messages++;
      byModel[m].tokens_in += l.tokens_in || 0;
      byModel[m].tokens_out += l.tokens_out || 0;
    });

    // Últimos 7 dias
    const now = new Date();
    const d7 = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const d30 = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    const last7d = logs.filter(l => new Date(l.created_at) >= d7);
    const last30d = logs.filter(l => new Date(l.created_at) >= d30);

    // Agrupar por dia (últimos 7 dias)
    const dailyMap = {};
    last7d.forEach(l => {
      const day = l.created_at.slice(0, 10);
      if (!dailyMap[day]) dailyMap[day] = { date: day, messages: 0, tokens_in: 0, tokens_out: 0 };
      dailyMap[day].messages++;
      dailyMap[day].tokens_in += l.tokens_in || 0;
      dailyMap[day].tokens_out += l.tokens_out || 0;
    });

    // Hoje
    const todayStr = now.toISOString().slice(0, 10);
    const todayLogs = logs.filter(l => l.created_at.slice(0, 10) === todayStr);
    const todayMessages = todayLogs.length;
    const todayTokens = todayLogs.reduce((s, l) => s + (l.tokens_in || 0) + (l.tokens_out || 0), 0);

    // Latência média
    const { data: latencyData } = await supabase.from('usage_logs')
      .select('latency_ms')
      .eq('user_id', userId)
      .not('latency_ms', 'is', null)
      .order('created_at', { ascending: false })
      .limit(100);
    const avgLatency = (latencyData || []).length > 0
      ? Math.round((latencyData || []).reduce((s, l) => s + (l.latency_ms || 0), 0) / (latencyData || []).length)
      : 0;

    res.json({
      total_messages: totalMessages,
      total_tokens_in: totalTokensIn,
      total_tokens_out: totalTokensOut,
      total_tokens: totalTokensIn + totalTokensOut,
      today_messages: todayMessages,
      today_tokens: todayTokens,
      avg_latency_ms: avgLatency,
      usage_by_model: Object.values(byModel).sort((a, b) => (b.tokens_in + b.tokens_out) - (a.tokens_in + a.tokens_out)),
      usage_last_7d: Object.values(dailyMap).sort((a, b) => a.date.localeCompare(b.date)),
      usage_last_30d_count: last30d.length,
      usage_last_30d_tokens: last30d.reduce((s, l) => s + (l.tokens_in || 0) + (l.tokens_out || 0), 0)
    });
  } catch (err) {
    console.error('Usage stats error:', err);
    res.status(500).json({ error: 'Erro ao carregar métricas: ' + err.message });
  }
});

// =============================================================================
// ADMIN: API KEYS MANAGEMENT (controle total de chaves)
// =============================================================================
app.get('/api/admin/keys', adminAuth, async (req, res) => {
  try {
    const search = (req.query.search || '').trim();
    let query = supabase.from('api_keys')
      .select('*, users(email, name, plan)')
      .order('created_at', { ascending: false });

    const { data, error } = await query;
    if (error) throw error;

    let keys = data || [];
    if (search) {
      const q = search.toLowerCase();
      keys = keys.filter(k =>
        (k.users?.email || '').toLowerCase().includes(q) ||
        (k.users?.name || '').toLowerCase().includes(q) ||
        (k.key_prefix || '').toLowerCase().includes(q) ||
        (k.name || '').toLowerCase().includes(q)
      );
    }

    // Stats
    const activeCount = keys.filter(k => !k.revoked).length;
    const revokedCount = keys.filter(k => k.revoked).length;

    res.json({ keys, stats: { total: keys.length, active: activeCount, revoked: revokedCount } });
  } catch (err) {
    console.error('Admin keys error:', err);
    res.status(500).json({ error: 'Erro ao carregar chaves: ' + err.message });
  }
});

app.put('/api/admin/keys/:id/revoke', adminAuth, async (req, res) => {
  try {
    const { data } = await supabase.from('api_keys').select('key_hash, user_id').eq('id', req.params.id).single();
    if (!data) return res.status(404).json({ error: 'Chave não encontrada' });
    await supabase.from('api_keys').update({ revoked: true }).eq('id', req.params.id);
    invalidateKeyCache(data.key_hash);
    invalidateSubCache(data.user_id);
    res.json({ success: true, message: 'Chave revogada com sucesso' });
  } catch (err) {
    res.status(500).json({ error: 'Erro ao revogar chave: ' + err.message });
  }
});

app.put('/api/admin/keys/:id/restore', adminAuth, async (req, res) => {
  try {
    const { data } = await supabase.from('api_keys').select('key_hash, user_id').eq('id', req.params.id).single();
    if (!data) return res.status(404).json({ error: 'Chave não encontrada' });
    await supabase.from('api_keys').update({ revoked: false }).eq('id', req.params.id);
    invalidateKeyCache(data.key_hash);
    invalidateSubCache(data.user_id);
    res.json({ success: true, message: 'Chave reativada com sucesso' });
  } catch (err) {
    res.status(500).json({ error: 'Erro ao reativar chave: ' + err.message });
  }
});

app.get('/api/admin/keys/:id/usage', adminAuth, async (req, res) => {
  try {
    const { data } = await supabase.from('usage_logs')
      .select('*')
      .eq('api_key_id', req.params.id)
      .order('created_at', { ascending: false })
      .limit(100);
    const logs = data || [];
    const totalTokens = logs.reduce((s, l) => s + (l.tokens_in || 0) + (l.tokens_out || 0), 0);
    res.json({
      logs,
      stats: {
        total_requests: logs.length,
        total_tokens: totalTokens,
        total_tokens_in: logs.reduce((s, l) => s + (l.tokens_in || 0), 0),
        total_tokens_out: logs.reduce((s, l) => s + (l.tokens_out || 0), 0)
      }
    });
  } catch (err) {
    res.status(500).json({ error: 'Erro ao carregar uso da chave: ' + err.message });
  }
});

// Admin: métricas globais de uso
app.get('/api/admin/usage/stats', adminAuth, async (req, res) => {
  try {
    const now = new Date();
    const todayStr = now.toISOString().slice(0, 10);
    const d7 = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const d30 = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();

    const { data: allLogs } = await supabase.from('usage_logs')
      .select('tokens_in, tokens_out, model, created_at, latency_ms')
      .order('created_at', { ascending: false });

    const logs = allLogs || [];
    const todayLogs = logs.filter(l => l.created_at >= todayStr);
    const weekLogs = logs.filter(l => l.created_at >= d7);
    const monthLogs = logs.filter(l => l.created_at >= d30);

    // Por dia (últimos 7 dias)
    const dailyMap = {};
    weekLogs.forEach(l => {
      const day = l.created_at.slice(0, 10);
      if (!dailyMap[day]) dailyMap[day] = { date: day, requests: 0, tokens: 0 };
      dailyMap[day].requests++;
      dailyMap[day].tokens += (l.tokens_in || 0) + (l.tokens_out || 0);
    });

    // Top usuários por consumo
    const { data: topUsersRaw } = await supabase.from('usage_logs')
      .select('user_id, tokens_in, tokens_out, users!inner(email, name)')
      .gte('created_at', d30);

    const userMap = {};
    (topUsersRaw || []).forEach(l => {
      const uid = l.user_id;
      if (!userMap[uid]) userMap[uid] = { email: l.users?.email, name: l.users?.name, tokens: 0, requests: 0 };
      userMap[uid].tokens += (l.tokens_in || 0) + (l.tokens_out || 0);
      userMap[uid].requests++;
    });
    const topUsers = Object.values(userMap).sort((a, b) => b.tokens - a.tokens).slice(0, 10);

    // Latência média
    const latencies = logs.filter(l => l.latency_ms).map(l => l.latency_ms);
    const avgLatency = latencies.length > 0 ? Math.round(latencies.reduce((s, v) => s + v, 0) / latencies.length) : 0;

    res.json({
      total_requests: logs.length,
      total_tokens: logs.reduce((s, l) => s + (l.tokens_in || 0) + (l.tokens_out || 0), 0),
      today_requests: todayLogs.length,
      today_tokens: todayLogs.reduce((s, l) => s + (l.tokens_in || 0) + (l.tokens_out || 0), 0),
      week_requests: weekLogs.length,
      week_tokens: weekLogs.reduce((s, l) => s + (l.tokens_in || 0) + (l.tokens_out || 0), 0),
      month_requests: monthLogs.length,
      month_tokens: monthLogs.reduce((s, l) => s + (l.tokens_in || 0) + (l.tokens_out || 0), 0),
      avg_latency_ms: avgLatency,
      daily_usage: Object.values(dailyMap).sort((a, b) => a.date.localeCompare(b.date)),
      top_users: topUsers
    });
  } catch (err) {
    console.error('Admin usage stats error:', err);
    res.status(500).json({ error: 'Erro ao carregar métricas globais: ' + err.message });
  }
});

// =============================================================================
// STATIC FILE SERVING (para VPS — serve frontend diretamente)
// =============================================================================
const path = require('path');
const publicDir = path.join(__dirname, 'public');

// Serve static files from public/ directory
app.use(express.static(publicDir));

// SPA-style routes for frontend pages
app.get('/account', (req, res) => res.sendFile(path.join(publicDir, 'account.html')));
app.get('/admin', (req, res) => res.sendFile(path.join(publicDir, 'admin.html')));
app.get('/dashboard', (req, res) => res.sendFile(path.join(publicDir, 'dashboard.html')));
app.get('/login', (req, res) => res.sendFile(path.join(publicDir, 'login.html')));
app.get('/docs', (req, res) => res.sendFile(path.join(publicDir, 'docs.html')));
app.get('/affiliate', (req, res) => res.sendFile(path.join(publicDir, 'affiliate.html')));

// Health check
app.get('/api/health', (req, res) => res.json({ status: 'ok', timestamp: new Date().toISOString(), proxy: !!GHOSTCLI_API_KEY }));

// Export for Vercel — @vercel/node expects module.exports = handler(req, res)
// Express app works directly as a handler
module.exports = app;

// Also support local development / VPS with PM2
if (require.main === module) {
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => {
    console.log(`🚀 8Token server running on port ${PORT}`);
    console.log(`📡 Proxy gateway: ${GHOSTCLI_API_KEY ? 'ATIVO' : 'INATIVO (GHOSTCLI_API_KEY não configurada)'}`);
    console.log(`🔗 GhostCLI upstream: ${GHOSTCLI_BASE_URL}`);
  });
}