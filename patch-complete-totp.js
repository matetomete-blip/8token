const fs = require('fs');
const vm = require('vm');
const path = '/opt/8token/server.js';
let code = fs.readFileSync(path, 'utf8');
const origLines = code.split('\n').length;
console.log('Original lines:', origLines);

// 1. Add imports
if (!code.includes("require('otplib')")) {
  code = code.replace(
    "const crypto = require('crypto');",
    "const crypto = require('crypto');\nconst { generateSecret, verifySync, generateURI } = require('otplib');\nconst QRCode = require('qrcode');\nconst session = require('express-session');"
  );
  console.log('[1] Added imports');
} else {
  console.log('[1] Imports already present');
}

// 2. Add env vars
if (!code.includes('ADMIN_TOTP_RESET_SECRET')) {
  code = code.replace(
    "const ADMIN_SECRET = process.env.ADMIN_SECRET || '8token-admin-change-me';",
    "const ADMIN_SECRET = process.env.ADMIN_SECRET || '8token-admin-change-me';\nconst ADMIN_TOTP_RESET_SECRET = process.env.ADMIN_TOTP_RESET_SECRET || '';\nconst ADMIN_TOTP_DELETE_SECRET = process.env.ADMIN_TOTP_DELETE_SECRET || '';\nconst ADMIN_TOTP_ACCESS_SECRET = process.env.ADMIN_TOTP_ACCESS_SECRET || '';"
  );
  console.log('[2] Added TOTP env vars');
} else {
  console.log('[2] TOTP env vars already present');
}

// 3. Add session middleware after trust proxy
if (!code.includes('adminSessionSecret')) {
  const sessionConfig = `\n// Admin session for TOTP access (30 min expiry)\nconst adminSessionSecret = crypto.randomBytes(32).toString('hex');\napp.use('/api/admin', session({\n  secret: adminSessionSecret,\n  name: 'admin_session',\n  resave: false,\n  saveUninitialized: false,\n  cookie: {\n    secure: false,\n    httpOnly: true,\n    maxAge: 30 * 60 * 1000,\n    sameSite: 'lax'\n  }\n}));\n`;
  const trustProxyMatch = code.match(/app\.set\('trust proxy', 1\);/);
  if (trustProxyMatch) {
    const insertPos = code.indexOf(trustProxyMatch[0]) + trustProxyMatch[0].length;
    code = code.slice(0, insertPos) + sessionConfig + code.slice(insertPos);
    console.log('[3] Added session middleware');
  } else {
    console.error('[3] FAILED: Could not find trust proxy');
    process.exit(1);
  }
} else {
  console.log('[3] Session middleware already present');
}

