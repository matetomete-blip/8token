#!/usr/bin/env node
/**
 * Script para configurar o usuário Luca com plano anual, IP específico e chave API pré-definida.
 * Rodar na VPS: node setup-luca.js
 */
require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
if (typeof globalThis.WebSocket === 'undefined') {
  try { globalThis.WebSocket = require('ws'); } catch(e) {}
}
const bcrypt = require('bcryptjs');
const crypto = require('crypto');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY,
  { realtime: { enabled: false } }
);

// Dados do usuário Luca
const LUCA_EMAIL = 'luca@luca.com';
const LUCA_PASSWORD = '123456';
const LUCA_IP = '179.228.51.181';
const LUCA_PLAN = 'anual';
const PREDEFINED_KEY = '8tk_acb451d176017b92da9fb3ffebf0274009d03b128c16902dba96756469230fba';

(async () => {
  console.log(' Configurando usuário Luca...');

  // 1. Criar ou buscar usuário
  let userId;
  const { data: existingUser } = await supabase.from('users')
    .select('id')
    .eq('email', LUCA_EMAIL)
    .single();

  if (existingUser) {
    userId = existingUser.id;
    console.log('✅ Usuário já existe:', userId);
    // Atualizar senha e plano
    const hash = await bcrypt.hash(LUCA_PASSWORD, 12);
    await supabase.from('users').update({
      password_hash: hash,
      plan: LUCA_PLAN,
      plan_expires_at: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString()
    }).eq('id', userId);
    console.log('✅ Senha e plano atualizados');
  } else {
    const hash = await bcrypt.hash(LUCA_PASSWORD, 12);
    const { data: newUser, error } = await supabase.from('users').insert({
      email: LUCA_EMAIL,
      password_hash: hash,
      name: 'Luca',
      plan: LUCA_PLAN,
      plan_expires_at: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString()
    }).select().single();

    if (error) {
      console.error('❌ Erro ao criar usuário:', error.message);
      return;
    }
    userId = newUser.id;
    console.log('✅ Usuário criado:', userId);
  }

  // 2. Configurar IP Subscription
  const { data: existingSub } = await supabase.from('ip_subscriptions')
    .select('id')
    .eq('user_id', userId)
    .single();

  if (existingSub) {
    await supabase.from('ip_subscriptions').update({
      ip: LUCA_IP,
      plan: LUCA_PLAN,
      status: 'active',
      expires_at: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString()
    }).eq('id', existingSub.id);
    console.log('✅ IP Subscription atualizada para:', LUCA_IP);
  } else {
    await supabase.from('ip_subscriptions').insert({
      user_id: userId,
      ip: LUCA_IP,
      plan: LUCA_PLAN,
      status: 'active',
      expires_at: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString()
    });
    console.log('✅ IP Subscription criada para:', LUCA_IP);
  }

  // 3. Configurar Chave API Pré-definida
  const keyHash = crypto.createHash('sha256').update(PREDEFINED_KEY).digest('hex');
  const keyPrefix = PREDEFINED_KEY.slice(0, 8);
  const keySuffix = PREDEFINED_KEY.slice(-4);

  // Verificar se a chave já existe
  const { data: existingKey } = await supabase.from('api_keys')
    .select('id')
    .eq('key_hash', keyHash)
    .single();

  if (existingKey) {
    // Atualizar para garantir que pertence ao Luca e não está revogada
    await supabase.from('api_keys').update({
      user_id: userId,
      revoked: false,
      name: 'Chave Principal Luca'
    }).eq('id', existingKey.id);
    console.log('✅ Chave API atualizada e vinculada ao Luca');
  } else {
    // Inserir nova chave
    // Nota: key_encrypted pode falhar se a coluna não existir ainda, mas tentamos
    let keyEncrypted = null;
    try {
      const ENCRYPTION_KEY = Buffer.from(process.env.JWT_SECRET || 'fallback-secret-key-32chars!!', 'utf8').slice(0, 32);
      const IV = Buffer.alloc(16, 0);
      const cipher = crypto.createCipheriv('aes-256-cbc', ENCRYPTION_KEY, IV);
      keyEncrypted = cipher.update(PREDEFINED_KEY, 'utf8', 'hex') + cipher.final('hex');
    } catch (e) {
      console.log('⚠️ Não foi possível criptografar a chave (coluna key_encrypted pode não existir):', e.message);
    }

    const { error: keyError } = await supabase.from('api_keys').insert({
      user_id: userId,
      name: 'Chave Principal Luca',
      key_hash: keyHash,
      key_prefix: keyPrefix,
      key_suffix: keySuffix,
      key_encrypted: keyEncrypted,
      revoked: false
    });

    if (keyError) {
      console.error('❌ Erro ao criar chave API:', keyError.message);
    } else {
      console.log('✅ Chave API criada:', keyPrefix + '••••' + keySuffix);
    }
  }

  console.log('\n🎉 CONFIGURAÇÃO CONCLUÍDA!');
  console.log('👤 Email:', LUCA_EMAIL);
  console.log('🔑 Senha:', LUCA_PASSWORD);
  console.log('🌐 IP Liberado:', LUCA_IP);
  console.log('🔐 Chave API:', PREDEFINED_KEY);
  console.log('📅 Plano: Anual (365 dias)');

  process.exit(0);
})();