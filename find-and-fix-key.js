const https = require('https');
const fs = require('fs');
const path = require('path');

const authPath = path.join(process.env.APPDATA, 'com.vercel.cli', 'Data', 'auth.json');
const auth = JSON.parse(fs.readFileSync(authPath, 'utf8'));
const token = auth.token;
const mainProjectId = 'prj_5hoxfXPp1DbfyzA2QLeTQc34AEvf';

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
  console.log('=== Step 1: List all Vercel projects ===');
  const projRes = await api('GET', '/v9/projects?limit=20');
  if (projRes.status !== 200) {
    console.log('Failed to list projects:', projRes.status);
    return;
  }

  const projects = projRes.data.projects || [];
  console.log('Found ' + projects.length + ' projects:');
  for (const p of projects) {
    console.log('  ' + p.name + ' (' + p.id + ')');
  }

  console.log('\n=== Step 2: Check each project for service_role or SUPABASE_KEY ===');
  let foundValue = null;
  let foundInProject = null;

  for (const p of projects) {
    const envRes = await api('GET', '/v9/projects/' + p.id + '/env?decrypt=true');
    if (envRes.status === 200 && envRes.data.envs) {
      const envs = envRes.data.envs;
      const keys = envs.map(e => e.key);
      console.log('  ' + p.name + ': ' + keys.join(', '));

      for (const e of envs) {
        if ((e.key === 'service_role' || e.key === 'SUPABASE_KEY') && e.value && e.value.startsWith('eyJ')) {
          foundValue = e.value;
          foundInProject = p.name;
          console.log('  >>> FOUND KEY in ' + p.name + ' as ' + e.key);
        }
      }
    }
  }

  if (foundValue) {
    console.log('\n=== Step 3: Adding SUPABASE_KEY to main project (8token) ===');
    // Check if already exists
    const mainEnvRes = await api('GET', '/v9/projects/' + mainProjectId + '/env?decrypt=true');
    const mainEnvs = mainEnvRes.data.envs || [];
    const existing = mainEnvs.find(e => e.key === 'SUPABASE_KEY');

    if (existing) {
      console.log('SUPABASE_KEY already exists in 8token, updating...');
      await api('PATCH', '/v9/projects/' + mainProjectId + '/env/' + existing.id, {
        value: foundValue,
        type: 'encrypted',
        target: ['production', 'preview', 'development']
      });
    } else {
      console.log('Creating SUPABASE_KEY in 8token...');
      const createRes = await api('POST', '/v9/projects/' + mainProjectId + '/env', {
        key: 'SUPABASE_KEY',
        value: foundValue,
        type: 'encrypted',
        target: ['production', 'preview', 'development']
      });
      console.log('Create result:', createRes.status, createRes.data?.key || JSON.stringify(createRes.data?.error || '').substring(0, 200));
    }

    // Also ensure SUPABASE_URL exists
    const urlExists = mainEnvs.find(e => e.key === 'SUPABASE_URL');
    if (!urlExists) {
      console.log('Adding SUPABASE_URL...');
      await api('POST', '/v9/projects/' + mainProjectId + '/env', {
        key: 'SUPABASE_URL',
        value: 'https://wbkmaeqkypqrkawumdjw.supabase.co',
        type: 'encrypted',
        target: ['production', 'preview', 'development']
      });
    }

    console.log('\n=== DONE! SUPABASE_KEY added to 8token project ===');
    console.log('Now redeploying...');
  } else {
    console.log('\n[[TASK_BLOCKED]] Could not find service_role or SUPABASE_KEY in any Vercel project.');
    console.log('The variable you added in the dashboard may not have been saved correctly.');
    console.log('Please paste the Supabase service_role key here (starts with eyJ...) and I will add it.');
  }
})();