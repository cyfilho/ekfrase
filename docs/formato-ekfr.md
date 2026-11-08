# O arquivo `.ekfr` — especificação 1

O `.ekfr` é o **formato de arquivo de todos os apps da família Ekfrase**. Um arquivo diz sozinho de que app é, que tipo de documento guarda e em que versão. Com isso:

- todo app, ao abrir um `.ekfr`, sabe se consegue abrir, se o arquivo é de outro app (e de qual) ou se é de uma versão mais nova;
- quem roteia arquivos (como o "Abrir um arquivo .ekfr" de `ekfrase.com/#/apps`) manda cada arquivo ao app certo.

Implementação de referência: [`packages/arquivo`](../packages/arquivo) (`@ekfrase/arquivo`, MPL-2.0). Testes: [`tests/arquivo.test.ts`](../tests/arquivo.test.ts).

| | |
|---|---|
| Extensão | `.ekfr` (a antiga `.ekfrase`, do Maker, continua abrindo) |
| Tipo de mídia | `application/vnd.ekfrase.ekfr+zip` |
| Recipiente | ZIP (deflate ou guardado) |
| Versão do envelope | `1` |

## 1. O que vai dentro do ZIP

| Entrada | Obrigatória | O que é |
|---|---|---|
| `mimetype` | sim, **a 1ª entrada, sem compressão** | o texto `application/vnd.ekfrase.ekfr+zip`, sem quebra de linha |
| `ekfr.json` | sim, **a 2ª entrada, sem compressão** | o **envelope** (§2) |
| `preview.png` | não | miniatura (até 512 px no lado maior), mostrada em listas e no gerenciador de arquivos |
| qualquer outro nome | — | o conteúdo do app, no formato que ele quiser |

`mimetype`, `ekfr.json` e `preview.png` são **nomes reservados**: o app não usa esses nomes para outra coisa.

Como `mimetype` vem primeiro e sem compressão, um programa reconhece o arquivo **lendo só os primeiros bytes** (como no EPUB e no ODF): o nome `mimetype` fica no byte 30 e o tipo de mídia logo depois. Como o envelope também vem sem compressão, dá para lê-lo sem descompactar nada.

## 2. O envelope (`ekfr.json`)

```json
{
  "ekfr": 1,
  "app": "maker",
  "tipo": "mundo",
  "formato": "1.0.0",
  "gravadoPor": "maker-web@0.1.0",
  "titulo": "Terras do Norte",
  "criado": "2026-11-08T21:30:00Z",
  "modificado": "2026-11-09T10:02:11Z"
}
```

| Campo | Obrigatório | Regra |
|---|---|---|
| `ekfr` | sim | a versão do envelope (inteiro). Hoje `1`. Quem lê recusa um envelope de versão maior que a sua (erro `envelope-novo`) |
| `app` | sim | o **id do app dono**: minúsculas, números e hífen (`^[a-z][a-z0-9-]{0,39}$`). É também a pasta do app (`apps/<id>`) e o endereço na web (`ekfrase.com/<id>/`) |
| `tipo` | sim | o tipo de documento **dentro do app** (mesma regra do `app`). Um app pode ter vários tipos (ex.: Persis: `rotina`, `baralho`) |
| `formato` | sim | a versão do formato DESSE tipo, em semver (`1.4.0`). **Maior novo = incompatível**: o app que só conhece o maior 1 não abre o 2. Menor novo abre (campos novos são ignorados por quem não os conhece) |
| `gravadoPor` | sim | quem gravou: `<app>-<plataforma>@<versão>` (`maker-web@0.1.0`, `persis-desktop@1.2.0`) |
| `titulo` | não | o nome do documento, para listas |
| `criado`, `modificado` | não | datas ISO 8601 em UTC |

Campos novos no envelope só entram como **opcionais** (sem mudar `ekfr`). Mudança incompatível no envelope = `ekfr: 2`.

## 3. O registro: quem abre o quê

O registro fica em [`packages/arquivo/src/registro.ts`](../packages/arquivo/src/registro.ts):

```ts
{ id: 'maker', endereco: '/maker/', abre: [{ tipo: 'mundo', maior: 1 }] }
```

Cada app diz que **tipos** abre e até que **versão maior** do formato. Um app pode abrir tipos de outro app (ex.: um visualizador). As funções:

- `identificar(bytes)` → o envelope, ou um código de erro: `nao-e-ekfr`, `sem-envelope`, `envelope-invalido`, `envelope-novo`, `grande`.
- `podeAbrir(idDoApp, envelope)` → `{ abre: true }` ou o motivo:
  - `outro-app`: o arquivo é de outro app, e o resultado diz qual;
  - `versao-nova`: é deste app, mas de um formato com versão maior mais nova;
  - `tipo-desconhecido`: é deste app, mas de um tipo que ele não conhece;
  - `app-desconhecido`: é de um app que ainda não está no registro.
- `quemAbre(envelope)` → o app que abre, ou o motivo de nenhum abrir (usado por quem roteia arquivos).

**App novo que grava arquivos = uma linha no registro** (o teste confere que `apps/<id>` existe e que o endereço é `/<id>/`).

## 4. Abrir um arquivo (o que todo app faz)

1. `identificar(bytes)`. Se der erro, mostrar o texto do código.
2. `podeAbrir('<meu-id>', envelope)`:
   - `abre` → abrir;
   - `outro-app` → dizer **de qual app** é e oferecer abrir lá (§5);
   - `versao-nova` → pedir para atualizar o app;
   - `tipo-desconhecido` ou `app-desconhecido` → explicar e não abrir pela metade.
3. Ao gravar: `gravarEkfr(envelope, arquivos, { preview })` e baixar com `nomeDeArquivo(titulo)`.

Regras de segurança, que valem para todo app:
- Nunca executar nada que venha no arquivo.
- Limite descompactado por entrada (`MAX_ENTRADA`, 256 MB), contra "bombas" de ZIP.
- Conferir o próprio conteúdo antes de usar. O envelope só diz de quem é o arquivo; ele não garante que o conteúdo seja bom.

## 5. Entregar um arquivo a outro app

**Na web**, todos os apps moram em `ekfrase.com`, então dividem o mesmo IndexedDB:

1. Quem entrega chama `entregar(bytes, nome)`. A função guarda o arquivo no banco `ekfrase-entrega`, loja `arquivos`, e devolve uma chave (UUID). A entrega vence em 10 minutos.
2. Quem entrega abre `/<app>/#/abrir/<chave>` (função `enderecoDaEntrega`).
3. O app que recebe lê `chaveNoEndereco()`, chama `receber(chave)` (o arquivo sai do banco) e segue o §4.

## 6. Formatos antigos

Os arquivos de antes do envelope são reconhecidos pela forma e ganham um envelope deduzido (`legado: true`).

| Formato antigo | Como é reconhecido | Envelope deduzido |
|---|---|---|
| `.ekfrase` do Maker (até 11/2026) | ZIP com `manifest.json` (`formatVersion`, `generator`, `app`) e/ou `doc.crdt` | `app: maker`, `tipo: mundo`, `formato` = `formatVersion` |

## 7. O que já usa

| App | Tipo | Formato | Conteúdo depois do envelope |
|---|---|---|---|
| Maker | `mundo` | 1.0.0 | `manifest.json` (gerador e plugins), `doc.crdt` (Yjs), `preview.png` |

App novo que grava arquivos entra nesta tabela e no registro.
