const https = require('https');
const fs = require('fs');
const path = require('path');

const authPath = path.join(process.env.APPDATA, 'com.vercel.cli', 'Data', 'auth.json');
const auth = JSON.parse(fs.readFileSync(authPath, 'utf8'));
const token = auth.token;
const projectId = 'prj_5hoxfXPp1DbfyzA2QLeTQc34AEvf';

function apiCall(method, urlPath, body) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const options = {
      hostname: 'api.vercel.com',
      path: urlPath,
      method,
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
        ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {})
      }
    };
    const req = https.request(options, (res) => {
      let responseBody = '';
      res.on('data', chunk => responseBody += chunk);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, data: JSON.parse(responseBody) }); }
        catch { resolve({ status: res.statusCode, data: responseBody }); }
      });
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

(async () => {
  // Step 1: List all env vars to see what exists
  console.log('=== Listing all environment variables ===');
  const listResult = await apiCall('GET', `/v9/projects/${projectId}/env?decrypt=true`);
  console.log('Status:', listResult.status);

  if (listResult.status === 200 && listResult.data.envs) {
    console.log('Found', listResult.data.envs.length, 'variables:');
    for (const env of listResult.data.envs) {
      console.log(`  ${env.key} = ${env.value ? env.value.substring(0, 20) + '...' : '(empty)'} (type: ${env.type}, target: ${JSON.stringify(env.target)})`);
    }

    // Find service_role value
    const serviceRoleEnv = listResult.data.envs.find(e => e.key === 'service_role');
    const supabaseKeyEnv = listResult.data.envs.find(e => e.key === 'SUPABASE_KEY');

    if (serviceRoleEnv && serviceRoleEnv.value) {
      console.log('\n=== Found service_role, creating SUPABASE_KEY with same value ===');

      // Delete service_role
      const delResult = await apiCall('DELETE', `/v9/projects/${projectId}/env/${serviceRoleEnv.id}`);
      console.log('Delete service_role:', delResult.status);

      // Create SUPABASE_KEY
      const createResult = await apiCall('POST', `/v9/projects/${projectId}/env`, {
        key: 'SUPABASE_KEY',
        value: serviceRoleEnv.value,
        type: 'encrypted',
        target: ['production', 'preview', 'development']
      });
      console.log('Create SUPABASE_KEY:', createResult.status, createResult.data?.key || createResult.data?.error?.message || '');
    } else if (supabaseKeyEnv) {
      console.log('\nSUPABASE_KEY already exists!');
    } else {
      console.log('\nNeither service_role nor SUPABASE_KEY found. Need manual input.');
    }
  } else {
    console.log('Error listing env vars:', JSON.stringify(listResult.data).substring(0, 300));
  }
})();