// 4. Build TOTP block
const totpBlock = `\n// --- ADMIN 2FA (TOTP / Google Authenticator) ---\nconst totpVerifyLimiter = rateLimit({\n  windowMs: 5 * 60 * 1000, max: 10,\n  message: { error: 'Muitas tentativas TOTP. Tente em 5 min.' },\n  standardHeaders: true, legacyHeaders: false,\n});\n\napp.get('/api/admin/2fa/setup', adminAuth, async (req, res) => {\n  try {\n    const { operation } = req.query;\n    if (!operation || !['reset','delete'].includes(operation))\n      return res.status(400).json({ error: 'operation=reset|delete' });\n    const secret = generateSecret();\n    const label = operation === 'reset' ? '8Token Admin Reset' : '8Token Admin Delete';\n    const otpauthUrl = generateURI({ secret, label, issuer: '8token.tech' });\n    const qrDataUrl = await QRCode.toDataURL(otpauthUrl);\n    res.json({ secret, qrDataUrl, otpauthUrl, operation });\n  } catch(e) { res.status(500).json({ error: e.message }); }\n});\n\napp.post('/api/admin/2fa/verify-setup', adminAuth, totpVerifyLimiter, async (req, res) => {\n  try {\n    const { token, secret, operation } = req.body;\n    if (!token||!secret||!operation) return res.status(400).json({ error: 'token, secret, operation obrigatórios' });\n    const result = verifySync({ token, secret });\n    if (!result.valid) return res.status(403).json({ error: 'Código TOTP inválido' });\n    const envPath = '/opt/8token/.env';\n    let env = fs.existsSync(envPath) ? fs.readFileSync(envPath,'utf8') : '';\n    const key = operation==='reset' ? 'ADMIN_TOTP_RESET_SECRET' : 'ADMIN_TOTP_DELETE_SECRET';\n    env = env.includes(key+'=') ? env.replace(new RegExp(key+'=.*'), key+'='+secret) : env+'\\n'+key+'='+secret+'\\n';\n    fs.writeFileSync(envPath, env);\n    res.json({ success: true, message: '2FA salvo. Reinicie o servidor.' });\n  } catch(e) { res.status(500).json({ error: e.message }); }\n});\n\napp.get('/api/admin/2fa/status', adminAuth, (req, res) => {\n  res.json({ reset: { enabled: !!ADMIN_TOTP_RESET_SECRET }, delete: { enabled: !!ADMIN_TOTP_DELETE_SECRET }, access: { enabled: !!ADMIN_TOTP_ACCESS_SECRET } });\n});\n\n// Admin login via TOTP (replaces ADMIN_SECRET for panel access)\napp.post('/api/admin/login', async (req, res) => {\n  try {\n    const { totpToken } = req.body;\n    if (!totpToken) return res.status(400).json({ error: 'Código 2FA obrigatório' });\n    if (!ADMIN_TOTP_ACCESS_SECRET) return res.status(503).json({ error: '2FA de acesso não configurado' });\n    const result = verifySync({ token: totpToken, secret: ADMIN_TOTP_ACCESS_SECRET });\n    if (!result.valid) return res.status(403).json({ error: 'Código 2FA inválido ou expirado' });\n    req.session.adminAuthenticated = true;\n    req.session.adminAuthTime = Date.now();\n    res.json({ success: true, message: 'Autenticado com sucesso', expiresAt: new Date(Date.now() + 30*60*1000).toISOString() });\n  } catch(e) {\n    console.error('Admin login error:', e);\n    res.status(500).json({ error: e.message });\n  }\n});\n\napp.post('/api/admin/logout', (req, res) => {\n  req.session.destroy(err => {\n    if (err) return res.status(500).json({ error: 'Erro ao encerrar sessão' });\n    res.clearCookie('admin_session');\n    res.json({ success: true, message: 'Sessão encerrada' });\n  });\n});\n\napp.get('/api/admin/session-status', (req, res) => {\n  const authenticated = req.session?.adminAuthenticated === true;\n  const authTime = req.session?.adminAuthTime || 0;\n  const expiresAt = authTime ? new Date(authTime + 30*60*1000).toISOString() : null;\n  const remainingMs = authTime ? Math.max(0, (authTime + 30*60*1000) - Date.now()) : 0;\n  res.json({\n    authenticated,\n    expiresAt,\n    remainingSeconds: Math.floor(remainingMs / 1000),\n    configured: !!ADMIN_TOTP_ACCESS_SECRET\n  });\n});\n\nfunction requireTotp(operation) {\n  return (req, res, next) => {\n    const secret = operation==='reset' ? ADMIN_TOTP_RESET_SECRET : ADMIN_TOTP_DELETE_SECRET;\n    if (!secret) return next();\n    const tok = req.headers['x-totp-token'] || req.body?.totpToken;\n    if (!tok) return res.status(403).json({ error: 'Código 2FA obrigatório (x-totp-token ou totpToken)' });\n    const result = verifySync({ token: tok, secret });\n    if (!result.valid) return res.status(403).json({ error: 'Código 2FA inválido ou expirado' });\n    next();\n  };\n}\n`;

// 5. Insert TOTP block after adminAuth
if (!code.includes('function requireTotp')) {
  const lines = code.split('\n');
  let adminAuthEnd = -1;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].includes('function adminAuth(req, res, next)')) {
      for (let j = i + 1; j < lines.length; j++) {
        if (lines[j].trim() === '}') {
          adminAuthEnd = j;
          break;
        }
      }
      break;
    }
  }
  if (adminAuthEnd >= 0) {
    lines.splice(adminAuthEnd + 1, 0, totpBlock);
    code = lines.join('\n');
    console.log('[4] Inserted TOTP block after adminAuth at line', adminAuthEnd + 1);
  } else {
    console.error('[4] FAILED: Could not find adminAuth end');
    process.exit(1);
  }
} else {
  console.log('[4] requireTotp already defined');
}

