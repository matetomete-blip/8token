const fs = require('fs');
const path = '/opt/8token/public/admin.html';
let html = fs.readFileSync(path, 'utf8');
const origSize = html.length;
console.log('Original size:', origSize, 'bytes');

// 1. Replace getAdminSecret with session-aware version
const oldGetAdminSecret = `        function getAdminSecret() {
            let secret = sessionStorage.getItem('8token_admin_secret');
            if (!secret) {
                const params = new URLSearchParams(window.location.search);
                secret = params.get('key') || '';
                if (!secret) {
                    showAdminLoginModal();
                    return null;
                }
                sessionStorage.setItem('8token_admin_secret', secret);
            }
            return secret;
        }`;

const newGetAdminSecret = `        async function checkAdminSession() {
            try {
                const res = await fetch('/api/admin/session-status', { credentials: 'same-origin' });
                const data = await res.json();
                return data.authenticated === true;
            } catch(e) { return false; }
        }
        function getAdminSecret() {
            return sessionStorage.getItem('8token_admin_secret') || '';
        }`;

if (html.includes(oldGetAdminSecret)) {
    html = html.replace(oldGetAdminSecret, newGetAdminSecret);
    console.log('[1] ✅ Replaced getAdminSecret with session check');
} else {
    console.log('[1] ❌ Could not find getAdminSecret pattern');
}

// 2. Replace showAdminLoginModal to use TOTP input
const oldShowModal = `        function showAdminLoginModal() {
            const existing = document.getElementById('adminLoginOverlay');
            if (existing) existing.remove();
            const overlay = document.createElement('div');
            overlay.id = 'adminLoginOverlay';
            overlay.style.cssText = 'position:fixed;inset:0;z-index:99999;background:rgba(0,0,0,0.92);backdrop-filter:blur(8px);display:flex;align-items:center;justify-content:center;';
            overlay.innerHTML = \`
                <div style="background:#111;border:1px solid #333;border-radius:16px;padding:40px;max-width:400px;width:90%;box-shadow:0 20px 60px rgba(0,0,0,0.5);">
                    <div style="display:flex;align-items:center;gap:12px;margin-bottom:24px;">
                        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#FF5500" stroke-width="2"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
                        <h2 style="font-size:20px;font-weight:700;color:#fff;margin:0;">Acesso Admin</h2>
                    </div>
                    <p style="font-size:13px;color:#888;margin:0 0 20px;line-height:1.5;">Digite sua chave de acesso para entrar no painel.</p>
                    <input type="password" id="adminSecretInput" placeholder="Chave de acesso" autocomplete="off" spellcheck="false"
                        style="width:100%;height:44px;padding:0 16px;font-size:15px;color:#fff;background:#0a0a0a;border:1px solid #333;border-radius:8px;outline:none;box-sizing:border-box;transition:border-color 0.2s;"
                        onfocus="this.style.borderColor='#FF5500'" onblur="this.style.borderColor='#333'">
                    <div id="adminLoginError" style="display:none;font-size:12px;color:#FF3333;margin-top:8px;"></div>
                    <button id="adminLoginBtn" onclick="submitAdminLogin()" style="width:100%;height:44px;margin-top:16px;font-size:15px;font-weight:600;color:#fff;background:#FF5500;border:none;border-radius:8px;cursor:pointer;transition:opacity 0.2s;" onmouseover="this.style.opacity='0.85'" onmouseout="this.style.opacity='1'">Entrar</button>
                </div>
            \`;
            document.body.appendChild(overlay);
            const input = document.getElementById('adminSecretInput');
            if (input) {
                setTimeout(() => input.focus(), 100);
                input.addEventListener('keydown', (e) => { if (e.key === 'Enter') submitAdminLogin(); });
            }
        }`;

