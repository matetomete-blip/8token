# Documentação 8Token

## Nesta página

- [Início rápido](#início-rápido)
- [Vídeos](#vídeos)
- [Endpoints](#endpoints)
- [Claude Code](#claude-code)
- [Codex CLI](#codex-cli)
- [SDK e cURL](#sdk-e-curl)
- [Modelos](#modelos)
- [Tool calling](#tool-calling)
- [Erros comuns](#erros-comuns)

---

## DOCUMENTAÇÃO

### Use os modelos onde você já codifica

Uma chave, quatro formatos de API. Claude Code, Codex CLI e clientes Gemini funcionam sem plugin nem gambiarra.

| | |
|---|---|
| **Claude Code** | Configure seu terminal |
| **Codex CLI** | Conecte sua CLI |
| **SDK Anthropic** | Integre sua aplicação |
| **SDK OpenAI** | Integre sua aplicação |
| **SDK Google** | Integre sua aplicação |

---

## Início rápido

Cole sua chave e copie o comando pronto para o seu terminal.

### GERADOR DE VARIÁVEIS

**Suas chaves disponíveis** — Gerenciar chaves. Entre para ver suas chaves.

**SUA CHAVE DE API:** `gcli_SUA_CHAVE`

Montado no seu navegador — a chave não é enviada para o servidor.

#### Claude Code — PowerShell (Só esta sessão)

```powershell
$env:ANTHROPIC_BASE_URL = "URL DO SEU GATEWAY"
$env:ANTHROPIC_API_KEY  = "gcli_SUA_CHAVE"
claude
```

#### Claude Code — cmd (Só esta sessão)

```cmd
set ANTHROPIC_BASE_URL=URL DO SEU GATEWAY
set ANTHROPIC_API_KEY=gcli_SUA_CHAVE
claude
```

#### Claude Code — bash / zsh (Só esta sessão)

```bash
export ANTHROPIC_BASE_URL="URL DO SEU GATEWAY"
export ANTHROPIC_API_KEY="gcli_SUA_CHAVE"
claude
```

---

## Vídeos

Dois passo a passo em vídeo, do zero até a primeira resposta. O da CLI cobre instalação, PATH e variáveis de ambiente; o do aplicativo cobre o modo desenvolvedor e o formulário de gateway.

### Claude Desktop (aplicativo)
**DURAÇÃO 3:17**
Como habilitar o modo desenvolvedor e preencher o formulário de inferência de terceiros — sem editar nenhum arquivo.

*Baixar o vídeo*

### Claude Code no terminal
**DURAÇÃO 3:45**
Instalação, ajuste do PATH e as variáveis de ambiente que apontam a CLI para o 8Token. Windows, Linux e macOS.

*Baixar o vídeo*

> Nos vídeos a chave aparece preenchida. Use a sua, gerada no painel — a chave de outra pessoa não funciona e não deve ser reaproveitada.

[Ver o passo a passo completo, com imagens de cada etapa →]

---

## Endpoints

| FORMATO | ENDPOINT | QUEM FALA ISSO |
|---------|----------|----------------|
| Anthropic Messages | `/v1/messages` | Claude Code, SDK da Anthropic |
| OpenAI Responses | `/v1/responses` | Codex CLI |
| OpenAI Chat Completions | `/v1/chat/completions` | SDK da OpenAI, Cursor, Continue, Aider, LangChain |
| Gemini GenerateContent | `/v1beta/models/{model}:generateContent` | Google Gen AI SDK e clientes Gemini |

Autenticação por `Authorization: Bearer gcli_…` ou `x-api-key: gcli_…` — o servidor aceita os dois, porque cada SDK manda um. A chave aparece uma única vez, no painel, e o IP precisa estar liberado lá.

No formato Gemini também são aceitos `x-goog-api-key` e o parâmetro `?key=`, como nos SDKs do Google.

> ⚠️ Estes endpoints — e portanto o Claude Code e o Codex — exigem o **adicional de acesso à API**, cobrado por fora do plano e válido por 30 dias. Sem ele a resposta é 402 com a instrução no corpo. Contrate ou renove em *acesso à API*.

---

## Claude Code

| VARIÁVEL | VALOR |
|----------|-------|
| `ANTHROPIC_BASE_URL` | `URL DO SEU GATEWAY` |
| `ANTHROPIC_API_KEY` | `gcli_...` |

> ⚠️ `ANTHROPIC_BASE_URL` nunca leva `/v1`. O SDK acrescenta `/v1/messages` sozinho, então apontar para `…/v1` bate em `/v1/v1/messages` e volta 404 — e o CLI reclama de "issue with the selected model", culpando o modelo por um erro de URL.

#### PowerShell

```powershell
$env:ANTHROPIC_BASE_URL = "URL DO SEU GATEWAY"
$env:ANTHROPIC_API_KEY  = "gcli_..."
claude --model claude-fable-5.1
```

#### cmd

```cmd
set ANTHROPIC_BASE_URL=URL DO SEU GATEWAY
set ANTHROPIC_API_KEY=gcli_...
claude --model claude-fable-5.1
```

#### bash / zsh

```bash
export ANTHROPIC_BASE_URL="URL DO SEU GATEWAY"
export ANTHROPIC_API_KEY="gcli_..."
claude --model claude-fable-5.1
```

Com as variáveis no ambiente, todo comando do `claude` já fala com o 8Token — sem flag extra e sem arquivo de configuração.

---

## Codex CLI

### Claude no Codex, passo a passo

**1. Prepare o acesso à API**
No painel, confira seu plano, ative o adicional de API, crie sua chave e libere seu IP com o código por e-mail. Isso autoriza a rede do provedor (ASN): mudanças de IP dentro do mesmo ASN não exigem outra liberação. A assinatura do chat, sozinha, não libera a API.

**2. Abra a configuração do Codex**
Use `~/.codex/config.toml` no macOS/Linux ou `%USERPROFILE%\.codex\config.toml` no Windows. Crie a pasta e o arquivo se não existirem. Faça backup do que já usa e mescle o exemplo sem duplicar entradas. Se você personalizou `CODEX_HOME`, use o `config.toml` dessa pasta.

**3. Escolha 8Token e um modelo Claude**
Coloque `model` e `model_provider` no topo, antes de qualquer `[tabela]`. O nome do provedor deve corresponder a `[model_providers.8token]`. O 8Token traduz a API Responses usada pelo Codex para o modelo escolhido. Isso não transforma o Claude em um modelo da OpenAI.

**4. Defina a chave e inicie uma nova sessão**
Copie o comando de ambiente do gerador. Para variáveis permanentes no Windows, abra outro terminal. Inicie `codex` na pasta do projeto. Use `/status` para conferir o modelo selecionado e teste um pedido simples antes de uma tarefa maior.

> Use o ID exato do catálogo. Os modelos disponíveis dependem do plano. Mantenha `/v1` na URL do Codex e `wire_api = "responses"`. Não use o endpoint Anthropic `/v1/messages` no Codex.

Se o Codex mostrar "Model metadata not found" ou escrever arquivos por comandos de terminal, baixe o configurador abaixo, execute `node codex-setup.mjs` e inicie uma nova sessão do Codex. Ele configura o catálogo com patch nativo e faz backup do `config.toml`, preservando seu provedor, modelo e permissões.

- *Baixar configurador do catálogo Codex*
- *Abrir gerador de configuração*
- *Documentação oficial de provedores do Codex*

> O Codex ignora `OPENAI_BASE_URL` para o provedor padrão: precisa de um provedor próprio no `config.toml` (`~/.codex/config.toml`, ou `%USERPROFILE%\.codex\config.toml` no Windows).

### config.toml

```toml
model = "claude-sonnet-5"
model_provider = "8token"

[model_providers.8token]
name = "8Token"
base_url = "URL DO SEU GATEWAY/v1"
env_key = "8TOKEN_API_KEY"
wire_api = "responses"
```

> ⚠️ Ordem importa em TOML: `model` e `model_provider` têm que vir antes de `[model_providers.8token]`. Depois da tabela, o parser os lê como chaves dela e o Codex volta ao provedor da OpenAI sem dizer nada.

#### PowerShell

```powershell
$env:8TOKEN_API_KEY = "gcli_..."
codex
```

#### cmd

```cmd
set 8TOKEN_API_KEY=gcli_...
codex
```

#### bash / zsh

```bash
export 8TOKEN_API_KEY="gcli_..."
codex
```

O nome da variável é o que estiver em `env_key`. Para trocar de modelo, mude o `model` no topo do arquivo.

---

## SDK e cURL

Convenção invertida entre os dois SDKs: no da OpenAI a `base_url` leva `/v1`; no da Anthropic, não — ele mesmo acrescenta o caminho.

### Python (OpenAI SDK)

```python
from openai import OpenAI

client = OpenAI(base_url="URL DO SEU GATEWAY/v1", api_key="gcli_...")

r = client.chat.completions.create(
    model="claude-fable-5.1",
    messages=[{"role": "user", "content": "Explique RAG"}],
)
print(r.choices[0].message.content)
```

> No PowerShell, `curl` é apelido de `Invoke-WebRequest` e não aceita essa sintaxe — use `curl.exe`, que já vem no Windows 10 e 11.

---

## Modelos

O `id` vai no campo `model` das requisições e na flag `--model` dos CLIs.

| ID | MODELO | CONTEXTO | PLANO MÍNIMO |
|----|--------|----------|--------------|
| `claude-opus-5` | Claude Opus 5 | 1.000k | pro |
| `claude-sonnet-5` | Claude Sonnet 5 | 1.000k | pro |
| `claude-fable-5.1` | Claude Fable 5.1 | 1.000k | max |
| `z-ai/glm-5.3` | GLM 5.3 | 1.000k | pro |
| `gpt-6-astra` | GPT-6 Astra | 1.000k | max |

---

## Tool calling

Funciona nos quatro formatos — `tool_use`/`tool_result` no Anthropic, `tool_calls` no Chat Completions, `function_call`/`function_call_output` na Responses API, `functionCall`/`functionResponse` no Gemini — com streaming: texto comum chega token a token e só o trecho de uma chamada é retido até fechar.

Verificado de ponta a ponta com os dois CLIs reais num ciclo completo: rodar um teste que falha, ler o arquivo, corrigir, rodar de novo e confirmar que passa.

---

## Erros comuns

| SINTOMA | CAUSA | CORREÇÃO |
|---------|-------|----------|
| 404 | `ANTHROPIC_BASE_URL` com `/v1` no fim | Deixe só o domínio |
| 401 invalid or revoked | Chave errada, revogada, ou colada com espaço | Gere outra no painel |
| 429 Free daily limit reached | Teto de 5 mensagens/dia do modelo gratuito | Assine um plano, ou espere a virada do dia (UTC) |
| 402 API access not purchased/expired | Adicional de API não contratado ou vencido | Contrate ou renove em *acesso à API* |
| 403 IP não autorizado | IP fora da lista de liberados | Libere ou renove em *chaves de API* |
| ConnectionRefused | URL com `http://` ou porta explícita | Use `URL DO SEU GATEWAY` |
| Codex usa a OpenAI, não o 8Token | `model_provider` declarado depois da tabela no TOML | Mova as duas chaves para o topo |
| issue with the selected model | Mesma causa do 404 — a mensagem engana | Confira a `ANTHROPIC_BASE_URL` |

---

## Footer

**8Token** — Os 5 melhores modelos do mundo para código, em uma assinatura só. Uso ilimitado, sem cobrança por token e sem surpresa na fatura.

*Gateway respondendo*

### PRODUTO
- Modelos
- Recursos
- Preços
- Chat

### CONTA
- Criar conta
- Entrar
- Painel
- Chaves de API

### RECURSOS
- Perguntas frequentes
- Comparativo de preços
- Documentação da API
- Status

© 2026 GHOSTCLI — TODOS OS DIREITOS RESERVADOS

[TERMOS] [SLA] [PRIVACIDADE · LGPD]

V1.0.0