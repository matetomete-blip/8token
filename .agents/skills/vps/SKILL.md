---
name: vps
description: Guia completo de deploy, atualização e troubleshooting da VPS 8Token (Hostinger KVM 2, Ubuntu 24.04, Node.js 22, PM2, Nginx, Supabase). Use SEMPRE que precisar atualizar código na VPS, diagnosticar erros 502, corrigir banco de dados, ou fazer qualquer operação no servidor de produção.
---

# Skill: VPS 8Token — Deploy, Update & Troubleshooting

## Informações do Servidor

| Item | Valor |
|------|-------|
| **Provedor** | Hostinger KVM 2 |
| **Specs** | 2 vCPU, 8GB RAM, 100GB NVMe |
| **OS** | Ubuntu 24.04 LTS |
| **IP** | `2a02:4780:75:a05c::1` (IPv6) / verificar com `curl ifconfig.me` |
| **Domínio** | `8token.tech` (+ `www.8token.tech`) |
| **SSL** | Let's Encrypt via Certbot (renovação automática) |
| **Node.js** | v22.x LTS (via NodeSource) |
| **Process Manager** | PM2 (nome do processo: `8token`) |
| **Reverse Proxy** | Nginx → `127.0.0.1:3000` |
| **Banco de Dados** | Supabase (PostgreSQL) — `wbkmaeqkypqrkawumdjw.supabase.co` |
| **Repo GitHub** | `https://github.com/matetomete-blip/8token.git` |
| **Diretório na VPS** | `/opt/8token` |
| **Gateway API** | `https://8token.tech/v1` (proxy → `ghostcli.dev/v1`) |
| **Chave GhostCLI** | `gcli_qCqmpodn_V_MNZQMoMAYTP-dTlQKLz3l` |

## Acesso SSH

```bash
ssh root@2a02:4780:75:a05c::1
# Ou pelo IPv4 se disponível — verificar no painel Hostinger
```

---

## 1. ATUALIZAR CÓDIGO NA VPS (uso diário)

Sempre que houver mudanças no GitHub, rodar na VPS:

```bash
cd /opt/8token && git pull && pm2 restart 8token
```

Se houver novas dependências no `package.json`:

```bash
cd /opt/8token && git pull && npm install --production && pm2 restart 8token
```

---

## 2. VERIFICAR STATUS DO SERVIDOR

```bash
# Status do PM2
pm2 status

# Logs em tempo real
pm2 logs 8token --lines 30

# Logs sem streaming (snapshot)
pm2 logs 8token --lines 10 --nostream

# Health check local
curl -s http://localhost:3000/api/health

# Health check via domínio público
curl -s https://8token.tech/api/health

# Verificar portas ativas
ss -tlnp | grep -E ':80|:443|:3000'

# Uso de recursos
pm2 monit
```

---

## 3. DIAGNÓSTICO DE ERROS

### 3.1 Erro 502 Bad Gateway

**Causa:** Nginx não consegue falar com o Node.js (app crashado ou porta errada).

```bash
# 1. Verificar se PM2 está online
pm2 status

# 2. Ver logs de erro
pm2 logs 8token --lines 30 --nostream

# 3. Verificar se app responde localmente
curl -s http://localhost:3000/api/health

# 4. Verificar config do Nginx
cat /etc/nginx/sites-enabled/8token.tech | grep proxy_pass

# 5. Reiniciar tudo
pm2 restart 8token
systemctl reload nginx
```

**Causas comuns:**
- Node.js crashou por erro de dependência → `pm2 logs` mostra o erro
- Porta 3000 ocupada por outro processo → `ss -tlnp | grep :3000`
- `.env` faltando variáveis → `cat /opt/8token/.env`

### 3.2 Login não funciona / "Email ou senha incorretos"

**Causa:** Chave Supabase errada no `.env` ou conta não existe no banco.

```bash
# Verificar chave configurada
grep SUPABASE_KEY /opt/8token/.env

# Testar se a chave consegue ler o banco
curl -s "https://wbkmaeqkypqrkawumdjw.supabase.co/rest/v1/users?select=id,email&limit=1" \
  -H "apikey: $(grep SUPABASE_KEY /opt/8token/.env | cut -d= -f2)" \
  -H "Authorization: Bearer $(grep SUPABASE_KEY /opt/8token/.env | cut -d= -f2)"
```

Se retornar `[{"id":"...","email":"..."}]` → chave OK, problema é hash de senha.
Se retornar erro 401/403 → chave errada, pegar a correta no Supabase Dashboard → Settings → API → service_role key.

**Resetar senha de um usuário:**

