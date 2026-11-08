# Desenvolver para a família Ekfrase

Para quem quer **criar um app novo** para a família, **melhorar um app daqui** ou **desenvolver a partir dele**, seja você uma pessoa ou uma IA. O resumo de uma página está no [`AGENTS.md`](../AGENTS.md); aqui vai o detalhe.

## 1. Os princípios

- **Livre e gratuito.** Código MPL-2.0; os textos da Biblioteca, CC BY-SA 4.0.
- **Dois idiomas desde o primeiro dia** (pt-BR e en). Um idioma novo é só copiar `locales/en/` e traduzir.
- **Celular primeiro, tema claro e escuro.**
- **Arte só por código.** Pixel art desenhada em TypeScript; nenhuma imagem pronta.
- **Uma casca comum.** O mesmo topo, rodapé, conta e feedback em todos os apps (`packages/interface`).
- **Um formato de arquivo.** O `.ekfr`, que diz de qual app é ([`formato-ekfr.md`](formato-ekfr.md)).
- **Uma conta só.** A do ekfrase.com, e opcional sempre que dá.

## 2. Rodar

```sh
npm install
npm run maker | npm run biblioteca | npm run vernakula
npm run conferir     # tipos + testes + build
```

O servidor do ekfrase.com (contas e nuvem) não está neste repositório, então os apps rodam em **modo local**, sem conta (ver o README). As chamadas ao servidor ficam em `packages/interface/src/ponte.ts`; no site, elas vão para `ekfrase.com/api/v1/`.

## 3. As regras (a lista que todo app cumpre)

**Estrutura**
- [ ] O app mora em `apps/<id>/`, com o `<id>` em minúsculas e sem acento. No site, ele fica em `ekfrase.com/<id>/`.
- [ ] No `vite.config.ts`: `base: '/<id>/'`, uma porta própria e o proxy `'/api'` (para o servidor, quando houver).
- [ ] `package.json` (nome `@ekfrase/<id>`, licença `MPL-2.0`), `tsconfig.json` (estende `../../tsconfig.base.json`), `index.html`.
- [ ] A 1ª linha de todo arquivo de código é o cabeçalho de licença: `// SPDX-License-Identifier: MPL-2.0`.
- [ ] TypeScript estrito, sem `any`. Dado que vem de fora (arquivo, rede) é conferido antes de usar.

**Textos**
- [ ] **Nenhum texto de interface no código.** Os textos ficam em `locales/pt-BR/<id>.json` e `locales/en/<id>.json`, e o código chama `t('<id>.chave')`.
- [ ] Grave os dois idiomas de uma vez: `npm run chave -- <id> chave "português" "english"` (ou `--lote arquivo.json`).
- [ ] Use `{parametro}` no texto, nunca concatenação. Plural: `chave.one` e `chave.other`, com `{count}`.

**Aparência**
- [ ] Use o Guia de Arte: importe `@ekfrase/nucleo/estilo/tokens.css` e `base.css`; a paleta própria fica em `src/tema.css`, trocando só os tokens (claro e escuro).
- [ ] A logo é pixel art desenhada por código, em `scripts/arte/gerar.mjs` (veja `logoBiblioteca()`).
- [ ] Botões do topo só com ícone, com `title` e `aria-label`: `AcoesTopo`. O rodapé é o `RodapeEkfrase`.
- [ ] Funciona com 360 px de largura, sem rolagem lateral, e no tema escuro.
- [ ] Tudo dá para fazer pelo teclado, o foco é visível e os campos têm `label`.

**Conta e arquivos**
- [ ] A conta é a do ekfrase.com: `useConta()`, `FormConta` e o cliente `ponte` de `@ekfrase/interface`. Não crie login próprio. Sem servidor, o app funciona em modo local o quanto der.
- [ ] Se o app grava arquivos, eles são `.ekfr`: uma linha no `REGISTRO` (`packages/arquivo/src/registro.ts`) e `gravarEkfr`/`identificar`/`podeAbrir`.

**Fechamento**
- [ ] O app entra nos scripts `build` e `typecheck` do `package.json` da raiz.
- [ ] `npm run conferir` passa.

