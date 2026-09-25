const fs = require('fs');
const vm = require('vm');
const serverPath = '/opt/8token/server.js';
const htmlPath = '/opt/8token/public/admin.html';

// === PART 1: Fix server.js - add missing login endpoints ===
let code = fs.readFileSync(serverPath, 'utf8');
console.log('Server.js lines:', code.split('\n').length);

// Check if login endpoint exists
if (!code.includes('/api/admin/login')) {
  console.log('[SERVER] Adding missing login endpoints...');

  // Find the adminAuth function and insert login endpoints after it
  const adminAuthMatch = code.match(/function adminAuth\(req, res, next\) \{[\s\S]*?next\(\);\s*\}/);
  if (adminAuthMatch) {
    const insertPos = code.indexOf(adminAuthMatch[0]) + adminAuthMatch[0].length;

    const loginEndpoints = `

// --- ADMIN LOGIN via TOTP (session-based, 30 min expiry) ---
app.post('/api/admin/login', async (req, res) => {
  try {
    const { totpToken } = req.body;
    if (!totpToken) return res.status(400).json({ error: 'Código 2FA obrigatório' });
    if (!ADMIN_TOTP_ACCESS_SECRET) return res.status(503).json({ error: '2FA de acesso não configurado' });
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
`;

    code = code.slice(0, insertPos) + loginEndpoints + code.slice(insertPos);
    console.log('[SERVER] ✅ Login endpoints added');
  } else {
    console.error('[SERVER] ❌ Could not find adminAuth function');
    process.exit(1);
  }
} else {
  console.log('[SERVER] Login endpoints already exist');
}

// Verify syntax
try {
  new vm.Script(code, { filename: serverPath });
  console.log('[SERVER] Syntax: OK ✅');
} catch(e) {
  console.error('[SERVER] Syntax ERROR ❌:', e.message);
  process.exit(1);
}

fs.writeFileSync(serverPath, code);
console.log('[SERVER] Saved. Lines:', code.split('\n').length);

// === PART 2: Fix admin.html - ensure TOTP login flow ===
let html = fs.readFileSync(htmlPath, 'utf8');
const hadCRLF = html.includes('\r\n');
if (hadCRLF) html = html.replace(/\r\n/g, '\n');
console.log('\n[HTML] File size:', html.length, 'bytes');

// Replace getAdminSecret with session-aware version
const oldGetAdmin = html.match(/function getAdminSecret\(\) \{[\s\S]*?return secret;\s*\}/);
if (oldGetAdmin && !html.includes('checkAdminSession')) {
  const newGetAdmin = `async function checkAdminSession() {
  try {
    const res = await fetch('/api/admin/session-status', { credentials: 'same-origin' });
    const data = await res.json();
    return data.authenticated === true;
  } catch(e) { return false; }
}
function getAdminSecret() {
  return sessionStorage.getItem('8token_admin_secret') || '';
}`;
  html = html.replace(oldGetAdmin[0], newGetAdmin);
  console.log('[HTML] ✅ getAdminSecret replaced with session check');
}

// Replace modal text and input
html = html.replace(/Digite sua chave de acesso para entrar no painel\./g, 'Digite o código 2FA do Google Authenticator para entrar no painel.');
html = html.replace(/type="password" id="adminSecretInput" placeholder="Chave de acesso"/g, 'type="text" id="adminTotpInput" placeholder="Código 2FA (6 dígitos)" maxlength="6" inputmode="numeric"');
html = html.replace(/font-size:15px;color:#fff;background:#0a0a0a/g, 'font-size:18px;letter-spacing:4px;text-align:center;color:#fff;background:#0a0a0a;font-family:monospace');
console.log('[HTML] ✅ Modal text and input updated');

// Replace submitAdminLogin
const oldSubmit = html.match(/function submitAdminLogin\(\) \{[\s\S]*?location\.reload\(\);\s*\}/);
if (oldSubmit && !html.includes('async function submitAdminLogin')) {
  const newSubmit = `async function submitAdminLogin() {
  const input = document.getElementById('adminTotpInput');
  const errEl = document.getElementById('adminLoginError');
  const btn = document.getElementById('adminLoginBtn');
  const val = input ? input.value.trim() : '';
  if (!val || val.length !== 6) {
    if (errEl) { errEl.style.display = 'block'; errEl.textContent = 'Digite o código 2FA de 6 dígitos.'; }
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
}`;
  html = html.replace(oldSubmit[0], newSubmit);
  console.log('[HTML] ✅ submitAdminLogin replaced with TOTP API call');
}

// Update apiFetch to use credentials
const oldApi = html.match(/async function apiFetch\(url, options = \{\}\) \{[\s\S]*?return data;\s*\}/);
if (oldApi && !html.includes("credentials: 'same-origin'")) {
  const newApi = `async function apiFetch(url, options = {}) {
  const headers = { 'Content-Type': 'application/json', ...options.headers };
  const secret = sessionStorage.getItem('8token_admin_secret');
  if (secret) headers['X-Admin-Secret'] = secret;
  const res = await fetch(API_BASE + url, { ...options, headers, credentials: 'same-origin' });
  const data = await res.json();
  if (res.status === 401 || res.status === 403) {
    sessionStorage.removeItem('8token_admin_secret');
    showAdminLoginModal();
    throw new Error('Sessão expirada. Faça login novamente.');
  }
  if (!res.ok) throw new Error(data.error || 'Erro na requisição');
  return data;
}`;
  html = html.replace(oldApi[0], newApi);
  console.log('[HTML] ✅ apiFetch updated with credentials');
}

// Add initAdminAuth if not present
if (!html.includes('initAdminAuth')) {
  const initCode = `
// Check admin session on page load
(async function initAdminAuth() {
  const authenticated = await checkAdminSession();
  if (!authenticated) {
    showAdminLoginModal();
  }
})();
`;
  const scriptEnd = html.lastIndexOf('</script>');
  if (scriptEnd > 0) {
    html = html.slice(0, scriptEnd) + initCode + html.slice(scriptEnd);
    console.log('[HTML] ✅ initAdminAuth added');
  }
}

// Restore CRLF if needed
if (hadCRLF) html = html.replace(/\n/g, '\r\n');
fs.writeFileSync(htmlPath, html);
console.log('[HTML] Saved. Size:', html.length, 'bytes');

console.log('\n=== COMPLETE ===');
console.log('✅ Server endpoints added');
console.log('✅ Frontend updated for TOTP login');
console.log('Next: pm2 restart 8token');