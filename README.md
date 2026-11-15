# Ekfrase

**Apps livres e gratuitos para ensinar, aprender e criar.** Cada app mora em [ekfrase.com](https://ekfrase.com), dentro de um castelo em pixel art. Este repositório tem o **código-fonte dos apps** e o que eles dividem: a casca comum, os idiomas, o Guia de Arte e o formato de arquivo `.ekfr`.

*Free/libre apps for teaching, learning and creating, living at [ekfrase.com](https://ekfrase.com). This repository holds the apps' source code and what they share. English summary [below](#english).*

## Os apps

| App | O que faz | No ar |
|---|---|---|
| **Maker** (`apps/maker`) | mapas e worldbuilding: um planeta inteiro numa grade hexagonal, do continente à rua; arquivo `.ekfr` | [ekfrase.com/maker](https://ekfrase.com/maker/) |
| **Biblioteca** (`apps/biblioteca`) | obras em domínio público traduzidas (CC BY-SA 4.0), com leitor de EPUB próprio: modo foco, tema noturno, destaques, notas e download em EPUB, PDF, DOCX e TXT | [ekfrase.com/biblioteca](https://ekfrase.com/biblioteca/) |
| **Vernákula** (`apps/vernakula`) | a sala de aula de escolas de idiomas | [ekfrase.com/vernakula](https://ekfrase.com/vernakula/) |
| **Writer** (`apps/writer` + `packages/writer-nucleo`) | escrita focada: histórias, capítulos e cenas, banco de ideias, folha em tela cheia; funciona sem internet e todo pelo teclado; arquivo `.ekfr`, `.md` e `.docx` | [ekfrase.com/writer](https://ekfrase.com/writer/) |

Todos os apps têm:
- interface em português e inglês;
- tema claro e escuro;
- versão para celular;
- arte desenhada só por código;
- a mesma conta do ekfrase.com.

## Rodar

Precisa do [Node.js](https://nodejs.org/) 22.12 ou mais novo.

```sh
npm install
npm run maker        # http://127.0.0.1:5173/maker/
npm run biblioteca   # http://127.0.0.1:5330/biblioteca/
npm run writer       # http://127.0.0.1:5350/writer/
npm run conferir     # tipos, testes e build
```

O servidor do ekfrase.com (contas e nuvem) não faz parte deste repositório. No seu computador, os apps rodam em **modo local**, sem conta:
- **Maker:** o editor abre direto; Exportar e Importar `.ekfr` funcionam.
- **Biblioteca:** dá para ler e baixar os livros.
- **Vernákula:** depende do servidor, então mostra só a tela de entrar.
- **Writer:** escolha "Escrever sem conta": os textos ficam no navegador. O protocolo de sincronização está em `docs/writer/protocolo/`.

## Desenvolver

- **[`AGENTS.md`](AGENTS.md)**: o mapa, os comandos e as regras em uma página. É por ele que uma IA (ou você) deve começar.
- **[`docs/DESENVOLVER.md`](docs/DESENVOLVER.md)**: o guia completo, com as regras, como criar um app e como contribuir.
- **[`docs/formato-ekfr.md`](docs/formato-ekfr.md)**: o arquivo `.ekfr`, que diz de qual app ele é.
- Perguntas e ideias: **[Discussions](https://github.com/cyfilho/ekfrase/discussions)**. Erros: [Issues](https://github.com/cyfilho/ekfrase/issues).

## Licença

- Código: **MPL-2.0** ([`LICENSE`](LICENSE)).
- Textos traduzidos da Biblioteca (`biblioteca/`): **CC BY-SA 4.0**.
- O nome e as marcas Ekfrase não são cedidos pela licença do código.
- Contribuições com DCO (`git commit -s`).

---

## English

Ekfrase is a family of free/libre web apps (MPL-2.0):

- **Maker:** maps and worldbuilding on a hierarchical hex grid, from continents down to city streets.
- **Biblioteca:** public-domain books translated into Portuguese, with its own EPUB reader, highlights, notes and downloads.
- **Vernákula:** a language-school classroom.
- **Writer:** focused writing (stories, chapters, scenes, an idea bank), offline and keyboard-only friendly.

They share:
- a common shell;
- Portuguese and English UI;
- light and dark themes;
- mobile layouts;
- art drawn entirely in code;
- a file format, **`.ekfr`**, whose envelope says which app a file belongs to.

Stack: TypeScript, Preact, Vite and Vitest. The ekfrase.com server (accounts, cloud) is not part of this repository, so locally the apps run without an account.

The docs are in Brazilian Portuguese; start with [`AGENTS.md`](AGENTS.md). Questions in English are welcome in the Discussions.