## 4. Criar um app novo

O app de referência mais curto é a **Biblioteca**:

```
apps/<id>/
  index.html           ← <div id="app">, título, ícone
  package.json         ← @ekfrase/<id>; dependências @ekfrase/interface, @ekfrase/nucleo, preact
  tsconfig.json
  vite.config.ts       ← base '/<id>/', porta, proxy /api
  src/
    main.tsx           ← fontes, tokens.css, base.css, tema.css, iniciarIdioma, aplicarTema, render
    textos.ts          ← o tradutor (copie o da Biblioteca)
    tema.css           ← a paleta
    App.tsx            ← as telas
    img/logo-<id>.png  ← gerada por scripts/arte/gerar.mjs
locales/pt-BR/<id>.json e locales/en/<id>.json
```

O topo e o rodapé:

```tsx
import { AcoesTopo, RodapeEkfrase } from '@ekfrase/interface';
import { t, tr } from './textos.ts';

<header class="topo">
  <a class="marca" href="#/"><img src={logo} width={48} height={48} alt="" /><span>{t('<id>.nome')}</span></a>
  <AcoesTopo t={t} tr={tr} app="<id>" />
</header>
…
<RodapeEkfrase t={t} />
```

Gravar e abrir um arquivo:

```ts
import { gravarEkfr, identificar, podeAbrir } from '@ekfrase/arquivo';

const bytes = gravarEkfr({ app: '<id>', tipo: 'baralho', formato: '1.0.0', gravadoPor: '<id>-web@0.1.0', titulo }, { 'cartas.json': dados });

const id = identificar(bytesDoArquivo);
if (id.ok) {
  const v = podeAbrir('<id>', id.envelope);
  if (v.abre) { /* abrir */ } else if (v.motivo === 'outro-app') { /* oferecer abrir em v.app */ }
}
```

## 5. Desenvolver a partir de um app daqui

- **Um app novo baseado em outro:** copie a pasta e troque o `<id>`, os textos, a paleta, a logo e o `tipo` dos arquivos. Mantenha a licença MPL-2.0 e o cabeçalho SPDX nos arquivos copiados.
- **Um fork:** pode, a licença permite. O nome e as marcas Ekfrase não são cedidos pela licença do código, então um fork que vá ao ar com outro dono usa outro nome, para ninguém confundir com o ekfrase.com.

## 6. Usar uma IA

Dê à IA o link do repositório e peça para ela começar pelo `AGENTS.md`. Um prompt pronto:

```
Você vai criar um app para a família Ekfrase (https://github.com/cyfilho/ekfrase).
Comece pelo AGENTS.md e siga as regras dele À RISCA (textos só em locales/ pt-BR e en, arte só
por código, casca comum de @ekfrase/interface, 360 px e tema escuro, arquivos .ekfr).
Use apps/biblioteca como modelo de estrutura. O app: <descreva o app, as telas e quem usa>.
Entregue a pasta apps/<id>/, os locales/*/<id>.json e um LEIA-ME.md com o que foi feito, o que falta
e as decisões que você tomou. Rode npm run conferir no fim.
```

## 7. Como contribuir (e como funciona o código aberto aqui)

- Qualquer pessoa pode **ler e copiar** o repositório. **Editar** o repositório, só o mantenedor.
- Para propor uma mudança:
  1. Faça um **fork** (a sua cópia no GitHub).
  2. Crie um ramo e mude o que quiser na sua cópia.
  3. Abra um **pull request** contra o `main` daqui.
- O mantenedor revisa o PR, conversa com você nos comentários e decide se aceita (dá o Merge).
- Mudanças grandes ou um app novo: comece pelas **[Discussions](https://github.com/cyfilho/ekfrase/discussions)**, para alinhar antes de escrever muito código.
- Todo commit leva **DCO**: `git commit -s`. A linha `Signed-off-by` diz que você tem o direito de contribuir com aquele código. O GitHub confere.
- `npm run conferir` passa antes do PR.
- Escreva no PR o que mudou e como conferir; prints ajudam.
- Um app aceito aqui pode ir para o ekfrase.com. Pôr o app no castelo e publicar no site fica a cargo do mantenedor.
