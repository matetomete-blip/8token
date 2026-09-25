const fs = require('fs');
const path = '/opt/8token/server.js';
let code = fs.readFileSync(path, 'utf8');

// 1. Add otplib + qrcode imports after crypto require
if (!code.includes("require('otplib')")) {
  code = code.replace(
    "const crypto = require('crypto');",
    "const crypto = require('crypto');\nconst { generateSecret, verifySync, generateURI } = require('otplib');\nconst QRCode = require('qrcode');"
  );
}

// 2. Add TOTP env vars after ADMIN_SECRET
if (!code.includes('ADMIN_TOTP_RESET_SECRET')) {
  code = code.replace(
    "const ADMIN_SECRET = process.env.ADMIN_SECRET || '8token-admin-change-me';",
    "const ADMIN_SECRET = process.env.ADMIN_SECRET || '8token-admin-change-me';\nconst ADMIN_TOTP_RESET_SECRET = process.env.ADMIN_TOTP_RESET_SECRET || '';\nconst ADMIN_TOTP_DELETE_SECRET = process.env.ADMIN_TOTP_DELETE_SECRET || '';"
  );
}

// 3. Add TOTP block (rate limiter, endpoints, requireTotp middleware) after adminAuth function
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
    if (!token||!secret||!operation) return res.status(400).json({ error: 'token, secret, operation obrigatórios' });
    const result = verifySync({ token, secret });
    if (!result.valid) return res.status(403).json({ error: 'Código TOTP inválido' });
    const envPath = '/opt/8token/.env';
    let env = fs.existsSync(envPath) ? fs.readFileSync(envPath,'utf8') : '';
    const key = operation==='reset' ? 'ADMIN_TOTP_RESET_SECRET' : 'ADMIN_TOTP_DELETE_SECRET';
    env = env.includes(key+'=') ? env.replace(new RegExp(key+'=.*'), key+'='+secret) : env+'\\n'+key+'='+secret+'\\n';
    fs.writeFileSync(envPath, env);
    res.json({ success: true, message: '2FA salvo. Reinicie o servidor.' });
  } catch(e) { res.status(500).json({ error: e.message }); }
});
app.get('/api/admin/2fa/status', adminAuth, (req, res) => {
  res.json({ reset: { enabled: !!ADMIN_TOTP_RESET_SECRET }, delete: { enabled: !!ADMIN_TOTP_DELETE_SECRET } });
});
function requireTotp(operation) {
  return (req, res, next) => {
    const secret = operation==='reset' ? ADMIN_TOTP_RESET_SECRET : ADMIN_TOTP_DELETE_SECRET;
    if (!secret) return next();
    const tok = req.headers['x-totp-token'] || req.body?.totpToken;
    if (!tok) return res.status(403).json({ error: 'Código 2FA obrigatório (x-totp-token ou totpToken)' });
    const result = verifySync({ token: tok, secret });
    if (!result.valid) return res.status(403).json({ error: 'Código 2FA inválido ou expirado' });
    next();
  };
}
`;

if (!code.includes('function requireTotp')) {
  // Insert after the adminAuth function closing brace
  code = code.replace(
    /(function adminAuth[\s\S]*?next\(\);\n\})/,
    '$1\n' + totpBlock
  );
}

// 4. Replace hardcoded password checks in users/:subId/reset — add requireTotp and remove password check
code = code.replace(
  /app\.post\('\/api\/admin\/users\/:subId\/reset', adminAuth, async/g,
  "app.post('/api/admin/users/:subId/reset', adminAuth, requireTotp('reset'), async"
);
// Remove the password verification block for users/:subId/reset
code = code.replace(
  /  const \{ password \} = req\.body;\n\n  \/\/ Verify password\n  if \(password !== '0258'\) \{\n    return res\.status\(403\)\.json\(\{ error: 'Senha incorreta' \}\);\n  \}/g,
  ''
);

// 5. Same for users/:subId/delete-complete
code = code.replace(
  /app\.delete\('\/api\/admin\/users\/:subId\/delete-complete', adminAuth, async/g,
  "app.delete('/api/admin/users/:subId/delete-complete', adminAuth, requireTotp('delete'), async"
);
code = code.replace(
  /  const \{ password \} = req\.body;\n\n  \/\/ Verify password\n  if \(password !== '0258'\) \{\n    return res\.status\(403\)\.json\(\{ error: 'Senha incorreta' \}\);\n  \}/g,
  ''
);

// 6. Add requireTotp to subscriptions/:id/reset and delete-complete (these are what the frontend calls)
code = code.replace(
  /app\.post\('\/api\/admin\/subscriptions\/:id\/reset', adminAuth, async/g,
  "app.post('/api/admin/subscriptions/:id/reset', adminAuth, requireTotp('reset'), async"
);
code = code.replace(
  /app\.delete\('\/api\/admin\/subscriptions\/:id\/delete-complete', adminAuth, async/g,
  "app.delete('/api/admin/subscriptions/:id/delete-complete', adminAuth, requireTotp('delete'), async"
);

// 7. Remove any remaining admin_password password checks in subscriptions endpoints
code = code.replace(/  const \{ admin_password \} = req\.body;\n  if \(admin_password !== '0258'\)[^}]*\}/g, '');

// 8. Update comments referencing 0258
code = code.replace(/\/\/ Password protected \(0258\)/g, '// Protected by adminAuth + TOTP (requireTotp middleware)');

fs.writeFileSync(path, code);
console.log('Patch applied successfully. Lines:', code.split('\n').length);

// Verify syntax
try {
  require('vm').createScript(code, { filename: path });
  console.log('Syntax: OK');
} catch(e) {
  console.error('Syntax ERROR:', e.message);
  process.exit(1);
}