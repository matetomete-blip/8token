require('dotenv').config();
const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { createClient } = require('@supabase/supabase-js');
const { OAuth2Client } = require('google-auth-library');
const crypto = require('crypto');

const app = express();
const JWT_SECRET = process.env.JWT_SECRET || '8token-secret-key-change-in-production-' + crypto.randomBytes(16).toString('hex');
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || '';
const ADMIN_SECRET = process.env.ADMIN_SECRET || '8token-admin-change-me';

// Supabase client
const supabaseUrl = process.env.SUPABASE_URL || 'https://wbkmaeqkypqrkawumdjw.supabase.co';
const supabaseKey = process.env.SUPABASE_KEY || process.env.service_role || '';
const supabase = createClient(supabaseUrl, supabaseKey);

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

function resolvePlanFromKirvano(products) {
  if (!products || !products.length) return null;
  for (const p of products) {
    if (p.id && KIRVANO_PRODUCT_MAP[p.id]) return KIRVANO_PRODUCT_MAP[p.id];
    if (p.offer_id && KIRVANO_PRODUCT_MAP[p.offer_id]) return KIRVANO_PRODUCT_MAP[p.offer_id];
  }
  for (const p of products) {
    const name = (p.name || '').toLowerCase();
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

    // Also check Supabase Auth
    const { data: existingAuth } = await supabase.auth.admin.getUserByEmail(email).catch(() => ({ data: null }));
    if (existingAuth && existingAuth.user) return res.status(409).json({ error: 'Email já cadastrado' });

    const displayName = name || email.split('@')[0];
    const passwordHash = await bcrypt.hash(password, 12);

    // Create in Supabase Auth first (so signInWithPassword works)
    const { data: authData, error: authError } = await supabase.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { name: displayName }
    });

    let userId;
    if (authData && authData.user) {
      userId = authData.user.id;
    } else {
      // Fallback: generate UUID if auth creation fails
      userId = crypto.randomUUID();
    }

    // Create in custom users table
    const plan = email === 'matetomete@gmail.com' ? 'admin' : 'free';
    const { data: newUser, error } = await supabase.from('users').insert({
      id: userId,
      email,
      password_hash: passwordHash,
      name: displayName,
      plan
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

    // If not found in custom table, try Supabase Auth (auth.users) and sync
    if (!user) {
      const { data: authUser, error: authErr } = await supabase.auth.admin.getUserByEmail(email).catch(() => ({ data: null, error: null }));
      if (authUser && authUser.user) {
        // User exists in Supabase Auth but not in custom table — create record
        const au = authUser.user;
        const { data: newUser } = await supabase.from('users').insert({
          id: au.id,
          email: au.email,
          name: au.user_metadata?.name || au.user_metadata?.full_name || email.split('@')[0],
          google_id: au.identities?.[0]?.provider === 'google' ? au.identities[0].id : null,
          avatar_url: au.user_metadata?.avatar_url || au.user_metadata?.picture || null,
          plan: email === 'matetomete@gmail.com' ? 'admin' : 'free'
        }).select().single();
        user = newUser;
      }
    }

    if (!user) return res.status(401).json({ error: 'Email ou senha incorretos' });

    // If user has password_hash, verify it
    if (user.password_hash) {
      const valid = await bcrypt.compare(password, user.password_hash);
      if (!valid) return res.status(401).json({ error: 'Email ou senha incorretos' });
    } else {
      // User was created via Supabase Auth — verify via signInWithPassword
      const { error: signInErr } = await supabase.auth.signInWithPassword({ email, password });
      if (signInErr) return res.status(401).json({ error: 'Email ou senha incorretos' });
      // Store password hash for future logins via custom table
      const passwordHash = await bcrypt.hash(password, 12);
      await supabase.from('users').update({ password_hash: passwordHash }).eq('id', user.id);
    }

    // Auto-promote matetomete@gmail.com to admin
    if (email === 'matetomete@gmail.com' && user.plan !== 'admin') {
      await supabase.from('users').update({ plan: 'admin' }).eq('id', user.id);
      user.plan = 'admin';
    }

    const token = jwt.sign({ id: user.id, email: user.email }, JWT_SECRET, { expiresIn: '30d' });
    await ensureIpRecord(req.clientIp, user.id);
    res.json({ token, user: { id: user.id, email: user.email, name: user.name, plan: user.plan } });
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

    const token = jwt.sign({ id: user.id, email: user.email }, JWT_SECRET, { expiresIn: '30d' });
    await ensureIpRecord(req.clientIp, user.id);
    res.json({ token, user: { id: user.id, email: user.email, name: user.name || name, plan: user.plan } });
  } catch (err) {
    console.error('Google auth error:', err);
    res.status(500).json({ error: 'Erro na autenticação com Google' });
  }
});

