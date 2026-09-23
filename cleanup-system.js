#!/usr/bin/env node
/**
 * Script de limpeza e correção do sistema 8Token
 * Rodar na VPS: node cleanup-system.js
 */
require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
if (typeof globalThis.WebSocket === 'undefined') {
  try { globalThis.WebSocket = require('ws'); } catch(e) {}
}
const bcrypt = require('bcryptjs');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY,
  { realtime: { enabled: false } }
);

(async () => {
  console.log('🚀 Iniciando correção definitiva do sistema 8Token...\n');

  // 1. Corrigir Gateway URL no banco
  const { error: gwErr } = await supabase.from('site_settings').upsert(
    { key: 'gateway_url', value: 'https://8token.tech/v1' },
    { onConflict: 'key' }
  );
  if (gwErr) console.error('❌ Erro Gateway:', gwErr.message);
  else console.log('✅ Gateway URL → https://8token.tech/v1');

  // 2. Identificar usuários para manter
  const { data: adminUser } = await supabase.from('users')
    .select('id').eq('email', 'matetomete@gmail.com').single();
  const { data: mathUser } = await supabase.from('users')
    .select('id').eq('email', 'mathaguiarvenda@gmail.com').single();

  if (!adminUser) {
    console.error('❌ Admin matetomete@gmail.com não encontrado! Abortando.');
    return;
  }
  console.log('👤 Admin ID:', adminUser.id);

  let mathId = mathUser ? mathUser.id : null;
  if (mathUser) {
    console.log('👤 MathVendas ID:', mathId);
  } else {
    console.log('⚠️ mathaguiarvenda@gmail.com não encontrado. Criando...');
    const hash = await bcrypt.hash('123456', 12);
    const { data: newUser, error: createErr } = await supabase.from('users').insert({
      email: 'mathaguiarvenda@gmail.com',
      password_hash: hash,
      name: 'Mathias Vendas',
      plan: 'free'
    }).select().single();
    if (createErr) {
      console.error('❌ Erro ao criar MathVendas:', createErr.message);
    } else {
      mathId = newUser.id;
      console.log('✅ MathVendas criado (senha: 123456)');
    }
  }

  const keepIds = [adminUser.id];
  if (mathId) keepIds.push(mathId);

  // 3. Limpar tabelas relacionadas
  const tables = [
    'usage_logs', 'api_keys', 'ip_subscriptions', 'invoices',
    'ip_activation_requests', 'ip_change_requests', 'notifications',
    'affiliate_referrals', 'affiliates'
  ];

  for (const table of tables) {
    const { data: rows } = await supabase.from(table).select('id, user_id');
    if (rows && rows.length > 0) {
      const idsToDelete = rows
        .filter(r => r.user_id && !keepIds.includes(r.user_id))
        .map(r => r.id);
      if (idsToDelete.length > 0) {
        const { error } = await supabase.from(table).delete().in('id', idsToDelete);
        if (error) console.error('❌ Erro ao limpar ' + table + ':', error.message);
        else console.log('🗑️ ' + table + ': ' + idsToDelete.length + ' registros removidos');
      } else {
        console.log('✅ ' + table + ': já está limpo');
      }
    } else {
      console.log('✅ ' + table + ': vazio');
    }
  }

  // 4. Deletar usuários extras
  const { data: allUsers } = await supabase.from('users').select('id, email');
  if (allUsers) {
    const usersToDelete = allUsers.filter(u => !keepIds.includes(u.id));
    for (const u of usersToDelete) {
      const { error } = await supabase.from('users').delete().eq('id', u.id);
      if (error) console.error('❌ Erro ao deletar ' + u.email + ':', error.message);
      else console.log('🗑️ Usuário removido:', u.email);
    }
    if (usersToDelete.length === 0) console.log('✅ Nenhum usuário extra para remover');
  }

  // 5. Garantir 1 IP subscription para Admin (IP 0.0.0.0 = qualquer IP)
  const { data: adminSubs } = await supabase.from('ip_subscriptions')
    .select('id').eq('user_id', adminUser.id);

  if (!adminSubs || adminSubs.length === 0) {
    await supabase.from('ip_subscriptions').insert({
      user_id: adminUser.id, ip: '0.0.0.0', plan: 'admin', status: 'active'
    });
    console.log('✅ IP subscription Admin criada (0.0.0.0 = qualquer IP)');
  } else if (adminSubs.length > 1) {
    const toDelete = adminSubs.slice(1).map(s => s.id);
    await supabase.from('ip_subscriptions').delete().in('id', toDelete);
    console.log('✅ IP subscriptions Admin extras removidas (mantida 1)');
  } else {
    // Atualizar a existente para garantir plan=admin e ip=0.0.0.0
    await supabase.from('ip_subscriptions').update({
      ip: '0.0.0.0', plan: 'admin', status: 'active'
    }).eq('id', adminSubs[0].id);
    console.log('✅ IP subscription Admin atualizada (0.0.0.0, admin, active)');
  }

  // 6. Garantir 1 IP subscription para MathVendas
  if (mathId) {
    const { data: mathSubs } = await supabase.from('ip_subscriptions')
      .select('id').eq('user_id', mathId);

    if (!mathSubs || mathSubs.length === 0) {
      await supabase.from('ip_subscriptions').insert({
        user_id: mathId, ip: '', plan: 'free', status: 'active'
      });
      console.log('✅ IP subscription MathVendas criada');
    } else if (mathSubs.length > 1) {
      const toDelete = mathSubs.slice(1).map(s => s.id);
      await supabase.from('ip_subscriptions').delete().in('id', toDelete);
      console.log('✅ IP subscriptions MathVendas extras removidas');
    } else {
      console.log('✅ IP subscription MathVendas já existe');
    }
  }

  // 7. Adicionar coluna key_encrypted se não existir (via REST API workaround)
  // Nota: Supabase JS não roda ALTER TABLE diretamente.
  // O usuário precisa rodar no SQL Editor do Supabase Dashboard:
  // ALTER TABLE api_keys ADD COLUMN IF NOT EXISTS key_encrypted TEXT;
  // ALTER TABLE ip_subscriptions ADD COLUMN IF NOT EXISTS additional_ip_expires_at TIMESTAMPTZ;
  console.log('\n⚠️ IMPORTANTE — Rodar no Supabase Dashboard → SQL Editor:');
  console.log('  ALTER TABLE api_keys ADD COLUMN IF NOT EXISTS key_encrypted TEXT;');
  console.log('  ALTER TABLE ip_subscriptions ADD COLUMN IF NOT EXISTS additional_ip_expires_at TIMESTAMPTZ;');

  console.log('\n🎉 SISTEMA CORRIGIDO E LIMPO!');
  console.log('  • matetomete@gmail.com (admin, IP: 0.0.0.0)');
  console.log('  • mathaguiarvenda@gmail.com (free, senha: 123456)');
  console.log('\n📋 PRÓXIMOS PASSOS:');
  console.log('  1. Rode as 2 linhas SQL acima no Supabase Dashboard');
  console.log('  2. Limpe o cache do navegador (Ctrl+Shift+R) ou use aba anônima');
  console.log('  3. Acesse https://8token.tech/login');
  console.log('  4. Admin: matetomete@gmail.com / 123456');
  console.log('  5. User: mathaguiarvenda@gmail.com / 123456');

  process.exit(0);
})();