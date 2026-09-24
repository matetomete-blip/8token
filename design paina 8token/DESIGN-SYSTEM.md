# 🎨 Design System — 8Token UI

Este documento define as regras visuais obrigatórias para o desenvolvimento de interfaces do ecossistema **8Token**. O objetivo é garantir consistência total com a identidade visual estabelecida nas artes de referência.

## 1. Paleta de Cores

A identidade é **Dark Mode** por padrão, com alto contraste e acentos vibrantes em laranja/neon.

### Cores Principais
- **Background Principal**: `#050505` a `#0A0A0A` (Preto quase absoluto)
- **Background Secundário (Cards/Painéis)**: `#111111` a `#141414`
- **Bordas/Divisórias**: `#222222` ou `#333333` (Sutil)

### Cores de Acento (Brand)
- **Primary Orange**: `#FF5500` a `#FF6B00` (Laranja vibrante, usado em botões principais, ícones ativos e glows)
- **Secondary Cyan/Blue**: `#00D4FF` ou `#00A3FF` (Usado em detalhes tecnológicos, links secundários ou status)
- **Success Green**: `#00FF94` (Para indicadores de sucesso/online)
- **Error Red**: `#FF3333`

### Tipografia
- **Texto Principal**: `#FFFFFF` (Branco puro)
- **Texto Secundário**: `#A0A0A0` ou `#888888` (Cinza médio)
- **Texto Placeholder**: `#555555`

## 2. Tipografia

Use fontes modernas, geométricas e sans-serif.

- **Família Principal**: `Inter`, `Roboto`, ou `SF Pro Display`.
- **Títulos (H1-H3)**: Peso **Bold** ou **ExtraBold**. Tracking levemente negativo (-0.02em) para impacto.
- **Corpo de Texto**: Peso **Regular**. Tamanho base 16px.
- **Números/Dados**: Use fonte monoespaçada (`JetBrains Mono`, `Fira Code`) para dados técnicos, IPs, hashes ou valores financeiros.

## 3. Componentes e Elementos

### Cards e Containers
- **Background**: `#111111` com opacidade ~90% se houver blur.
- **Border Radius**: `12px` a `16px` (Arredondado suave).
- **Borda**: 1px sólido `#222222`.
- **Efeito Glow**: Ao passar o mouse (hover), adicione uma sombra interna ou externa sutil na cor Primary Orange (`box-shadow: 0 0 15px rgba(255, 85, 0, 0.2)`).

### Botões
- **Primário**: Background `#FF5500`, Texto Branco. Border Radius `8px`. Hover: Brilho mais intenso.
- **Secundário**: Background Transparente, Borda `#FF5500`, Texto `#FF5500`.
- **Ghost**: Apenas texto cinza claro, hover torna branco.

### Inputs e Formulários
- **Background**: `#0A0A0A`.
- **Borda**: `#333333`. Foco: Borda `#FF5500`.
- **Placeholder**: Cinza escuro.

### Ícones
- Use ícones lineares (outline) com espessura fina (1.5px ou 2px).
- Biblioteca recomendada: **Lucide React**, **Heroicons** ou **Phosphor Icons**.
- Cor padrão: Cinza claro. Cor ativa: Laranja.

## 4. Efeitos Visuais e Atmosfera

### Glassmorphism (Vidro)
- Use em modais, headers fixos ou cards sobrepostos.
- CSS: `backdrop-filter: blur(10px); background: rgba(17, 17, 17, 0.8); border: 1px solid rgba(255, 255, 255, 0.05);`

### Glows e Sombras Coloridas
- Não use sombras pretas padrão. Use sombras coloridas sutis para criar profundidade "neon".
- Exemplo: `box-shadow: 0 4px 20px rgba(255, 85, 0, 0.15);`

### Gradientes Sutile
- Use gradientes muito sutis no background principal para evitar o "preto chapado".
- Exemplo: Radial gradient do centro para fora, saindo de `#111` para `#000`.

## 5. Layout e Grid

- **Espaçamento**: Baseie em múltiplos de 8px (8, 16, 24, 32, 48, 64).
- **Margens Laterais**: Generosas em desktop (min 64px ou centralizado em container max-width 1200px).
- **Hierarquia**: Títulos grandes e ousados. Muito espaço em branco (negativo) entre seções.

## 6. Regras de Ouro

1. **Nunca use branco puro como background de página.** Sempre use tons de preto/cinza muito escuro.
2. **O Laranja é a alma da marca.** Use-o com parcimônia para chamar atenção (CTAs, notificações, status ativo). Se tudo for laranja, nada se destaca.
3. **Contraste é rei.** Garanta que o texto cinza seja legível sobre o fundo preto.
4. **Suavidade.** Bordas arredondadas e transições suaves (0.2s ou 0.3s ease-in-out) em todos os elementos interativos.

---

*Este guia deve ser seguido rigorosamente para manter a identidade visual do 8Token.*