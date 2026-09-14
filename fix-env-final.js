const https = require('https');
const fs = require('fs');
const path = require('path');

const authPath = path.join(process.env.APPDATA, 'com.vercel.cli', 'Data', 'auth.json');
const auth = JSON.parse(fs.readFileSync(authPath, 'utf8'));
const token = auth.token;
const projectId = 'prj_5hoxfXPp1DbfyzA2QLeTQc34AEvf';

function api(method, urlPath, body) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const req = https.request({
      hostname: 'api.vercel.com',
      path: urlPath,
      method,
      headers: {
        'Authorization': `Bearer ${token}`,
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
  console.log('Fetching environment variables...');
  // Use decrypt=true to get actual values of secrets
  const res = await api('GET', `/v9/projects/${projectId}/env?decrypt=true`);

  if (res.status !== 200) {
    console.log('Failed to fetch envs:', res.data);
    return;
  }

  const envs = res.data.envs || [];
  console.log(`Found ${envs.length} variables.`);

  let serviceRoleVal = null;
  let supabaseUrlVal = null;
  let supabaseKeyExists = false;

  for (const e of envs) {
    if (e.key === 'service_role') serviceRoleVal = e.value;
    if (e.key === 'SUPABASE_URL') supabaseUrlVal = e.value;
    if (e.key === 'SUPABASE_KEY') supabaseKeyExists = true;
    console.log(`- ${e.key}: ${e.value ? e.value.substring(0, 10) + '...' : '(empty)'}`);
  }

  // 1. Ensure SUPABASE_URL exists
  if (!supabaseUrlVal) {
    console.log('\nAdding missing SUPABASE_URL...');
    await api('POST', `/v9/projects/${projectId}/env`, {
      key: 'SUPABASE_URL',
      value: 'https://wbkmaeqkypqrkawumdjw.supabase.co',
      type: 'encrypted',
      target: ['production', 'preview', 'development']
    });
  }

  // 2. Handle SUPABASE_KEY vs service_role
  if (serviceRoleVal && !supabaseKeyExists) {
    console.log('\nFound service_role, creating SUPABASE_KEY with same value...');
    await api('POST', `/v9/projects/${projectId}/env`, {
      key: 'SUPABASE_KEY',
      value: serviceRoleVal,
      type: 'encrypted',
      target: ['production', 'preview', 'development']
    });
    console.log('SUPABASE_KEY created.');
  } else if (supabaseKeyExists) {
    console.log('\nSUPABASE_KEY already exists.');
  } else {
    console.log('\nWARNING: Neither service_role nor SUPABASE_KEY found with value.');
  }

  console.log('\nDone. Redeploying...');
})();