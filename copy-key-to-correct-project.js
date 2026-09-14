const https = require('https');
const fs = require('fs');
const path = require('path');

const authPath = path.join(process.env.APPDATA, 'com.vercel.cli', 'Data', 'auth.json');
const auth = JSON.parse(fs.readFileSync(authPath, 'utf8'));
const token = auth.token;

const sourceProjectId = 'prj_TsC0TxCIyLoOfln10ZEJgUKHpI8h'; // 8token-nxlf (has service_role)
const targetProjectId = 'prj_5hoxfXPp1DbfyzA2QLeTQc34AEvf'; // 8token (main project)

function api(method, urlPath, body) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const req = https.request({
      hostname: 'api.vercel.com',
      path: urlPath,
      method,
      headers: {
        'Authorization': 'Bearer ' + token,
        'Content-Type': 'application/json',
        ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {})
      }
    }, (res) => {
      let b = '';
      res.on('data', c => b += c);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, data: JSON.parse(b) }); }
        catch { resolve({ status: res.statusCode, data: b }); }
      });
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

(async () => {
  console.log('=== Step 1: Get service_role value from 8token-nxlf ===');
  const sourceRes = await api('GET', '/v9/projects/' + sourceProjectId + '/env?decrypt=true');

  if (sourceRes.status !== 200) {
    console.log('Failed to fetch source envs:', sourceRes.status);
    return;
  }

  const sourceEnvs = sourceRes.data.envs || [];
  const serviceRoleEnv = sourceEnvs.find(e => e.key === 'service_role');

  if (!serviceRoleEnv || !serviceRoleEnv.value) {
    console.log('service_role not found or has no value in 8token-nxlf');
    console.log('Available vars:', sourceEnvs.map(e => e.key + '=' + (e.value ? e.value.substring(0, 10) + '...' : '(empty)')).join(', '));
    return;
  }

  console.log('Found service_role value (length: ' + serviceRoleEnv.value.length + ')');
  console.log('Preview: ' + serviceRoleEnv.value.substring(0, 20) + '...');

  console.log('\n=== Step 2: Check if SUPABASE_KEY exists in target project ===');
  const targetRes = await api('GET', '/v9/projects/' + targetProjectId + '/env?decrypt=true');
  const targetEnvs = targetRes.data.envs || [];
  const existingKey = targetEnvs.find(e => e.key === 'SUPABASE_KEY');

  if (existingKey) {
    console.log('SUPABASE_KEY already exists, updating...');
    const updateRes = await api('PATCH', '/v9/projects/' + targetProjectId + '/env/' + existingKey.id, {
      value: serviceRoleEnv.value,
      type: 'encrypted',
      target: ['production', 'preview', 'development']
    });
    console.log('Update result:', updateRes.status);
  } else {
    console.log('Creating SUPABASE_KEY in 8token project...');
    const createRes = await api('POST', '/v9/projects/' + targetProjectId + '/env', {
      key: 'SUPABASE_KEY',
      value: serviceRoleEnv.value,
      type: 'encrypted',
      target: ['production', 'preview', 'development']
    });
    console.log('Create result:', createRes.status, createRes.data?.key || JSON.stringify(createRes.data?.error || '').substring(0, 200));
  }

  console.log('\n=== Step 3: Verify all required env vars exist ===');
  const verifyRes = await api('GET', '/v9/projects/' + targetProjectId + '/env?decrypt=true');
  const finalEnvs = verifyRes.data.envs || [];
  const requiredVars = ['SUPABASE_URL', 'SUPABASE_KEY', 'JWT_SECRET', 'ADMIN_SECRET'];

  console.log('Final environment variables in 8token:');
  for (const v of requiredVars) {
    const env = finalEnvs.find(e => e.key === v);
    if (env && env.value) {
      console.log('  ✓ ' + v + ' = ' + env.value.substring(0, 15) + '...');
    } else {
      console.log('  ✗ ' + v + ' = MISSING');
    }
  }

  console.log('\n=== DONE! Ready to redeploy ===');
})();