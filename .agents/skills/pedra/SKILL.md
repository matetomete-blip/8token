---
name: pedra
description: Lê todas as sessões CCD do projeto e arquivos de contexto locais, gerando um resumo consolidado do estado atual — o que foi feito, o que está pendente, e qual é a base para continuar o trabalho.
---

# Skill: pedra

## Quando usar
- O usuário digita `/pedra`.
- O usuário pede para "lembrar o contexto", "pegar a base", "resumir o que foi feito", "ler as sessões" ou similar.
- No início de uma nova sessão quando o usuário quer retomar trabalho anterior sem repetir explicações.

## O que esta skill faz

Executa um processo de 4 passos para reconstruir o contexto completo do projeto:

1. **Lista todas as sessões CCD** relacionadas ao workspace atual (filtrando por `cwd`).
2. **Lê os eventos/transcript** das sessões mais relevantes (as que tocaram neste projeto).
3. **Lê os arquivos de contexto** locais (`contexto/OFERTA.md`, `CONTEXTO-8TOKEN-IMPLEMENTACAO.md`, `AGENTS.md`, e qualquer `.md` ou `.txt` na raiz).
4. **Gera um resumo consolidado** com: estado atual, o que foi implementado, pendências, decisões tomadas, e links úteis.

## Passo 1 — Listar sessões

Use `u_mcp__ccd_session_mgmt__list_sessions` com `limit: 30` para pegar as sessões recentes. Filtre mentalmente as que têm `cwd` apontando para este projeto (`F:\agentes ia\8Token` ou `F:\agentes ia\LP 4TOKEN`).

## Passo 2 — Ler transcripts das sessões relevantes

Para cada sessão identificada no Passo 1 como relevante, use `u_mcp__ccd_session_mgmt__list_events` com `limit: 30` para ler os últimos eventos. Foque em:
- Sessões com título relacionado ao projeto (8Token, LP 4TOKEN, oferta, deploy, login, admin, etc.)
- Sessões com atividade recente (últimas 24-48h)
- Ignore sessões de outros projetos (MyDash, AGENTE ESCRITOR, FUNIL API PIX, etc.)

Se uma sessão tiver muitas mensagens (>100), leia apenas os primeiros 30 eventos para entender o escopo, e os últimos 30 (usando `before_uuid`) para ver o estado final.

## Passo 3 — Ler arquivos de contexto locais

Leia sempre estes arquivos (se existirem):
- `contexto/OFERTA.md` — fonte única de verdade da oferta
- `CONTEXTO-8TOKEN-IMPLEMENTACAO.md` — documento de implementação
- `AGENTS.md` — regras do projeto
- Qualquer `*.md` ou `*.txt` na raiz que pareça ser documentação

Use `fs_glob` com pattern `*.md` e `*.txt` na raiz (`F:\agentes ia\8Token`) para descobrir arquivos de contexto. Se o glob timeout, tente patterns mais específicos como `contexto/*.md`.

## Passo 4 — Gerar resumo consolidado

Organize o resumo nesta estrutura:

### Estado Atual
- Deploy: URL, commit, status
- Backend: stack, banco de dados, variáveis de ambiente
- Frontend: páginas existentes, estado de cada uma

### O Que Foi Implementado
- Liste cada feature/mudança feita nas sessões lidas
- Inclua commits relevantes (do git log se disponível)

### Pendências
- TODOs encontrados no código
- Testes não realizados
- Configurações faltando (Google Client ID, Kirvano webhooks, etc.)
- Bugs conhecidos

### Decisões Tomadas
- Escolhas de arquitetura, design, copy
- Por que certas coisas foram feitas de um jeito e não de outro

### Links Úteis
- Repositório GitHub
- Deploy Vercel (URL correta — confirmar qual projeto é o ativo)
- Supabase Dashboard
- Painel Kirvano

### Contas e Acessos
- Contas teste criadas (email/senha)
- Admin configurado
- Status do login (funcionando? Google OAuth configurado?)

## Regras importantes

- **Nunca invente informações.** Se algo não está nos transcripts ou arquivos, diga "não encontrado nos registros".
- **Confirme qual deploy é o correto.** Existem dois projetos na Vercel (`8token` e `8token-nxlf`). O correto é `8token-nxlf` (conectado ao repo Git). Sempre verifique antes de assumir.
- **Confirme qual Supabase é o correto.** O código usa `wbkmaeqkypqrkawumdjw.supabase.co`. Verifique se corresponde ao projeto ativo no painel.
- **Idioma:** responda sempre no mesmo idioma que o usuário escreveu.
- **Seja direto.** O usuário quer a base rápida para continuar trabalhando, não um relatório acadêmico.

## Exemplo de saída

```
## Base do Projeto 8Token — 14/09/2026

### Estado Atual
- Deploy: https://8token-nxlf.vercel.app (commit 53e29a4, live)
- Backend: Node.js + Express + Supabase (PostgreSQL)
- Frontend: HTML estático (index, login, dashboard, admin, affiliate, account, checkout, docs)

### Implementado Nesta Semana
1. Rebrand completo: zero referências a "ghostcli", tudo é 8Token
2. API Admin para Hermes: validar/desvalidar IPs, planos expirados, subafiliados, contas teste
3. Login corrigido: busca no Supabase Auth quando não encontra na tabela custom
4. Auto-promoção: matetomete@gmail.com vira admin automaticamente
5. Rota /api/admin/setup: cria 5 contas teste de uma vez
6. Dashboard: seção "Seu Plano", badge de status do IP, chave API restrita a assinantes

### Pendências
- [ ] Google Client ID vazio — botão Google não funciona em produção
- [ ] Webhook Kirvano não testado com venda real
- [ ] Drag-and-drop de subafiliados não testado em produção
- [ ] Contas teste não validadas após criação via /api/admin/setup
- [ ] Rate limiting não implementado
- [ ] Design review dos painéis (imagens de referência fora do workspace)

### Contas Teste
| Email | Senha | Tipo |
|-------|-------|------|
| admin@test.8token.com | admin123 | Admin |
| afiliado@test.8token.com | afiliado123 | Afiliado 15% |
| subafiliado@test.8token.com | sub123 | Subafiliado 10% |
| ativo@test.8token.com | ativo123 | Mensal ativo |
| expirado@test.8token.com | expirado123 | Mensal expirado |

### Admin
- matetomete@gmail.com → auto-promovido a admin no login

### Links
- Repo: https://github.com/matetomete-blip/8token
- Deploy: https://8token-nxlf.vercel.app
- Supabase: https://app.supabase.com/project/wbkmaeqkypqrkawumdjw
```

## Arquivos relacionados
- Esta skill: `.Codex/skills/pedra/SKILL.md`
- Contexto da oferta: `contexto/OFERTA.md`
- Documento de implementação: `CONTEXTO-8TOKEN-IMPLEMENTACAO.md`
- Regras do projeto: `AGENTS.md`