```bash
cd /opt/8token && node -e '
require("dotenv").config();
const { createClient } = require("@supabase/supabase-js");
if (typeof globalThis.WebSocket === "undefined") globalThis.WebSocket = require("ws");
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY, { realtime: { enabled: false } });
const bcrypt = require("bcryptjs");
(async () => {
  const email = "EMAIL_AQUI";
  const password = "123456";
  const { data: user } = await supabase.from("users").select("id").eq("email", email).single();
  if (!user) { console.log("Usuário não encontrado"); return; }
  const hash = await bcrypt.hash(password, 12);
  await supabase.from("users").update({ password_hash: hash }).eq("id", user.id);
  console.log("Senha resetada para:", password);
})();
'
```

> ⚠️ **IMPORTANTE:** Nunca usar `node -e "..."` com aspas duplas e `!` no Bash — o Bash interpreta `!` como histórico. Usar aspas simples `'...'` ou escrever num arquivo `.js` e rodar com `node arquivo.js`.

### 3.3 IP "Carregando..." no Dashboard

**Causa:** Endpoint `/api/user/ip-info` retorna `{ip: null}` porque não há `ip_subscriptions` ativa para o usuário.

```bash
# Verificar subscriptions do usuário
cd /opt/8token && node -e '
require("dotenv").config();
const { createClient } = require("@supabase/supabase-js");
if (typeof globalThis.WebSocket === "undefined") globalThis.WebSocket = require("ws");
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY, { realtime: { enabled: false } });
(async () => {
  const { data } = await supabase.from("ip_subscriptions").select("*");
  console.log(JSON.stringify(data, null, 2));
})();
'
```

### 3.4 Gateway URL mostra `ghostcli.dev/v1` em vez de `8token.tech/v1`

**Causa:** Tabela `site_settings` não existe ou tem valor antigo no Supabase.

**Fix:** Rodar no **Supabase Dashboard → SQL Editor**:

```sql
CREATE TABLE IF NOT EXISTS site_settings (
  key TEXT PRIMARY KEY,
  value TEXT,
  updated_at TIMESTAMPTZ DEFAULT now()
);
INSERT INTO site_settings (key, value)
VALUES ('gateway_url', 'https://8token.tech/v1')
ON CONFLICT (key) DO UPDATE SET value = 'https://8token.tech/v1', updated_at = now();
```

### 3.5 Erro "Node.js detected but native WebSocket not found"

**Causa:** Node.js < 22. O Supabase SDK v2.116+ exige WebSocket nativo.

**Fix:**

```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
apt install -y nodejs
node --version  # Deve mostrar v22.x
cd /opt/8token && rm -rf node_modules && npm install --production
pm2 restart 8token
```

### 3.6 Porta 80 ocupada (Nginx não inicia)

```bash
# Descobrir o que está usando a porta 80
ss -tlnp | grep :80

# Se for Docker/Traefik antigo:
docker stop $(docker ps -q)
docker system prune -a -f

# Se for Apache:
systemctl stop apache2 && systemctl disable apache2

# Iniciar Nginx
systemctl start nginx && systemctl status nginx
```

---

## 4. SCRIPTS DISPONÍVEIS NA VPS

Todos os scripts estão em `/opt/8token/` e devem ser rodados com `node script.js` (NUNCA com `node -e "..."` para evitar erros de Bash com `!`).

| Script | Função | Comando |
|--------|--------|---------|
| `cleanup-system.js` | Limpa usuários de teste, corrige gateway URL, cria IPs para admin/mathvendas | `node cleanup-system.js` |
| `setup-luca.js` | Cria usuário luca@luca.com com plano anual, IP 179.228.51.181 e chave API pré-definida | `node setup-luca.js` |
| `deploy.sh` | Setup inicial completo da VPS (Node, PM2, Nginx, Certbot) | `bash deploy.sh` |

---

## 5. MIGRAÇÕES DE BANCO (Supabase SQL Editor)

Sempre que houver novas colunas ou tabelas, rodar no **Supabase Dashboard → SQL Editor**:

```sql
-- Tabela site_settings (Gateway URL)
CREATE TABLE IF NOT EXISTS site_settings (
  key TEXT PRIMARY KEY,
  value TEXT,
  updated_at TIMESTAMPTZ DEFAULT now()
);
INSERT INTO site_settings (key, value)
VALUES ('gateway_url', 'https://8token.tech/v1')
ON CONFLICT (key) DO UPDATE SET value = 'https://8token.tech/v1';

-- Coluna key_encrypted (revelar chaves API)
ALTER TABLE api_keys ADD COLUMN IF NOT EXISTS key_encrypted TEXT;

-- Coluna additional_ip_expires_at (expiração IP adicional)
ALTER TABLE ip_subscriptions ADD COLUMN IF NOT EXISTS additional_ip_expires_at TIMESTAMPTZ;

-- Colunas usage_logs (métricas de uso)
ALTER TABLE usage_logs ADD COLUMN IF NOT EXISTS api_key_id UUID REFERENCES api_keys(id);
ALTER TABLE usage_logs ADD COLUMN IF NOT EXISTS latency_ms INTEGER;
ALTER TABLE usage_logs ADD COLUMN IF NOT EXISTS ip TEXT;
ALTER TABLE usage_logs ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'success';
```