const newShowModal = `        function showAdminLoginModal() {
            const existing = document.getElementById('adminLoginOverlay');
            if (existing) existing.remove();
            const overlay = document.createElement('div');
            overlay.id = 'adminLoginOverlay';
            overlay.style.cssText = 'position:fixed;inset:0;z-index:99999;background:rgba(0,0,0,0.92);backdrop-filter:blur(8px);display:flex;align-items:center;justify-content:center;';
            overlay.innerHTML = \`
                <div style="background:#111;border:1px solid #333;border-radius:16px;padding:40px;max-width:400px;width:90%;box-shadow:0 20px 60px rgba(0,0,0,0.5);">
                    <div style="display:flex;align-items:center;gap:12px;margin-bottom:24px;">
                        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#FF5500" stroke-width="2"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
                        <h2 style="font-size:20px;font-weight:700;color:#fff;margin:0;">Acesso Admin</h2>
                    </div>
                    <p style="font-size:13px;color:#888;margin:0 0 20px;line-height:1.5;">Digite o código 2FA do Google Authenticator para entrar no painel.</p>
                    <input type="text" id="adminTotpInput" placeholder="Código 2FA (6 dígitos)" autocomplete="off" spellcheck="false" maxlength="6" inputmode="numeric" pattern="[0-9]*"
                        style="width:100%;height:44px;padding:0 16px;font-size:18px;letter-spacing:4px;text-align:center;color:#fff;background:#0a0a0a;border:1px solid #333;border-radius:8px;outline:none;box-sizing:border-box;transition:border-color 0.2s;font-family:monospace;"
                        onfocus="this.style.borderColor='#FF5500'" onblur="this.style.borderColor='#333'">
                    <div id="adminLoginError" style="display:none;font-size:12px;color:#FF3333;margin-top:8px;"></div>
                    <button id="adminLoginBtn" onclick="submitAdminLogin()" style="width:100%;height:44px;margin-top:16px;font-size:15px;font-weight:600;color:#fff;background:#FF5500;border:none;border-radius:8px;cursor:pointer;transition:opacity 0.2s;" onmouseover="this.style.opacity='0.85'" onmouseout="this.style.opacity='1'">Entrar</button>
                </div>
            \`;
            document.body.appendChild(overlay);
            const input = document.getElementById('adminTotpInput');
            if (input) {
                setTimeout(() => input.focus(), 100);
                input.addEventListener('keydown', (e) => { if (e.key === 'Enter') submitAdminLogin(); });
            }
        }`;

if (html.includes(oldShowModal)) {
    html = html.replace(oldShowModal, newShowModal);
    console.log('[2] ✅ Replaced showAdminLoginModal with TOTP version');
} else {
    console.log('[2] ❌ Could not find showAdminLoginModal pattern');
}

// 3. Replace submitAdminLogin to call /api/admin/login with TOTP
const oldSubmitLogin = `        function submitAdminLogin() {
            const input = document.getElementById('adminSecretInput');
            const errEl = document.getElementById('adminLoginError');
            const val = input ? input.value.trim() : '';
            if (!val) {
                if (errEl) { errEl.style.display = 'block'; errEl.textContent = 'Digite sua chave de acesso.'; }
                return;
            }
            sessionStorage.setItem('8token_admin_secret', val);
            const overlay = document.getElementById('adminLoginOverlay');
            if (overlay) overlay.remove();
            location.reload();
        }`;

const newSubmitLogin = `        async function submitAdminLogin() {
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

if (html.includes(oldSubmitLogin)) {
    html = html.replace(oldSubmitLogin, newSubmitLogin);
    console.log('[3] ✅ Replaced submitAdminLogin with TOTP API call');
} else {
    console.log('[3] ❌ Could not find submitAdminLogin pattern');
}

// 4. Update apiFetch to use session cookies and handle 401/403
const oldApiFetch = `        async function apiFetch(url, options = {}) {
            const secret = getAdminSecret();
            if (!secret) throw new Error('Autenticação cancelada');
            const headers = { 'Content-Type': 'application/json', 'X-Admin-Secret': secret, ...options.headers };
            const res = await fetch(API_BASE + url, { ...options, headers });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'Erro na requisição');
            return data;
        }`;

const newApiFetch = `        async function apiFetch(url, options = {}) {
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

if (html.includes(oldApiFetch)) {
    html = html.replace(oldApiFetch, newApiFetch);
    console.log('[4] ✅ Updated apiFetch to use session cookies');
} else {
    console.log('[4] ❌ Could not find apiFetch pattern');
}

// 5. Add init code to check session on page load
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
        console.log('[5] ✅ Added initAdminAuth check on page load');
    }
} else {
    console.log('[5] ️ initAdminAuth already present');
}

fs.writeFileSync(path, html);
console.log('\nPatch applied. Final size:', html.length, 'bytes');
console.log('Changes:', html.length - origSize, 'bytes added');