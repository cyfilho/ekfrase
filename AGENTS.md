# AGENTS.md — guia rápido para IAs (e pessoas com pressa)

Leia este arquivo primeiro. Ele diz onde está cada coisa, os comandos e as regras; com ele você não precisa vasculhar o repositório.

## O que é

Ekfrase é uma família de apps web **livres** (MPL-2.0) que moram em `ekfrase.com/<app>/`: **Maker** (mapas e worldbuilding), **Biblioteca** (livros em domínio público, com leitor de EPUB) e **Vernákula** (sala de aula de escolas de idiomas). Todos usam a mesma casca, os mesmos idiomas, o mesmo Guia de Arte e o mesmo formato de arquivo (`.ekfr`).

O servidor do ekfrase.com (contas, nuvem) **não** está neste repositório. Sem ele, os apps rodam em **modo local**: sem conta e sem nuvem. O Maker abre direto o editor (Exportar/Importar `.ekfr` funcionam); a Biblioteca lê e baixa livros (anotar pede conta); o Vernákula mostra só a tela de entrar.

## Mapa

| Caminho | O quê |
|---|---|
| `apps/maker/` | o Maker: `src/main.ts` (editor), `src/casca.tsx` (topo, conta, nuvem), `src/document.ts` (abrir/salvar). Pacotes dele em `packages/maker-*` |
| `apps/biblioteca/` | a Biblioteca: `src/App.tsx` (acervo, ficha), `src/Leitor.tsx` (leitor), `src/anotacoes.ts` |
| `apps/vernakula/` | o Vernákula: `src/App.tsx`, `src/telas/` |
| `packages/nucleo/` | idiomas (`criarTradutor`), tema, `estilo/tokens.css` e `base.css` (o Guia de Arte) |
| `packages/interface/` | casca comum em Preact: `AcoesTopo`, `RodapeEkfrase`, `EntradaApp`, `FormConta`, `Janela`, feedback, cliente do servidor (`ponte`), acervo da Biblioteca |
| `packages/arquivo/` | o arquivo `.ekfr`: `gravarEkfr`, `identificar`, `podeAbrir`, `REGISTRO`, `entregar`/`receber` |
| `packages/maker-core`, `maker-doc`, `maker-gen`, `maker-render` | grade hexagonal, documento (Yjs), geradores de mundo, desenho |
| `locales/<idioma>/<arquivo>.json` | **todos** os textos de interface (`pt-BR` e `en`) |
| `biblioteca/<AUTOR>/<Título>/` | os livros: EPUB + `livro.json` (a ficha) + PDF, DOCX, TXT |
| `scripts/chave.ts` | grava um texto nos dois idiomas de uma vez |
| `scripts/biblioteca.ts` | monta o acervo da Biblioteca a partir de `biblioteca/` (roda sozinho no `dev`/`build`) |
| `scripts/arte/gerar.mjs` | desenha as logos em pixel art (por código) |
| `tests/`, `packages/*/test/`, `apps/*/test/` | testes (Vitest) |
| `docs/DESENVOLVER.md` | o guia completo: regras, criar um app, contribuir |
| `docs/formato-ekfr.md` | a especificação do `.ekfr` |

## Comandos

```sh
npm install
npm run maker        # http://127.0.0.1:5173/maker/
npm run biblioteca   # http://127.0.0.1:5330/biblioteca/
npm run vernakula    # http://127.0.0.1:5310/vernakula/
npm run conferir     # tipos + testes + build: tem que passar antes de todo PR
npm run chave -- <arquivo> <chave> "texto em português" "text in English"
```

Node 22.12 ou mais novo. Stack: TypeScript estrito, Preact 11, Vite 8, Vitest.

## Regras (o teste e a revisão cobram)

1. **Nenhum texto de interface no código.** O texto vai para `locales/pt-BR/<arquivo>.json` **e** `locales/en/<arquivo>.json` (use `npm run chave`). No código: `t('<arquivo>.<chave>')`. Parâmetros com `{nome}`; plural com `chave.one`/`chave.other` e `{count}`. Exceção: o Maker chama `t('chave')` sem o prefixo `maker.`.
2. **Cabeçalho de licença** na 1ª linha de todo arquivo de código: `// SPDX-License-Identifier: MPL-2.0` (CSS: `/* … */`, HTML: `<!-- … -->`).
3. **Arte só por código**: nada de imagem pronta, gerada por IA ou baixada. Pixel art desenhada em TypeScript (veja `scripts/arte/gerar.mjs` e `packages/interface/src/acervo.ts`, `desenharCapa`).
4. **Celular e tema escuro**: funciona em 360 px sem rolagem lateral e nos dois temas. Cores só pelos tokens do Guia de Arte (`var(--papel)`, `var(--tinta)`, `var(--destaque)`…); a paleta de cada app fica em `apps/<app>/src/tema.css`.
5. **Casca comum**: topo com `AcoesTopo` (botões só com ícone, com `title` e `aria-label`), rodapé `RodapeEkfrase`, conta por `useConta`/`FormConta`. Não crie login próprio.
6. **Arquivos são `.ekfr`**: grave com `gravarEkfr`, abra com `identificar` + `podeAbrir`; app novo que grava arquivo entra no `REGISTRO`.
7. **TypeScript estrito**, sem `any`; dado de fora (arquivo, rede) é conferido antes de usar.
8. Commits com `git commit -s` (DCO); PR contra o `main`.

## Criar um app novo

Copie a estrutura de `apps/biblioteca` (é o app mais curto) e siga o passo a passo de `docs/DESENVOLVER.md` §5. O que entra: `apps/<id>/` (com `base: '/<id>/'` no `vite.config.ts`), `locales/*/<id>.json`, a logo em `scripts/arte/gerar.mjs`, o app nos scripts `build` e `typecheck` do `package.json`.
