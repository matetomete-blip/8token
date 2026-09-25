const fs = require('fs');
const filePath = '/opt/8token/public/admin.html';
let html = fs.readFileSync(filePath, 'utf8');

// Normalize CRLF to LF for matching
const hadCRLF = html.includes('\r\n');
if (hadCRLF) html = html.replace(/\r\n/g, '\n');

console.log('File size:', html.length, 'bytes');
console.log('Had CRLF:', hadCRLF);

// 1. Replace getAdminSecret with session-aware version + checkAdminSession
const oldGetAdmin = [
  'function getAdminSecret() {',
  "let secret = sessionStorage.getItem('8token_admin_secret');",
  'if (!secret) {',
  'const params = new URLSearchParams(window.location.search);',
  "secret = params.get('key') || '';",
  'if (!secret) {',
  'showAdminLoginModal();',
  'return null;',
  '}',
  "sessionStorage.setItem('8token_admin_secret', secret);",
  '}',
  'return secret;',
  '}'
].join('\n');

const newGetAdmin = [
  'async function checkAdminSession() {',
  'try {',
  "const res = await fetch('/api/admin/session-status', { credentials: 'same-origin' });",
  'const data = await res.json();',
  'return data.authenticated === true;',
  '} catch(e) { return false; }',
  '}',
  'function getAdminSecret() {',
  "return sessionStorage.getItem('8token_admin_secret') || '';",
  '}'
].join('\n');

if (html.includes(oldGetAdmin)) {
  html = html.replace(oldGetAdmin, newGetAdmin);
  console.log('[1] OK: getAdminSecret replaced');
} else {
  console.log('[1] FAIL: getAdminSecret not found - trying flexible match');
  // Try without leading spaces
  const flexMatch = html.match(/function getAdminSecret\(\) \{[\s\S]*?return secret;\s*\}/);
  if (flexMatch) {
    html = html.replace(flexMatch[0], newGetAdmin);
    console.log('[1] OK: getAdminSecret replaced (flexible)');
  } else {
    console.log('[1] SKIP: Could not find getAdminSecret at all');
  }
}

// 2. Replace modal text
html = html.replace(
  /Digite sua chave de acesso para entrar no painel\./g,
  'Digite o código 2FA do Google Authenticator para entrar no painel.'
);
console.log('[2a] Modal text updated');

// 3. Replace input field
html = html.replace(
  /type="password" id="adminSecretInput" placeholder="Chave de acesso"/g,
  'type="text" id="adminTotpInput" placeholder="Código 2FA (6 dígitos)" maxlength="6" inputmode="numeric"'
);
console.log('[2b] Input field updated');

// 4. Update input style for TOTP look
html = html.replace(
  /font-size:15px;color:#fff;background:#0a0a0a;border:1px solid #333;border-radius:8px;outline:none;box-sizing:border-box;transition:border-color 0\.2s;"/g,
  'font-size:18px;letter-spacing:4px;text-align:center;color:#fff;background:#0a0a0a;border:1px solid #333;border-radius:8px;outline:none;box-sizing:border-box;transition:border-color 0.2s;font-family:monospace;"'
);
console.log('[2c] Input style updated');

// 5. Replace submitAdminLogin
const oldSubmit = [
  'function submitAdminLogin() {',
  "const input = document.getElementById('adminSecretInput');",
  "const errEl = document.getElementById('adminLoginError');",
  'const val = input ? input.value.trim() : \'\';',
  'if (!val) {',
  "if (errEl) { errEl.style.display = 'block'; errEl.textContent = 'Digite sua chave de acesso.'; }",
  'return;',
  '}',
  "sessionStorage.setItem('8token_admin_secret', val);",
  "const overlay = document.getElementById('adminLoginOverlay');",
  'if (overlay) overlay.remove();',
  'location.reload();',
  '}'
].join('\n');