---

## 6. ARQUIVO .env NA VPS

Localização: `/opt/8token/.env`

```env
PORT=3000
NODE_ENV=production
JWT_SECRET=<openssl rand -hex 32>
ADMIN_SECRET=<openssl rand -hex 32>
SUPABASE_URL=https://wbkmaeqkypqrkawumdjw.supabase.co
SUPABASE_KEY=<service_role_key — sb_secret_... ou eyJhbGci...>
GHOSTCLI_API_KEY=gcli_qCqmpodn_V_MNZQMoMAYTP-dTlQKLz3l
GHOSTCLI_BASE_URL=https://ghostcli.dev/v1
RESEND_API_KEY=
GOOGLE_CLIENT_ID=
KIRVANO_WEBHOOK_TOKEN=<token>
KIRVANO_CHECKOUT_MENSAL=<url>
KIRVANO_CHECKOUT_TRIMESTRAL=<url>
KIRVANO_CHECKOUT_ANUAL=<url>
KIRVANO_CHECKOUT_IP_ADICIONAL=<url>
KIRVANO_PRODUCT_MENSAL_ID=
KIRVANO_PRODUCT_TRIMESTRAL_ID=
KIRVANO_PRODUCT_ANUAL_ID=
KIRVANO_PRODUCT_IP_ADICIONAL_ID=
```

Para editar: `nano /opt/8token/.env`
Para verificar: `grep SUPABASE_KEY /opt/8token/.env`

---

## 7. NGINX CONFIG

Arquivo: `/etc/nginx/sites-available/8token.tech`

```nginx
server {
    listen 80;
    server_name 8token.tech www.8token.tech;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
        proxy_buffering off;          # CRÍTICO para SSE streaming
        proxy_read_timeout 600s;      # Timeout longo para respostas de IA
        proxy_send_timeout 600s;
    }
}
```

Após editar: `nginx -t && systemctl reload nginx`
SSL: `certbot --nginx -d 8token.tech -d www.8token.tech`

---

## 8. COMANDOS PM2 ÚTEIS

```bash
pm2 status              # Status dos processos
pm2 logs 8token         # Logs em tempo real
pm2 logs 8token --lines 50 --nostream  # Snapshot dos logs
pm2 restart 8token      # Reiniciar
pm2 stop 8token         # Parar
pm2 delete 8token       # Remover
pm2 start server.js --name 8token  # Iniciar
pm2 save                # Salvar lista de processos
pm2 startup             # Configurar auto-start no boot
pm2 monit               # Monitor em tempo real
```

---

## 9. USUÁRIOS DO SISTEMA

| Email | Senha | Plano | IP | Função |
|-------|-------|-------|-----|--------|
| `matetomete@gmail.com` | `123456` | admin | `0.0.0.0` (qualquer) | Admin principal |
| `mathaguiarvenda@gmail.com` | `123456` | free | — | Conta de vendas |
| `luca@luca.com` | `123456` | anual | `179.228.51.181` | Usuário Luca |

**Senha do painel admin** (variável `ADMIN_SECRET`): `3f9a6f8855c93b592bea5e793b60315a816c88a678ccb713a7827bbf9f026836`

---

## 10. CHECKLIST PÓS-DEPLOY

Após qualquer atualização, verificar:

```bash
# 1. App respondendo localmente
curl -s http://localhost:3000/api/health
# Esperado: {"status":"ok","timestamp":"...","proxy":true}

# 2. App respondendo via domínio
curl -s https://8token.tech/api/health
# Esperado: mesmo JSON acima

# 3. PM2 online
pm2 status
# Esperado: 8token | online

# 4. Nginx ativo
systemctl status nginx
# Esperado: active (running)

# 5. SSL válido
curl -sI https://8token.tech | grep -i ssl
# Ou verificar em https://sslshopper.com/ssl-checker.html
```

---

## 11. REGRAS DE OURO

1. **NUNCA usar `node -e "..."` com aspas duplas no Bash** — o `!` é interpretado como histórico. Usar arquivos `.js` ou aspas simples.
2. **SEMPRE rodar `pm2 restart 8token` após `git pull`** — o código novo só entra em vigor após restart.
3. **SEMPRE verificar `pm2 logs` após restart** — confirmar que não há erros de inicialização.
4. **Mudanças no banco (DDL) só via Supabase SQL Editor** — o Supabase JS client não roda `ALTER TABLE` / `CREATE TABLE`.
5. **Limpar cache do navegador (Ctrl+Shift+R)** após atualizações de frontend — o browser pode servir HTML/CSS antigo.
6. **O proxy valida chave API + IP binding** — se o IP do usuário mudar, a chave para de funcionar até atualizar no admin.
7. **Cache de validação tem TTL de 300s (5min)** — mudanças de IP/plano podem levar até 5min para propagar.