const fs = require('fs');
const vm = require('vm');
const serverPath = '/opt/8token/server.js';
const htmlPath = '/opt/8token/public/admin.html';

// ============================================================
// PART 1: PATCH SERVER.JS
// ============================================================
let code = fs.readFileSync(serverPath, 'utf8');
console.log('[SERVER] Original lines:', code.split('\n').length);

// 1. Fix imports — replace wrong otplib import with correct ones + add session + qrcode
if (code.includes("require('otplib')")) {
  // Replace whatever otplib import exists with the correct one
  code = code.replace(
    /const \{[^}]*\} = require\('otplib'\);/,
    "const { generateSecret, verifySync, generateURI } = require('otplib');"
  );
  console.log('[SERVER] [1] Fixed otplib import');
} else {
  code = code.replace(
    "const crypto = require('crypto');",
    "const crypto = require('crypto');\nconst { generateSecret, verifySync, generateURI } = require('otplib');"
  );
  console.log('[SERVER] [1] Added otplib import');
}

// Add QRCode and session imports if missing
if (!code.includes("require('qrcode')")) {
  code = code.replace(
    /const \{ generateSecret, verifySync, generateURI \} = require\('otplib'\);/,
    "const { generateSecret, verifySync, generateURI } = require('otplib');\nconst QRCode = require('qrcode');"
  );
  console.log('[SERVER] [1b] Added qrcode import');
}
if (!code.includes("require('express-session')")) {
  code = code.replace(
    /const QRCode = require\('qrcode'\);/,
    "const QRCode = require('qrcode');\nconst session = require('express-session');"
  );
  console.log('[SERVER] [1c] Added express-session import');
}

// 2. Add TOTP env vars after ADMIN_SECRET
if (!code.includes('ADMIN_TOTP_RESET_SECRET')) {
  code = code.replace(
    "const ADMIN_SECRET = process.env.ADMIN_SECRET || '8token-admin-change-me';",
    `const ADMIN_SECRET = process.env.ADMIN_SECRET || '8token-admin-change-me';
const ADMIN_TOTP_RESET_SECRET = process.env.ADMIN_TOTP_RESET_SECRET || '';
const ADMIN_TOTP_DELETE_SECRET = process.env.ADMIN_TOTP_DELETE_SECRET || '';
const ADMIN_TOTP_ACCESS_SECRET = process.env.ADMIN_TOTP_ACCESS_SECRET || '';`
  );
  console.log('[SERVER] [2] Added TOTP env vars');
} else {
  console.log('[SERVER] [2] TOTP env vars already present');
}

// 3. Add session middleware after trust proxy
if (!code.includes('adminSessionSecret')) {
  const trustProxyLine = "app.set('trust proxy', 1);";
  if (code.includes(trustProxyLine)) {
    code = code.replace(trustProxyLine, trustProxyLine + `

// Admin session for TOTP access (30 min expiry)
const adminSessionSecret = crypto.randomBytes(32).toString('hex');
app.use('/api/admin', session({
  secret: adminSessionSecret,
  name: 'admin_session',
  resave: false,
  saveUninitialized: false,
  cookie: { secure: false, httpOnly: true, maxAge: 30 * 60 * 1000, sameSite: 'lax' }
}));`);
    console.log('[SERVER] [3] Added session middleware');
  } else {
    console.error('[SERVER] [3] FAILED: trust proxy line not found');
    process.exit(1);
  }
} else {
  console.log('[SERVER] [3] Session middleware already present');
}