const newSubmit = [
  'async function submitAdminLogin() {',
  "const input = document.getElementById('adminTotpInput');",
  "const errEl = document.getElementById('adminLoginError');",
  "const btn = document.getElementById('adminLoginBtn');",
  'const val = input ? input.value.trim() : \'\';',
  'if (!val || val.length !== 6) {',
  "if (errEl) { errEl.style.display = 'block'; errEl.textContent = 'Digite o c\\u00f3digo 2FA de 6 d\\u00edgitos.'; }",
  'return;',
  '}',
  "if (btn) { btn.disabled = true; btn.textContent = 'Verificando...'; }",
  'try {',
  "const res = await fetch('/api/admin/login', {",
  "method: 'POST',",
  "headers: { 'Content-Type': 'application/json' },",
  "credentials: 'same-origin',",
  'body: JSON.stringify({ totpToken: val })',
  '});',
  'const data = await res.json();',
  "if (!res.ok) throw new Error(data.error || 'Erro ao autenticar');",
  "const overlay = document.getElementById('adminLoginOverlay');",
  'if (overlay) overlay.remove();',
  'location.reload();',
  '} catch(e) {',
  "if (errEl) { errEl.style.display = 'block'; errEl.textContent = e.message; }",
  "if (btn) { btn.disabled = false; btn.textContent = 'Entrar'; }",
  '}',
  '}'
].join('\n');

if (html.includes(oldSubmit)) {
  html = html.replace(oldSubmit, newSubmit);
  console.log('[3] OK: submitAdminLogin replaced');
} else {
  console.log('[3] FAIL: submitAdminLogin not found - trying flexible');
  const flexSubmit = html.match(/function submitAdminLogin\(\) \{[\s\S]*?location\.reload\(\);\s*\}/);
  if (flexSubmit) {
    html = html.replace(flexSubmit[0], newSubmit);
    console.log('[3] OK: submitAdminLogin replaced (flexible)');
  } else {
    console.log('[3] SKIP: Could not find submitAdminLogin');
  }
}

// 6. Replace apiFetch to use credentials and handle 401/403
const oldApi = [
  'async function apiFetch(url, options = {}) {',
  'const secret = getAdminSecret();',
  "if (!secret) throw new Error('Autentica\\u00e7\\u00e3o cancelada');",
  "const headers = { 'Content-Type': 'application/json', 'X-Admin-Secret': secret, ...options.headers };",
  'const res = await fetch(API_BASE + url, { ...options, headers });',
  'const data = await res.json();',
  "if (!res.ok) throw new Error(data.error || 'Erro na requisi\\u00e7\\u00e3o');",
  'return data;',
  '}'
].join('\n');

const newApi = [
  'async function apiFetch(url, options = {}) {',
  "const headers = { 'Content-Type': 'application/json', ...options.headers };",
  "const secret = sessionStorage.getItem('8token_admin_secret');",
  "if (secret) headers['X-Admin-Secret'] = secret;",
  "const res = await fetch(API_BASE + url, { ...options, headers, credentials: 'same-origin' });",
  'const data = await res.json();',
  'if (res.status === 401 || res.status === 403) {',
  "sessionStorage.removeItem('8token_admin_secret');",
  'showAdminLoginModal();',
  "throw new Error('Sess\\u00e3o expirada. Fa\\u00e7a login novamente.');",
  '}',
  "if (!res.ok) throw new Error(data.error || 'Erro na requisi\\u00e7\\u00e3o');",
  'return data;',
  '}'
].join('\n');

if (html.includes(oldApi)) {
  html = html.replace(oldApi, newApi);
  console.log('[4] OK: apiFetch replaced');
} else {
  console.log('[4] FAIL: apiFetch not found - trying flexible');
  const flexApi = html.match(/async function apiFetch\(url, options = \{\}\) \{[\s\S]*?return data;\s*\}/);
  if (flexApi) {
    html = html.replace(flexApi[0], newApi);
    console.log('[4] OK: apiFetch replaced (flexible)');
  } else {
    console.log('[4] SKIP: Could not find apiFetch');
  }
}

// 7. Add initAdminAuth if not present
if (!html.includes('initAdminAuth')) {
  const initCode = '\n// Check admin session on page load\n(async function initAdminAuth() {\nconst authenticated = await checkAdminSession();\nif (!authenticated) {\nshowAdminLoginModal();\n}\n})();\n';
  const scriptEnd = html.lastIndexOf('</script>');
  if (scriptEnd > 0) {
    html = html.slice(0, scriptEnd) + initCode + html.slice(scriptEnd);
    console.log('[5] OK: initAdminAuth added');
  }
} else {
  console.log('[5] SKIP: initAdminAuth already present');
}

// Restore CRLF if original had it
if (hadCRLF) html = html.replace(/\n/g, '\r\n');

fs.writeFileSync(filePath, html);
console.log('Done. Final size:', html.length, 'bytes');