// --- USER ROUTES ---

app.get('/api/user/profile', authenticateToken, async (req, res) => {
  const { data: user } = await supabase.from('users').select('id, email, name, plan, plan_expires_at, avatar_url, created_at').eq('id', req.user.id).single();
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
  const { data } = await supabase.from('api_keys').select('id, name, key_prefix, key_suffix, created_at, last_used_at, revoked').eq('user_id', req.user.id).order('created_at', { ascending: false });
  res.json(data || []);
});

app.post('/api/keys', authenticateToken, async (req, res) => {
  const { name } = req.body;
  const apiKey = generateApiKey();
  const keyHash = crypto.createHash('sha256').update(apiKey).digest('hex');
  const prefix = apiKey.slice(0, 8);
  const suffix = apiKey.slice(-4);
  const { data } = await supabase.from('api_keys').insert({ user_id: req.user.id, name: name || 'Nova chave', key_hash: keyHash, key_prefix: prefix, key_suffix: suffix }).select().single();
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
  const authHeader = req.headers['authorization'] || req.headers['x-webhook-token'] || '';
  const token = authHeader.replace('Bearer ', '').trim();
  if (KIRVANO_WEBHOOK_TOKEN && token !== KIRVANO_WEBHOOK_TOKEN) return res.status(401).json({ error: 'Unauthorized' });

  const payload = req.body;
  const event = payload.event;
  console.log(`[Kirvano Webhook] ${event} | sale_id: ${payload.sale_id}`);

  await supabase.from('webhook_logs').insert({ event_type: event, sale_id: payload.sale_id || null, payload: JSON.stringify(payload) });

  if (event === 'SALE_APPROVED') {
    const customerEmail = payload.customer?.email;
    const plan = resolvePlanFromKirvano(payload.products);
    if (!customerEmail || !plan) return res.json({ received: true, warning: 'Missing data' });

    const { data: user } = await supabase.from('users').select('id').eq('email', customerEmail).single();
    if (!user) return res.json({ received: true, warning: 'User not found' });

    const expiresAt = new Date(Date.now() + (PLAN_EXPIRY_MS[plan] || 30 * 24 * 60 * 60 * 1000)).toISOString();
    await supabase.from('users').update({ plan, plan_expires_at: expiresAt }).eq('id', user.id);

    const { data: sub } = await supabase.from('ip_subscriptions').select('id').eq('user_id', user.id).eq('status', 'active').single();
    if (sub) {
      await supabase.from('ip_subscriptions').update({ plan, status: 'active', expires_at: expiresAt }).eq('id', sub.id);
    }

    // Create activation request
    const apiKey = generateApiKey();
    await supabase.from('ip_activation_requests').insert({
      user_id: user.id, ip: req.clientIp, plan, status: 'pending', api_key: apiKey,
      gateway_url: `https://api.8token.com/v1`, kirvano_sale_id: payload.sale_id
    });

    await supabase.from('invoices').update({ status: 'paid', paid_at: new Date().toISOString() }).eq('user_id', user.id).eq('plan', plan).eq('status', 'pending');
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
  if (sub.plan === 'admin' || sub.plan === 'free') return res.status(400).json({ error: 'Planos admin/free não podem comprar IP adicional.' });
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
  res.json({ success: true, message: 'Solicitação enviada. Aguarde aprovação.' });
});

app.get('/api/user/ip-info', authenticateToken, async (req, res) => {
  const { data: sub } = await supabase.from('ip_subscriptions').select('ip, additional_ip, has_additional_ip, plan, status, expires_at').eq('user_id', req.user.id).eq('status', 'active').single();
  if (!sub) return res.json({ ip: null, additional_ip: null, has_additional_ip: false, plan: null });
  const { data: pending } = await supabase.from('ip_change_requests').select('new_ip, created_at').eq('user_id', req.user.id).eq('status', 'pending').single();
  res.json({ ...sub, has_additional_ip: !!sub.has_additional_ip, pending_ip_change: pending ? { new_ip: pending.new_ip, requested_at: pending.created_at } : null });
});

// --- ADMIN ROUTES ---
app.get('/api/admin/stats', adminAuth, async (req, res) => {
  const { count: totalIps } = await supabase.from('ip_subscriptions').select('*', { count: 'exact', head: true });
  const { count: activeIps } = await supabase.from('ip_subscriptions').select('*', { count: 'exact', head: true }).eq('status', 'active');
  const { count: paidPlans } = await supabase.from('ip_subscriptions').select('*', { count: 'exact', head: true }).neq('plan', 'free').eq('status', 'active');
  const { data: planBreakdown } = await supabase.rpc('get_plan_breakdown').catch(() => ({ data: [] }));
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
  const { data: existing } = await supabase.from('ip_subscriptions').select('id').eq('ip', ip).single();
  if (existing) return res.status(409).json({ error: 'IP já existe' });
  const { data } = await supabase.from('ip_subscriptions').insert({ ip, user_id, plan: plan || 'free', status: status || 'active', notes, expires_at }).select().single();
  res.json(data);
});

app.put('/api/admin/subscriptions/:id', adminAuth, async (req, res) => {
  const { plan, status, notes, expires_at, ip } = req.body;
  const update = {};
  if (plan !== undefined) update.plan = plan;
  if (status !== undefined) update.status = status;
  if (notes !== undefined) update.notes = notes;
  if (expires_at !== undefined) update.expires_at = expires_at;
  if (ip !== undefined) update.ip = ip;
  await supabase.from('ip_subscriptions').update(update).eq('id', req.params.id);
  res.json({ success: true });
});

app.delete('/api/admin/subscriptions/:id', adminAuth, async (req, res) => {
  await supabase.from('ip_subscriptions').delete().eq('id', req.params.id);
  res.json({ success: true });
});

// --- ADMIN: IP VALIDATION (Hermes API) ---
app.post('/api/admin/ips/validate', adminAuth, async (req, res) => {
  const { ip, status = 'active', plan = 'mensal', expires_at } = req.body;
  if (!ip) return res.status(400).json({ error: 'IP é obrigatório' });
  
  const { data: sub } = await supabase.from('ip_subscriptions').select('*').eq('ip', ip).single();
  if (sub) {
    const update = { status };
    if (plan) update.plan = plan;
    if (expires_at) update.expires_at = expires_at;
    await supabase.from('ip_subscriptions').update(update).eq('ip', ip);
  } else {
    const expiresAt = expires_at || new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
    await supabase.from('ip_subscriptions').insert({ ip, status, plan, expires_at: expiresAt });
  }
  res.json({ success: true, ip, status, plan });
});

app.post('/api/admin/ips/invalidate', adminAuth, async (req, res) => {
  const { ip } = req.body;
  if (!ip) return res.status(400).json({ error: 'IP é obrigatório' });
  await supabase.from('ip_subscriptions').update({ status: 'suspended' }).eq('ip', ip);
  res.json({ success: true, ip, status: 'suspended' });
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
      ip: '127.0.0.1', 
      user_id: adminUser.id, 
      plan: 'admin', 
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
  res.json({ success: true });
});

app.post('/api/admin/ip-changes/:id/reject', adminAuth, async (req, res) => {
  const { notes } = req.body;
  const { data: changeReq } = await supabase.from('ip_change_requests').select('*').eq('id', req.params.id).single();
  if (!changeReq) return res.status(404).json({ error: 'Não encontrada' });
  await supabase.from('ip_change_requests').update({ status: 'rejected', notes, resolved_at: new Date().toISOString() }).eq('id', req.params.id);
  await supabase.from('notifications').insert({ user_id: changeReq.user_id, title: 'Alteração de IP Recusada', message: `Sua solicitação foi recusada.${notes ? ' Motivo: ' + notes : ''}`, type: 'error' });
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

    // 1. Promote matetomete@gmail.com to admin in custom table
    const { data: adminUser } = await supabase.from('users').select('*').eq('email', 'matetomete@gmail.com').single();
    if (adminUser) {
      await supabase.from('users').update({ plan: 'admin' }).eq('id', adminUser.id);
      results.push({ action: 'promote-admin', email: 'matetomete@gmail.com', status: 'updated', id: adminUser.id });
    } else {
      // Try to sync from Supabase Auth
      const { data: authData } = await supabase.auth.admin.getUserByEmail('matetomete@gmail.com').catch(() => ({ data: null }));
      if (authData && authData.user) {
        const au = authData.user;
        const { data: newUser } = await supabase.from('users').insert({
          id: au.id, email: au.email, name: 'Admin', plan: 'admin'
        }).select().single();
        results.push({ action: 'promote-admin', email: 'matetomete@gmail.com', status: 'created-from-auth', id: newUser?.id });
      } else {
        results.push({ action: 'promote-admin', email: 'matetomete@gmail.com', status: 'not-found' });
      }
    }

    // 2. Create 5 test accounts
    const testAccounts = [
      { email: 'admin@test.8token.com', password: 'admin123', name: 'Admin Teste', plan: 'admin', ip: '127.0.0.1', ipStatus: 'active', ipPlan: 'admin' },
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

// Health check
app.get('/api/health', (req, res) => res.json({ status: 'ok', timestamp: new Date().toISOString() }));

// Export for Vercel — @vercel/node expects module.exports = handler(req, res)
// Express app works directly as a handler
module.exports = app;

// Also support local development
if (require.main === module) {
  const PORT = process.env.PORT || 3001;
  app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
}