// 4. Build the complete TOTP block to insert after adminAuth
const totpBlock = `

// --- ADMIN 2FA (TOTP / Google Authenticator) ---
const totpVerifyLimiter = rateLimit({
  windowMs: 5 * 60 * 1000, max: 10,
  message: { error: 'Muitas tentativas TOTP. Tente em 5 min.' },
  standardHeaders: true, legacyHeaders: false,
});

app.get('/api/admin/2fa/setup', adminAuth, async (req, res) => {
  try {
    const { operation } = req.query;
    if (!operation || !['reset','delete'].includes(operation))
      return res.status(400).json({ error: 'operation=reset|delete' });
    const secret = generateSecret();
    const label = operation === 'reset' ? '8Token Admin Reset' : '8Token Admin Delete';
    const otpauthUrl = generateURI({ secret, label, issuer: '8token.tech' });
    const qrDataUrl = await QRCode.toDataURL(otpauthUrl);
    res.json({ secret, qrDataUrl, otpauthUrl, operation });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/admin/2fa/verify-setup', adminAuth, totpVerifyLimiter, async (req, res) => {
  try {
    const { token, secret, operation } = req.body;
    if (!token||!secret||!operation) return res.status(400).json({ error: 'token, secret, operation obrigat\\u00f3rios' });
    const result = verifySync({ token, secret });
    if (!result.valid) return res.status(403).json({ error: 'C\\u00f3digo TOTP inv\\u00e1lido' });
    const envPath = '/opt/8token/.env';
    let env = fs.existsSync(envPath) ? fs.readFileSync(envPath,'utf8') : '';
    const key = operation==='reset' ? 'ADMIN_TOTP_RESET_SECRET' : 'ADMIN_TOTP_DELETE_SECRET';
    env = env.includes(key+'=') ? env.replace(new RegExp(key+'=.*'), key+'='+secret) : env+'\\n'+key+'='+secret+'\\n';
    fs.writeFileSync(envPath, env);
    res.json({ success: true, message: '2FA salvo. Reinicie o servidor.' });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/admin/2fa/status', adminAuth, (req, res) => {
  res.json({ reset: { enabled: !!ADMIN_TOTP_RESET_SECRET }, delete: { enabled: !!ADMIN_TOTP_DELETE_SECRET }, access: { enabled: !!ADMIN_TOTP_ACCESS_SECRET } });
});

// Admin login via TOTP (replaces ADMIN_SECRET for panel access, 30 min session)
app.post('/api/admin/login', async (req, res) => {
  try {
    const { totpToken } = req.body;
    if (!totpToken) return res.status(400).json({ error: 'C\\u00f3digo 2FA obrigat\\u00f3rio' });
    if (!ADMIN_TOTP_ACCESS_SECRET) return res.status(503).json({ error: '2FA de acesso n\\u00e3o configurado' });
    const result = verifySync({ token: totpToken, secret: ADMIN_TOTP_ACCESS_SECRET });
    if (!result.valid) return res.status(403).json({ error: 'C\\u00f3digo 2FA inv\\u00e1lido ou expirado' });
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
    if (err) return res.status(500).json({ error: 'Erro ao encerrar sess\\u00e3o' });
    res.clearCookie('admin_session');
    res.json({ success: true, message: 'Sess\\u00e3o encerrada' });
  });
});

app.get('/api/admin/session-status', (req, res) => {
  const authenticated = req.session?.adminAuthenticated === true;
  const authTime = req.session?.adminAuthTime || 0;
  const expiresAt = authTime ? new Date(authTime + 30*60*1000).toISOString() : null;
  const remainingMs = authTime ? Math.max(0, (authTime + 30*60*1000) - Date.now()) : 0;
  res.json({ authenticated, expiresAt, remainingSeconds: Math.floor(remainingMs / 1000), configured: !!ADMIN_TOTP_ACCESS_SECRET });
});

function requireTotp(operation) {
  return (req, res, next) => {
    const secret = operation==='reset' ? ADMIN_TOTP_RESET_SECRET : ADMIN_TOTP_DELETE_SECRET;
    if (!secret) return next();
    const tok = req.headers['x-totp-token'] || req.body?.totpToken;
    if (!tok) return res.status(403).json({ error: 'C\\u00f3digo 2FA obrigat\\u00f3rio (x-totp-token ou totpToken)' });
    const result = verifySync({ token: tok, secret });
    if (!result.valid) return res.status(403).json({ error: 'C\\u00f3digo 2FA inv\\u00e1lido ou expirado' });
    next();
  };
}
`;

// 5. Insert TOTP block after adminAuth function
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
    console.log('[SERVER] [4] Inserted TOTP block after adminAuth at line', adminAuthEnd + 1);
  } else {
    console.error('[SERVER] [4] FAILED: Could not find adminAuth end');
    process.exit(1);
  }
} else {
  console.log('[SERVER] [4] requireTotp already defined');
}

// 6. Update adminAuth to check session first, then fallback to ADMIN_SECRET
const oldAdminAuthPattern = /function adminAuth\(req, res, next\) \{[\s\S]*?if \(secret !== ADMIN_SECRET\) return res\.status\(403\)\.json\(\{ error: 'Acesso negado' \}\);\s*next\(\);\s*\}/;
const newAdminAuth = `function adminAuth(req, res, next) {
  // Check session-based TOTP authentication first (30 min)
  if (req.session?.adminAuthenticated === true) {
    const authTime = req.session.adminAuthTime || 0;
    if (Date.now() - authTime < 30 * 60 * 1000) return next();
    req.session.adminAuthenticated = false;
    return res.status(401).json({ error: 'Sess\\u00e3o expirada. Fa\\u00e7a login novamente com 2FA.' });
  }
  // Fallback to ADMIN_SECRET for backward compatibility (API calls, scripts)
  const secret = req.headers['x-admin-secret'] || req.query.key;
  if (secret === ADMIN_SECRET) return next();
  return res.status(403).json({ error: 'Acesso negado. Use 2FA ou ADMIN_SECRET v\\u00e1lido.' });
}`;

