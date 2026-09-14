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
  console.log('=== Fetching ALL env vars with decrypt ===');
  const res = await api('GET', '/v9/projects/' + projectId + '/env?decrypt=true');

  if (res.status !== 200) {
    console.log('Failed:', res.status, JSON.stringify(res.data).substring(0, 300));
    return;
  }

  const envs = res.data.envs || [];
  console.log('Total variables found:', envs.length);

  let serviceRoleVal = null;
  let serviceRoleId = null;
  let supabaseKeyExists = false;

  for (const e of envs) {
    const valPreview = e.value ? e.value.substring(0, 15) + '...' : '(empty/hidden)';
    console.log('  ' + e.key + ' = ' + valPreview + ' | type:' + e.type + ' | target:' + JSON.stringify(e.target) + ' | id:' + e.id);

    if (e.key === 'service_role' && e.value) {
      serviceRoleVal = e.value;
      serviceRoleId = e.id;
    }
    if (e.key === 'SUPABASE_KEY') {
      supabaseKeyExists = true;
    }
  }

  // If service_role not found via decrypt, try without decrypt to at least see it exists
  if (!serviceRoleVal) {
    console.log('\n=== Trying without decrypt to find service_role ===');
    const res2 = await api('GET', '/v9/projects/' + projectId + '/env');
    if (res2.status === 200) {
      const envs2 = res2.data.envs || [];
      console.log('Total (no decrypt):', envs2.length);
      for (const e of envs2) {
        console.log('  ' + e.key + ' | type:' + e.type + ' | target:' + JSON.stringify(e.target) + ' | id:' + e.id);
        if (e.key === 'service_role') {
          serviceRoleId = e.id;
          console.log('  -> Found service_role but value is hidden (type: ' + e.type + ')');
        }
      }
    }
  }

  if (serviceRoleVal && !supabaseKeyExists) {
    console.log('\n=== Creating SUPABASE_KEY from service_role value ===');
    const createRes = await api('POST', '/v9/projects/' + projectId + '/env', {
      key: 'SUPABASE_KEY',
      value: serviceRoleVal,
      type: 'encrypted',
      target: ['production', 'preview', 'development']
    });
    console.log('Create result:', createRes.status, createRes.data?.key || JSON.stringify(createRes.data?.error || '').substring(0, 200));

    // Delete old service_role
    if (serviceRoleId) {
      const delRes = await api('DELETE', '/v9/projects/' + projectId + '/env/' + serviceRoleId);
      console.log('Delete service_role:', delRes.status);
    }
  } else if (supabaseKeyExists) {
    console.log('\nSUPABASE_KEY already exists!');
  } else if (serviceRoleId && !serviceRoleVal) {
    console.log('\n[[TASK_BLOCKED]] service_role exists but value is hidden (Secret type). Cannot read it via API.');
    console.log('You need to either:');
    console.log('1. Paste the service_role key value here (starts with eyJ...)');
    console.log('2. Or rename it in the Vercel dashboard: delete service_role, add SUPABASE_KEY with same value');
  } else {
    console.log('\n[[TASK_BLOCKED]] Neither service_role nor SUPABASE_KEY found.');
    console.log('Paste the Supabase service_role key here (starts with eyJ...) and I will add it as SUPABASE_KEY.');
  }
})();