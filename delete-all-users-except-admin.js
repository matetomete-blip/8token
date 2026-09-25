require('dotenv').config();

// Polyfill WebSocket para Node.js < 22
if (typeof globalThis.WebSocket === 'undefined') {
  try { globalThis.WebSocket = require('ws'); } catch (e) {}
}

const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.SUPABASE_URL || 'https://wbkmaeqkypqrkawumdjw.supabase.co';
const supabaseKey = process.env.SUPABASE_KEY || process.env.service_role || '';

if (!supabaseKey) {
  console.error('ERRO: SUPABASE_KEY não configurado. Defina no .env');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey, {
  realtime: { enabled: false },
});

const ADMIN_EMAIL = 'matetomete@gmail.com';

async function deleteAllUsersExceptAdmin() {
  console.log('🔍 Buscando todos os usuários...');

  // Get all users
  const { data: allUsers, error: fetchErr } = await supabase
    .from('users')
    .select('id, email, name, role');

  if (fetchErr) {
    console.error('Erro ao buscar usuários:', fetchErr.message);
    process.exit(1);
  }

  console.log(`📋 Total de usuários encontrados: ${allUsers.length}`);

  // Filter out admin
  const usersToDelete = allUsers.filter(u => u.email !== ADMIN_EMAIL);
  const adminUser = allUsers.find(u => u.email === ADMIN_EMAIL);

  console.log(`🛡️  Admin preservado: ${adminUser?.email} (${adminUser?.name})`);
  console.log(`🗑️  Usuários para deletar: ${usersToDelete.length}`);
  console.log('');

  if (usersToDelete.length === 0) {
    console.log('✅ Nenhum usuário para deletar.');
    return;
  }

  // List users to delete
  console.log('Lista de usuários que serão deletados:');
  usersToDelete.forEach((u, i) => {
    console.log(`  ${i + 1}. ${u.email} (${u.name || 'sem nome'}) - role: ${u.role || 'user'}`);
  });
  console.log('');

  let deleted = 0;
  let errors = 0;

  for (const user of usersToDelete) {
    const userId = user.id;
    console.log(`\n🗑️  Deletando ${user.email} (${userId})...`);

    try {
      // Step 1: Delete key_authorized_ips for this user's keys
      const { data: userKeys } = await supabase.from('api_keys').select('id').eq('user_id', userId);
      if (userKeys && userKeys.length > 0) {
        const keyIds = userKeys.map(k => k.id);
        const { error: err1 } = await supabase.from('key_authorized_ips').delete().in('key_id', keyIds);
        if (err1) console.warn(`  ⚠️  key_authorized_ips: ${err1.message}`);
        else console.log(`  ✅ key_authorized_ips deletados (${keyIds.length} keys)`);
      }

      // Step 2: Delete API keys
      const { error: err2 } = await supabase.from('api_keys').delete().eq('user_id', userId);
      if (err2) console.warn(`  ⚠️  api_keys: ${err2.message}`);
      else console.log(`  ✅ api_keys deletados`);

      // Step 3: Delete ip_subscriptions
      const { error: err3 } = await supabase.from('ip_subscriptions').delete().eq('user_id', userId);
      if (err3) console.warn(`  ⚠️  ip_subscriptions: ${err3.message}`);
      else console.log(`  ✅ ip_subscriptions deletados`);

      // Step 4: Delete invoices
      const { error: err4 } = await supabase.from('invoices').delete().eq('user_id', userId);
      if (err4) console.warn(`  ⚠️  invoices: ${err4.message}`);
      else console.log(`  ✅ invoices deletados`);

      // Step 5: Delete plan_audit_log
      const { error: err5 } = await supabase.from('plan_audit_log').delete().eq('user_id', userId);
      if (err5) console.warn(`  ⚠️  plan_audit_log: ${err5.message}`);
      else console.log(`  ✅ plan_audit_log deletados`);

      // Step 6: Delete affiliates
      const { error: err6 } = await supabase.from('affiliates').delete().eq('user_id', userId);
      if (err6) console.warn(`  ⚠️  affiliates: ${err6.message}`);
      else console.log(`  ✅ affiliates deletados`);

      // Step 7: Delete the user record itself
      const { error: err7 } = await supabase.from('users').delete().eq('id', userId);
      if (err7) {
        console.error(`  ❌ users: ${err7.message}`);
        errors++;
      } else {
        console.log(`  ✅ user record deletado`);
        deleted++;
      }

    } catch (e) {
      console.error(`  ❌ Erro inesperado: ${e.message}`);
      errors++;
    }
  }

  console.log('\n' + '='.repeat(50));
  console.log(`✅ Deletados com sucesso: ${deleted}`);
  console.log(`❌ Erros: ${errors}`);
  console.log(`🛡️  Admin preservado: ${ADMIN_EMAIL}`);
  console.log('='.repeat(50));
}

deleteAllUsersExceptAdmin().catch(e => {
  console.error('Erro fatal:', e);
  process.exit(1);
});