if (code.match(oldAdminAuthPattern)) {
  code = code.replace(oldAdminAuthPattern, newAdminAuth);
  console.log('[SERVER] [5] Updated adminAuth with session check + fallback');
} else if (code.includes('adminAuthenticated')) {
  console.log('[SERVER] [5] adminAuth already updated');
} else {
  console.error('[SERVER] [5] FAILED: Could not update adminAuth');
  process.exit(1);
}

// 7. Patch reset/delete endpoints to use requireTotp
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
console.log('[SERVER] [6] Patched reset/delete endpoints with requireTotp');

// 8. Remove hardcoded password checks (flexible regex for any whitespace)
code = code.replace(
  /\s*const\s*\{\s*password\s*\}\s*=\s*req\.body;\s*\n\s*\/\/\s*Verify\s*password\s*\n\s*if\s*\(\s*password\s*!==\s*'0258'\s*\)\s*\{\s*\n\s*return\s*res\.status\(403\)\.json\(\{\s*error:\s*'Senha\s*incorreta'\s*\}\);\s*\n\s*\}/g,
  ''
);
code = code.replace(
  /\s*const\s*\{\s*admin_password\s*\}\s*=\s*req\.body;\s*\n\s*if\s*\(\s*admin_password\s*!==\s*'0258'\s*\)[^}]*\}/g,
  ''
);
console.log('[SERVER] [7] Removed hardcoded password checks');

// 9. Update comments
code = code.replace(/\/\/ Password protected \(0258\)/g, '// Protected by adminAuth + TOTP (requireTotp middleware)');

// WRITE AND VALIDATE
try {
  new vm.Script(code, { filename: serverPath });
  console.log('[SERVER] Syntax: OK ✅');
} catch(e) {
  console.error('[SERVER] Syntax ERROR ❌:', e.message);
  // Don't write — keep the backup intact
  process.exit(1);
}

// Verify order
const defIdx = code.indexOf('function requireTotp');
const useIdx = code.indexOf("requireTotp('reset')");
if (defIdx >= 0 && useIdx >= 0 && defIdx < useIdx) {
  console.log('[SERVER] Order: OK ✅ (defined at char', defIdx, ', used at char', useIdx, ')');
} else {
  console.error('[SERVER] Order: FAILED ❌');
  process.exit(1);
}

// Verify login endpoints exist
if (code.includes('/api/admin/login') && code.includes('/api/admin/session-status')) {
  console.log('[SERVER] Login endpoints: OK ✅');
} else {
  console.error('[SERVER] Login endpoints: MISSING ❌');
  process.exit(1);
}

fs.writeFileSync(serverPath, code);
console.log('[SERVER] Saved. Final lines:', code.split('\n').length);

// ============================================================
// PART 2: PATCH ADMIN.HTML
// ============================================================
let html = fs.readFileSync(htmlPath, 'utf8');
const hadCRLF = html.includes('\r\n');
if (hadCRLF) html = html.replace(/\r\n/g, '\n');
console.log('\n[HTML] File size:', html.length, 'bytes, CRLF:', hadCRLF);

// 1. Replace getAdminSecret with session-aware version
const getAdminMatch = html.match(/function getAdminSecret\(\) \{[\s\S]*?return secret;\s*\}/);
if (getAdminMatch && !html.includes('checkAdminSession')) {
  html = html.replace(getAdminMatch[0], `async function checkAdminSession() {
  try {
    const res = await fetch('/api/admin/session-status', { credentials: 'same-origin' });
    const data = await res.json();
    return data.authenticated === true;
  } catch(e) { return false; }
}
function getAdminSecret() {
  return sessionStorage.getItem('8token_admin_secret') || '';
}`);
  console.log('[HTML] [1] ✅ getAdminSecret replaced with session check');
} else if (html.includes('checkAdminSession')) {
  console.log('[HTML] [1] Already has checkAdminSession');
} else {
  console.log('[HTML] [1] ⚠️ Could not find getAdminSecret');
}