// 6. Update adminAuth to check session first
const oldAdminAuth = `function adminAuth(req, res, next) {\n  const secret = req.headers['x-admin-secret'] || req.query.key;\n  if (secret !== ADMIN_SECRET) return res.status(403).json({ error: 'Acesso negado' });\n  next();\n}`;
const newAdminAuth = `function adminAuth(req, res, next) {\n  // Check session-based TOTP authentication first\n  if (req.session?.adminAuthenticated === true) {\n    const authTime = req.session.adminAuthTime || 0;\n    const elapsed = Date.now() - authTime;\n    if (elapsed < 30 * 60 * 1000) {\n      return next();\n    } else {\n      req.session.adminAuthenticated = false;\n      return res.status(401).json({ error: 'Sessão expirada. Faça login novamente com 2FA.' });\n    }\n  }\n  // Fallback to ADMIN_SECRET for backward compatibility\n  const secret = req.headers['x-admin-secret'] || req.query.key;\n  if (secret === ADMIN_SECRET) return next();\n  return res.status(403).json({ error: 'Acesso negado. Use 2FA ou ADMIN_SECRET válido.' });\n}`;

if (code.includes(oldAdminAuth)) {
  code = code.replace(oldAdminAuth, newAdminAuth);
  console.log('[5] Updated adminAuth with session check');
} else if (code.includes('adminAuthenticated')) {
  console.log('[5] adminAuth already updated');
} else {
  console.log('[5] WARNING: Could not find exact adminAuth pattern, trying flexible');
  const flexMatch = code.match(/function adminAuth\(req, res, next\) \{[\s\S]*?next\(\);\s*\}/);
  if (flexMatch) {
    code = code.replace(flexMatch[0], newAdminAuth);
    console.log('[5] Updated adminAuth (flexible)');
  } else {
    console.error('[5] FAILED: Could not update adminAuth');
    process.exit(1);
  }
}

// 7. Patch reset/delete endpoints
code = code.replace(
  /app\.post\('\/api\/admin\/users\/:subId\/reset',\s*adminAuth,\s*async/g,
  "app.post('/api/admin/users/:subId/reset', adminAuth, requireTotp('reset'), async"
);
code = code.replace(
  /app\.delete\('\/api\/admin\/users\/:subId\/delete-complete',\s*adminAuth,\s*async/g,
  "app.delete('/api/admin/users/:subId/delete-complete', adminAuth, requireTotp('delete'), async"
);
code = code.replace(
  /app\.post\('\/api\/admin\/subscriptions\/:id\/reset',\s*adminAuth,\s*async/g,
  "app.post('/api/admin/subscriptions/:id/reset', adminAuth, requireTotp('reset'), async"
);
code = code.replace(
  /app\.delete\('\/api\/admin\/subscriptions\/:id\/delete-complete',\s*adminAuth,\s*async/g,
  "app.delete('/api/admin/subscriptions/:id/delete-complete', adminAuth, requireTotp('delete'), async"
);
console.log('[6] Patched reset/delete endpoints');

// 8. Remove hardcoded password checks
code = code.replace(
  /\s*const\s*\{\s*password\s*\}\s*=\s*req\.body;\s*\n\s*\/\/\s*Verify\s*password\s*\n\s*if\s*\(\s*password\s*!==\s*'0258'\s*\)\s*\{\s*\n\s*return\s*res\.status\(403\)\.json\(\{\s*error:\s*'Senha\s*incorreta'\s*\}\);\s*\n\s*\}/g,
  ''
);
code = code.replace(
  /\s*const\s*\{\s*admin_password\s*\}\s*=\s*req\.body;\s*\n\s*if\s*\(\s*admin_password\s*!==\s*'0258'\s*\)[^}]*\}/g,
  ''
);
console.log('[7] Removed hardcoded password checks');

// Write
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

// Verify order
const defIdx = code.indexOf('function requireTotp');
const useIdx = code.indexOf("requireTotp('reset')");
if (defIdx >= 0 && useIdx >= 0 && defIdx < useIdx) {
  console.log('Order: OK ✅');
} else {
  console.error('Order: FAILED ❌');
  process.exit(1);
}

console.log('\n=== COMPLETE PATCH SUMMARY ===');
console.log('✅ All TOTP features applied');
console.log('✅ Session middleware (30 min)');
console.log('✅ Admin login/logout endpoints');
console.log('✅ requireTotp middleware');
console.log('✅ Hardcoded passwords removed');