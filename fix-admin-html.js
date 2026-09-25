const fs = require('fs');
const path = '/opt/8token/public/admin.html';
let html = fs.readFileSync(path, 'utf8');

// 1. Replace admin_password with totpToken in API calls
html = html.replace(/admin_password:\s*pwd/g, 'totpToken: pwd');

// 2. Update modal text from 'senha de administrador' to 'código 2FA'
html = html.replace(/Digite a senha de administrador para confirmar esta ação\./g, 'Digite o código 2FA do Google Authenticator para confirmar esta ação.');
html = html.replace(/Digite a senha de administrador\./g, 'Digite o código 2FA do Google Authenticator.');
html = html.replace(/Senha do administrador/g, 'Código 2FA (6 dígitos)');
html = html.replace(/Digite a senha de administrador para confirmar\./g, 'Digite o código 2FA do Google Authenticator para confirmar.');

// 3. Update the input placeholder
html = html.replace(/placeholder="Senha do administrador"/g, 'placeholder="Código 2FA (6 dígitos)"');

fs.writeFileSync(path, html);

// Verify changes
const checks = [
  html.includes('totpToken: pwd'),
  !html.includes('admin_password: pwd'),
  html.includes('Código 2FA do Google Authenticator'),
  !html.includes('senha de administrador para confirmar')
];
console.log('totpToken in body:', checks[0]);
console.log('No admin_password:', checks[1]);
console.log('2FA text present:', checks[2]);
console.log('Old text removed:', checks[3]);
console.log('All OK:', checks.every(Boolean));