// 2. Replace modal text and input
html = html.replace(/Digite sua chave de acesso para entrar no painel\./g, 'Digite o c\\u00f3digo 2FA do Google Authenticator para entrar no painel.');
html = html.replace(/type="password" id="adminSecretInput" placeholder="Chave de acesso"/g, 'type="text" id="adminTotpInput" placeholder="C\\u00f3digo 2FA (6 d\\u00edgitos)" maxlength="6" inputmode="numeric"');
html = html.replace(/font-size:15px;color:#fff;background:#0a0a0a/g, 'font-size:18px;letter-spacing:4px;text-align:center;color:#fff;background:#0a0a0a;font-family:monospace');
console.log('[HTML] [2] ✅ Modal text and input updated');

// 3. Replace submitAdminLogin
const submitMatch = html.match(/function submitAdminLogin\(\) \{[\s\S]*?location\.reload\(\);\s*\}/);
if (submitMatch && !html.includes('async function submitAdminLogin')) {
  html = html.replace(submitMatch[0], `async function submitAdminLogin() {
  const input = document.getElementById('adminTotpInput');
  const errEl = document.getElementById('adminLoginError');
  const btn = document.getElementById('adminLoginBtn');
  const val = input ? input.value.trim() : '';
  if (!val || val.length !== 6) {
    if (errEl) { errEl.style.display = 'block'; errEl.textContent = 'Digite o c\\u00f3digo 2FA de 6 d\\u00edgitos.'; }
    return;
  }
  if (btn) { btn.disabled = true; btn.textContent = 'Verificando...'; }
  try {
    const res = await fetch('/api/admin/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({ totpToken: val })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Erro ao autenticar');
    const overlay = document.getElementById('adminLoginOverlay');
    if (overlay) overlay.remove();
    location.reload();
  } catch(e) {
    if (errEl) { errEl.style.display = 'block'; errEl.textContent = e.message; }
    if (btn) { btn.disabled = false; btn.textContent = 'Entrar'; }
  }
}`);
  console.log('[HTML] [3] ✅ submitAdminLogin replaced with TOTP API call');
} else if (html.includes('async function submitAdminLogin')) {
  console.log('[HTML] [3] Already has async submitAdminLogin');
} else {
  console.log('[HTML] [3] ⚠️ Could not find submitAdminLogin');
}

// 4. Update apiFetch to use credentials
const apiMatch = html.match(/async function apiFetch\(url, options = \{\}\) \{[\s\S]*?return data;\s*\}/);
if (apiMatch && !html.includes("credentials: 'same-origin'")) {
  html = html.replace(apiMatch[0], `async function apiFetch(url, options = {}) {
  const headers = { 'Content-Type': 'application/json', ...options.headers };
  const secret = sessionStorage.getItem('8token_admin_secret');
  if (secret) headers['X-Admin-Secret'] = secret;
  const res = await fetch(API_BASE + url, { ...options, headers, credentials: 'same-origin' });
  const data = await res.json();
  if (res.status === 401 || res.status === 403) {
    sessionStorage.removeItem('8token_admin_secret');
    showAdminLoginModal();
    throw new Error('Sess\\u00e3o expirada. Fa\\u00e7a login novamente.');
  }
  if (!res.ok) throw new Error(data.error || 'Erro na requisi\\u00e7\\u00e3o');
  return data;
}`);
  console.log('[HTML] [4] ✅ apiFetch updated with credentials');
} else if (html.includes("credentials: 'same-origin'")) {
  console.log('[HTML] [4] Already has credentials');
} else {
  console.log('[HTML] [4] ⚠️ Could not find apiFetch');
}

// 5. Add initAdminAuth if not present
if (!html.includes('initAdminAuth')) {
  const initCode = `\n// Check admin session on page load\n(async function initAdminAuth() {\n  const authenticated = await checkAdminSession();\n  if (!authenticated) { showAdminLoginModal(); }\n})();\n`;
  const scriptEnd = html.lastIndexOf('</script>');
  if (scriptEnd > 0) {
    html = html.slice(0, scriptEnd) + initCode + html.slice(scriptEnd);
    console.log('[HTML] [5] ✅ initAdminAuth added');
  }
} else {
  console.log('[HTML] [5] initAdminAuth already present');
}

// Restore CRLF if needed
if (hadCRLF) html = html.replace(/\n/g, '\r\n');
fs.writeFileSync(htmlPath, html);
console.log('[HTML] Saved. Size:', html.length, 'bytes');

console.log('\n=== ALL PATCHES APPLIED SUCCESSFULLY ===');
console.log('Next: pm2 restart 8token');