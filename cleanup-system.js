#!/usr/bin/env node
/**
 * Script de limpeza, correção e migração do sistema 8Token
 * Rodar na VPS: node cleanup-system.js
 */
require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
if (typeof globalThis.WebSocket === 'undefined') {
  try { globalThis.WebSocket = require('ws'); } catch(e) {}
}
const bcrypt = require('bcryptjs');

// Usamos a service_role key para ter permissão total (DDL, etc) se necessário,
// mas o JS client padrão não faz DDL. Vamos focar em DML e garantir dados.
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY,
  { realtime: { enabled: false } }
);

(async () => {
  console.log('🚀 Iniciando correção definitiva e migração do sistema 8Token...\n');

  // 0. GARANTIR TABELA site_settings (Crítico para Gateway URL)
  // O client JS não cria tabelas, mas podemos tentar inserir. Se falhar por tabela não existir,
  // o usuário PRECISA criar a tabela manualmente ou rodar o schema.sql.
  // Vamos tentar um upsert. Se der erro "relation does not exist", avisamos claramente.
  try {
    const { error: gwErr } = await supabase.from('site_settings').upsert(
      { key: 'gateway_url', value: 'https://8token.tech/v1' },
      { onConflict: 'key' }
    );
    if (gwErr) {
      if (gwErr.message.includes('Could not find the table')) {
        console.error('❌ ERRO CRÍTICO: Tabela site_settings não existe no banco!');
        console.error('   Você precisa rodar o schema.sql no Supabase Dashboard ou criar a tabela manualmente:');
        console.error("   CREATE TABLE site_settings (key TEXT PRIMARY KEY, value TEXT, updated_at TIMESTAMPTZ DEFAULT now());");
        console.error("   INSERT INTO site_settings (key, value) VALUES ('gateway_url', 'https://8token.tech/v1');");
      } else {
        console.error('❌ Erro ao atualizar Gateway:', gwErr.message);
      }
    } else {
      console.log('✅ Gateway URL garantido → https://8token.tech/v1');
    }
  } catch (e) {
    console.error('❌ Exceção ao acessar site_settings:', e.message);
  }

  // 1. Identificar usuários para manter
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

  // 2. Limpar tabelas relacionadas (deletar tudo que NÃO é dos usuários mantidos)
  const tables = [
    'usage_logs', 'api_keys', 'ip_subscriptions', 'invoices',
    'ip_activation_requests', 'ip_change_requests', 'notifications',
    'affiliate_referrals', 'affiliates'
  ];

  for (const table of tables) {
    try {
      const { data: rows } = await supabase.from(table).select('id, user_id');
      if (rows && rows.length > 0) {
        const idsToDelete = rows
          .filter(r => r.user_id && !keepIds.includes(r.user_id))
          .map(r => r.id);

        if (idsToDelete.length > 0) {
          const { error } = await supabase.from(table).delete().in('id', idsToDelete);
          if (error) console.error(`❌ Erro ao limpar ${table}:`, error.message);
          else console.log(`🗑️ ${table}: ${idsToDelete.length} registros removidos`);
        } else {
          console.log(`✅ ${table}: já está limpo`);
        }
      } else {
        console.log(`✅ ${table}: vazio ou inexistente`);
      }
    } catch (e) {
      console.log(`⚠️ ${table}: erro ao acessar (pode não existir ainda): ${e.message}`);
    }
  }

  // 3. Deletar usuários extras
  try {
    const { data: allUsers } = await supabase.from('users').select('id, email');
    if (allUsers) {
      const usersToDelete = allUsers.filter(u => !keepIds.includes(u.id));
      for (const u of usersToDelete) {
        const { error } = await supabase.from('users').delete().eq('id', u.id);
        if (error) console.error(`❌ Erro ao deletar ${u.email}:`, error.message);
        else console.log(`🗑️ Usuário removido: ${u.email}`);
      }
      if (usersToDelete.length === 0) console.log('✅ Nenhum usuário extra para remover');
    }
  } catch (e) {
    console.error('❌ Erro ao limpar usuários:', e.message);
  }

  // 4. Garantir 1 IP subscription para Admin (IP 0.0.0.0 = qualquer IP)
  try {
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
  } catch (e) {
    console.error('❌ Erro ao configurar IP Admin:', e.message);
  }

  // 5. Garantir 1 IP subscription para MathVendas
  if (mathId) {
    try {
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
    } catch (e) {
      console.error('❌ Erro ao configurar IP MathVendas:', e.message);
    }
  }

  console.log('\n⚠️ AÇÃO MANUAL NECESSÁRIA NO SUPABASE DASHBOARD:');
  console.log('   O script JS não consegue criar tabelas ou colunas novas (DDL).');
  console.log('   Vá em SQL Editor e cole este bloco inteiro para garantir que tudo existe:');
  console.log(`
  -- Criar tabela site_settings se não existir
  CREATE TABLE IF NOT EXISTS site_settings (
    key TEXT PRIMARY KEY,
    value TEXT,
    updated_at TIMESTAMPTZ DEFAULT now()
  );
  INSERT INTO site_settings (key, value) VALUES ('gateway_url', 'https://8token.tech/v1') ON CONFLICT (key) DO UPDATE SET value = 'https://8token.tech/v1';

  -- Adicionar colunas novas nas tabelas existentes
  ALTER TABLE api_keys ADD COLUMN IF NOT EXISTS key_encrypted TEXT;
  ALTER TABLE ip_subscriptions ADD COLUMN IF NOT EXISTS additional_ip_expires_at TIMESTAMPTZ;
  `);

  console.log('\n🎉 SCRIPT DE LIMPEZA CONCLUÍDO!');
  console.log('   • matetomete@gmail.com (admin, IP: 0.0.0.0)');
  console.log('   • mathaguiarvenda@gmail.com (free, senha: 123456)');
  console.log('\n📋 PRÓXIMOS PASSOS:');
  console.log('   1. Rode o SQL acima no Supabase Dashboard (CRÍTICO para o Gateway funcionar)');
  console.log('   2. Limpe o cache do navegador (Ctrl+Shift+R)');
  console.log('   3. Acesse https://8token.tech/login');

  process.exit(0);
})();