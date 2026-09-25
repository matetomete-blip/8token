const fs = require('fs');
const vm = require('vm');
const path = '/opt/8token/server.js';
let code = fs.readFileSync(path, 'utf8');
const origLines = code.split('\n').length;
console.log('Original lines:', origLines);

// 1. Add express-session import if not present
if (!code.includes("require('express-session')")) {
  code = code.replace(
    "const rateLimit = require('express-rate-limit');",
    "const rateLimit = require('express-rate-limit');\nconst session = require('express-session');"
  );
  console.log('[1] Added express-session import');
} else {
  console.log('[1] express-session already imported');
}

// 2. Add ADMIN_TOTP_ACCESS_SECRET env var
if (!code.includes('ADMIN_TOTP_ACCESS_SECRET')) {
  code = code.replace(
    "const ADMIN_TOTP_DELETE_SECRET = process.env.ADMIN_TOTP_DELETE_SECRET || '';",
    "const ADMIN_TOTP_DELETE_SECRET = process.env.ADMIN_TOTP_DELETE_SECRET || '';\nconst ADMIN_TOTP_ACCESS_SECRET = process.env.ADMIN_TOTP_ACCESS_SECRET || '';"
  );
  console.log('[2] Added ADMIN_TOTP_ACCESS_SECRET env var');
} else {
  console.log('[2] ADMIN_TOTP_ACCESS_SECRET already present');
}

// 3. Add session middleware configuration after app creation
if (!code.includes('adminSessionSecret')) {
  const sessionConfig = `
// Admin session for TOTP access (30 min expiry)
const adminSessionSecret = crypto.randomBytes(32).toString('hex');
app.use('/api/admin', session({
  secret: adminSessionSecret,
  name: 'admin_session',
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: false, // Set to true in production with HTTPS
    httpOnly: true,
    maxAge: 30 * 60 * 1000, // 30 minutes
    sameSite: 'strict'
  }
}));
`;
  // Insert after app.use(cors()) or similar early middleware
  const corsMatch = code.match(/app\.use\(cors\(\)\);/);
  if (corsMatch) {
    const insertPos = code.indexOf(corsMatch[0]) + corsMatch[0].length;
    code = code.slice(0, insertPos) + '\n' + sessionConfig + code.slice(insertPos);
    console.log('[3] Added session middleware after cors()');
  } else {
    console.error('[3] FAILED: Could not find cors() middleware');
    process.exit(1);
  }
} else {
  console.log('[3] Session middleware already configured');
}

// 4. Add admin login/logout endpoints and modify adminAuth to check session
const adminAccessBlock = `
// --- ADMIN ACCESS via TOTP (replaces ADMIN_SECRET password) ---
app.post('/api/admin/login', async (req, res) => {
  try {
    const { totpToken } = req.body;
    if (!totpToken) return res.status(400).json({ error: 'Código 2FA obrigatório' });
    if (!ADMIN_TOTP_ACCESS_SECRET) return res.status(503).json({ error: '2FA de acesso não configurado no servidor' });
    const result = verifySync({ token: totpToken, secret: ADMIN_TOTP_ACCESS_SECRET });
    if (!result.valid) return res.status(403).json({ error: 'Código 2FA inválido ou expirado' });
    req.session.adminAuthenticated = true;
    req.session.adminAuthTime = Date.now();
    res.json({ success: true, message: 'Autenticado com sucesso', expiresAt: new Date(Date.now() + 30*60*1000).toISOString() });
  } catch(e) {
    console.error('Admin login error:', e);
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/admin/logout', (req, res) => {
  req.session.destroy(err => {
    if (err) return res.status(500).json({ error: 'Erro ao encerrar sessão' });
    res.clearCookie('admin_session');
    res.json({ success: true, message: 'Sessão encerrada' });
  });
});

app.get('/api/admin/session-status', (req, res) => {
  const authenticated = req.session?.adminAuthenticated === true;
  const authTime = req.session?.adminAuthTime || 0;
  const expiresAt = authTime ? new Date(authTime + 30*60*1000).toISOString() : null;
  const remainingMs = authTime ? Math.max(0, (authTime + 30*60*1000) - Date.now()) : 0;
  res.json({
    authenticated,
    expiresAt,
    remainingSeconds: Math.floor(remainingMs / 1000),
    configured: !!ADMIN_TOTP_ACCESS_SECRET
  });
});

// Setup endpoint for admin access 2FA
app.get('/api/admin/access-2fa/setup', adminAuth, async (req, res) => {
  try {
    if (ADMIN_TOTP_ACCESS_SECRET) {
      return res.json({ alreadyConfigured: true, message: '2FA de acesso já está configurado' });
    }
    const secret = generateSecret();
    const label = '8Token Admin Access';
    const otpauthUrl = generateURI({ secret, label, issuer: '8token.tech' });
    const qrDataUrl = await QRCode.toDataURL(otpauthUrl);
    res.json({ secret, qrDataUrl, otpauthUrl });
  } catch(e) {
    console.error('Admin access 2FA setup error:', e);
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/admin/access-2fa/verify-setup', adminAuth, async (req, res) => {
  try {
    const { token, secret } = req.body;
    if (!token || !secret) return res.status(400).json({ error: 'Token e secret obrigatórios' });
    const result = verifySync({ token, secret });
    if (!result.valid) return res.status(403).json({ error: 'Código TOTP inválido' });
    const envPath = '/opt/8token/.env';
    let env = fs.existsSync(envPath) ? fs.readFileSync(envPath,'utf8') : '';
    if (env.includes('ADMIN_TOTP_ACCESS_SECRET=')) {
      env = env.replace(/ADMIN_TOTP_ACCESS_SECRET=.*/, 'ADMIN_TOTP_ACCESS_SECRET='+secret);
    } else {
      env += '\\nADMIN_TOTP_ACCESS_SECRET='+secret+'\\n';
    }
    fs.writeFileSync(envPath, env);
    res.json({ success: true, message: '2FA de acesso salvo. Reinicie o servidor para ativar.' });
  } catch(e) {
    console.error('Admin access 2FA verify error:', e);
    res.status(500).json({ error: e.message });
  }
});
`;

