const https = require('https');
const fs = require('fs');
const path = require('path');

const authPath = path.join(process.env.APPDATA, 'com.vercel.cli', 'Data', 'auth.json');
const auth = JSON.parse(fs.readFileSync(authPath, 'utf8'));
const token = auth.token;
const projectId = 'prj_TsC0TxCIyLoOfln10ZEJgUKHpI8h';

const data = JSON.stringify({
  ssoProtection: null,
  passwordProtection: null
});

const options = {
  hostname: 'api.vercel.com',
  path: '/v9/projects/' + projectId,
  method: 'PATCH',
  headers: {
    'Authorization': 'Bearer ' + token,
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(data)
  }
};

const req = https.request(options, (res) => {
  let body = '';
  res.on('data', chunk => body += chunk);
  res.on('end', () => {
    console.log('STATUS:', res.statusCode);
    if (res.statusCode === 200) {
      console.log('PROTECTION_DISABLED_OK for 8token-nxlf');
    } else {
      console.log('RESPONSE:', body.substring(0, 500));
    }
  });
});

req.on('error', (e) => {
  console.log('ERROR:', e.message);
});

req.write(data);
req.end();