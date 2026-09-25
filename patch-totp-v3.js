const fs = require('fs');
const vm = require('vm');
const path = '/opt/8token/server.js';
let code = fs.readFileSync(path, 'utf8');
const origLines = code.split('\n').length;
console.log('Original lines:', origLines);

// 1. Add otplib + qrcode imports after crypto require
if (!code.includes("require('otplib')")) {
  code = code.replace(
    "const crypto = require('crypto');",
    "const crypto = require('crypto');\nconst { generateSecret, verifySync, generateURI } = require('otplib');\nconst QRCode = require('qrcode');"
  );
  console.log('[1] Added otplib + qrcode imports');
} else {
  console.log('[1] otplib already imported');
}

// 2. Add TOTP env vars after ADMIN_SECRET
if (!code.includes('ADMIN_TOTP_RESET_SECRET')) {
  code = code.replace(
    "const ADMIN_SECRET = process.env.ADMIN_SECRET || '8token-admin-change-me';",
    "const ADMIN_SECRET = process.env.ADMIN_SECRET || '8token-admin-change-me';\nconst ADMIN_TOTP_RESET_SECRET = process.env.ADMIN_TOTP_RESET_SECRET || '';\nconst ADMIN_TOTP_DELETE_SECRET = process.env.ADMIN_TOTP_DELETE_SECRET || '';"
  );
  console.log('[2] Added TOTP env vars');
} else {
  console.log('[2] TOTP env vars already present');
}

// 3. Build the TOTP block
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
  res.json({ reset: { enabled: !!ADMIN_TOTP_RESET_SECRET }, delete: { enabled: !!ADMIN_TOTP_DELETE_SECRET } });
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

// 4. Insert TOTP block AFTER adminAuth function — use exact line-based insertion
if (!code.includes('function requireTotp')) {
  const lines = code.split('\n');
  // Find the line with "function adminAuth" and its closing brace
  let adminAuthStart = -1;
  let adminAuthEnd = -1;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].includes('function adminAuth(req, res, next)')) {
      adminAuthStart = i;
    }
    if (adminAuthStart >= 0 && adminAuthEnd < 0 && i > adminAuthStart && lines[i].trim() === '}') {
      adminAuthEnd = i;
      break;
    }
  }
  if (adminAuthEnd >= 0) {
    // Insert after the closing brace of adminAuth
    lines.splice(adminAuthEnd + 1, 0, totpBlock);
    code = lines.join('\n');
    console.log('[3] Inserted TOTP block after adminAuth at line', adminAuthEnd + 1);
  } else {
    console.error('[3] FAILED: Could not find adminAuth function boundaries');
    process.exit(1);
  }
} else {
  console.log('[3] requireTotp already defined');
}

// 5. Patch users/:subId/reset — add requireTotp and remove password check
code = code.replace(
  /app\.post\('\/api\/admin\/users\/:subId\/reset', adminAuth, async/g,
  "app.post('/api/admin/users/:subId/reset', adminAuth, requireTotp('reset'), async"
);
code = code.replace(
  /  const \{ password \} = req\.body;\n\n  \/\/ Verify password\n  if \(password !== '0258'\) \{\n    return res\.status\(403\)\.json\(\{ error: 'Senha incorreta' \}\);\n  \}/g,
  ''
);
console.log('[4] Patched users/:subId/reset');

// 6. Patch users/:subId/delete-complete
code = code.replace(
  /app\.delete\('\/api\/admin\/users\/:subId\/delete-complete', adminAuth, async/g,
  "app.delete('/api/admin/users/:subId/delete-complete', adminAuth, requireTotp('delete'), async"
);
code = code.replace(
  /  const \{ password \} = req\.body;\n\n  \/\/ Verify password\n  if \(password !== '0258'\) \{\n    return res\.status\(403\)\.json\(\{ error: 'Senha incorreta' \}\);\n  \}/g,
  ''
);
console.log('[5] Patched users/:subId/delete-complete');

// 7. Patch subscriptions/:id/reset and delete-complete (what frontend calls)
code = code.replace(
  /app\.post\('\/api\/admin\/subscriptions\/:id\/reset', adminAuth, async/g,
  "app.post('/api/admin/subscriptions/:id/reset', adminAuth, requireTotp('reset'), async"
);
code = code.replace(
  /app\.delete\('\/api\/admin\/subscriptions\/:id\/delete-complete', adminAuth, async/g,
  "app.delete('/api/admin/subscriptions/:id/delete-complete', adminAuth, requireTotp('delete'), async"
);
console.log('[6] Patched subscriptions/:id/reset and delete-complete');

// 8. Remove any remaining admin_password checks
code = code.replace(/  const \{ admin_password \} = req\.body;\n  if \(admin_password !== '0258'\)[^}]*\}/g, '');
console.log('[7] Removed admin_password checks');

// 9. Update comments
code = code.replace(/\/\/ Password protected \(0258\)/g, '// Protected by adminAuth + TOTP (requireTotp middleware)');
console.log('[8] Updated comments');

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
  console.log('Order: OK ✅ (defined at char', defIdx, ', first used at char', useIdx, ')');
} else {
  console.error('Order: FAILED ❌ (defIdx:', defIdx, ', useIdx:', useIdx, ')');
  process.exit(1);
}

// Verify no more 0258
if (code.includes("'0258'")) {
  console.error('WARNING: Still contains hardcoded 0258 ❌');
  process.exit(1);
} else {
  console.log('No hardcoded 0258: OK ✅');
}