if (!code.includes('/api/admin/login')) {
  // Insert after the existing 2FA status endpoint
  const statusEndpoint = code.indexOf("app.get('/api/admin/2fa/status'");
  if (statusEndpoint >= 0) {
    // Find the end of that endpoint block
    const afterStatus = code.indexOf('});', statusEndpoint);
    if (afterStatus >= 0) {
      const insertPos = afterStatus + 3; // after });
      code = code.slice(0, insertPos) + '\n' + adminAccessBlock + code.slice(insertPos);
      console.log('[4] Added admin access endpoints');
    } else {
      console.error('[4] FAILED: Could not find end of 2fa/status endpoint');
      process.exit(1);
    }
  } else {
    console.error('[4] FAILED: Could not find 2fa/status endpoint');
    process.exit(1);
  }
} else {
  console.log('[4] Admin access endpoints already present');
}

// 5. Modify adminAuth to check session first, then fall back to ADMIN_SECRET for backward compat
const oldAdminAuth = `function adminAuth(req, res, next) {
  const secret = req.headers['x-admin-secret'] || req.query.key;
  if (secret !== ADMIN_SECRET) return res.status(403).json({ error: 'Acesso negado' });
  next();
}`;

const newAdminAuth = `function adminAuth(req, res, next) {
  // Check session-based TOTP authentication first (preferred)
  if (req.session?.adminAuthenticated === true) {
    const authTime = req.session.adminAuthTime || 0;
    const elapsed = Date.now() - authTime;
    if (elapsed < 30 * 60 * 1000) { // 30 minutes
      return next();
    } else {
      // Session expired
      req.session.adminAuthenticated = false;
      return res.status(401).json({ error: 'Sessão expirada. Faça login novamente com 2FA.' });
    }
  }
  // Fallback to ADMIN_SECRET for backward compatibility (API calls, scripts)
  const secret = req.headers['x-admin-secret'] || req.query.key;
  if (secret === ADMIN_SECRET) return next();
  // If neither session nor valid secret, deny
  return res.status(403).json({ error: 'Acesso negado. Use 2FA ou ADMIN_SECRET válido.' });
}`;

if (code.includes(oldAdminAuth)) {
  code = code.replace(oldAdminAuth, newAdminAuth);
  console.log('[5] Updated adminAuth to check session + fallback to ADMIN_SECRET');
} else if (code.includes('function adminAuth') && code.includes('adminAuthenticated')) {
  console.log('[5] adminAuth already updated');
} else {
  console.error('[5] WARNING: Could not find exact adminAuth pattern to replace');
  // Try flexible replacement
  const adminAuthMatch = code.match(/function adminAuth\(req, res, next\) \{[\s\S]*?next\(\);\s*\}/);
  if (adminAuthMatch) {
    code = code.replace(adminAuthMatch[0], newAdminAuth);
    console.log('[5] Updated adminAuth with flexible match');
  } else {
    console.error('[5] FAILED: Could not update adminAuth');
    process.exit(1);
  }
}

// Write the patched file
fs.writeFileSync(path, code);
const finalLines = code.split('\n').length;
console.log('Patch applied. Final lines:', finalLines);

// Verify syntax
try {
  new vm.Script(code, { filename: path });
  console.log('Syntax: OK ✅');
} catch(e) {
  console.error('Syntax ERROR ❌:', e.message);
  process.exit(1);
}

console.log('\\n=== PATCH SUMMARY ===');
console.log('✅ express-session middleware added (30 min cookie)');
console.log('✅ ADMIN_TOTP_ACCESS_SECRET env var added');
console.log('✅ /api/admin/login endpoint (TOTP verification)');
console.log('✅ /api/admin/logout endpoint');
console.log('✅ /api/admin/session-status endpoint');
console.log('✅ /api/admin/access-2fa/setup endpoint');
console.log('✅ /api/admin/access-2fa/verify-setup endpoint');
console.log('✅ adminAuth updated to check session first, fallback to ADMIN_SECRET');
console.log('\\nNext steps:');
console.log('1. Restart PM2: pm2 restart 8token');
console.log('2. Call GET /api/admin/access-2fa/setup with ADMIN_SECRET to get QR code');
console.log('3. Scan QR in Google Authenticator');
console.log('4. Call POST /api/admin/access-2fa/verify-setup with token+secret to save');
console.log('5. Restart PM2 again to load the new secret');
console.log('6. Update admin.html frontend to use /api/admin/login flow');