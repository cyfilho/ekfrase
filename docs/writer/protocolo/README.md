# Protocolo de sincronização do Ekfrase Writer (versão 1)

Esta é a **especificação** do que um aparelho (o app do Writer, a casca do computador, o futuro
Writer Lite em Rust) precisa fazer para guardar e sincronizar textos de modo que **todos os
aparelhos cheguem ao mesmo estado e nenhum texto se perca**. Foi escrita para quem vai implementar
em outra linguagem, sem ler o código em TypeScript.

- A implementação de referência é `packages/writer-nucleo` (`hlc.ts`, `uuid.ts`, `ordem.ts`,
  `conflito.ts`, `armazem.ts`, `sincronizador.ts`).
- **`cliente/*.json`** são os **casos de conformidade do aparelho**: dados puros, com entrada e
  saída esperada. Uma implementação está conforme quando passa por todos (o núcleo passa em
  `tests/writer-protocolo.test.ts`). O §8 diz como ler cada arquivo.
- **`servidor/`** tem os casos de conformidade do **servidor** (as rotas do §7), com um README
  próprio. O servidor não lê o conteúdo dos registros: tudo o que está nos §2 a §6 é trabalho do
  aparelho.

Palavras usadas: **aparelho** = uma instalação do app (um navegador, um computador, um pendrive);
**registro** = uma história, um capítulo, uma cena, uma ideia ou um personagem; **lápide** = um
registro marcado como apagado (ele continua existindo).

---

## 1. O registro

```json
{
  "id": "0193a5c0-0000-7000-8000-000000000003",
  "colecao": "cenas",
  "versao": "1794480002000-0000-bbbbbbbb",
  "apagado": false,
  "dados": {
    "historia": "0193a5c0-0000-7000-8000-000000000001",
    "titulo": "A chegada",
    "texto": "Era noite.",
    "_v": { "historia": "1794480000000-0000-aaaaaaaa", "titulo": "1794480002000-0000-bbbbbbbb", "texto": "1794480000000-0000-aaaaaaaa" }
  }
}
```

| Campo | O quê |
|---|---|
| `id` | UUID v7 (RFC 9562) em minúsculas: `^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$`. Os 48 primeiros bits são o tempo de criação em ms. Nunca muda |
| `colecao` | `historias`, `capitulos`, `cenas`, `ideias` ou `personagens`. A coleção de um `id` nunca muda |
| `versao` | HLC (§2) da última gravação do registro |
| `apagado` | a lápide. Apagar **não** remove os `dados` |
| `dados` | objeto JSON com os campos da coleção (abaixo) e `_v`. O servidor guarda sem ler |
| `dados._v` | **as versões por campo**: `{ "<campo>": "<HLC>" }`. A chave `apagado` guarda a versão da lápide |

**Campos de cada coleção** (todos opcionais na rede: o que falta vale o padrão entre parênteses;
campos desconhecidos são preservados e mesclados como os outros):

| Coleção | Campos |
|---|---|
| `historias` | `titulo`, `subtitulo`, `genero`, `formato`, `logline`, `sinopse`, `tema`, `publico`, `ponto_vista`, `tempo_verbal` (texto, `""`); `meta_palavras` (inteiro, `0`); `capa` (objeto ou `null`) |
| `capitulos` | `historia` (id); `titulo`, `resumo` (texto); `ordem` (§6) |
| `cenas` | `historia` (id); `capitulo` (id ou `null` = cena solta, fora de capítulo); `titulo`, `resumo`, `objetivo`, `conflito`, `desfecho` (texto); `texto` (Markdown); `palavras`, `meta_palavras` (inteiro); `status` (`ideia`, `planejada`, `rascunho`, `escrita`, `revisada`, `final`; padrão `rascunho`); `ordem` (§6); `conflito_de` (id ou `null`), `conflito_aparelho` (8 hex ou `null`), `conflito_em` (ms ou `null`): só nas cópias de conflito (§5) |
| `ideias` | `historia` (id ou `null`); `tipo` (`premissa`, `personagem`, `cena`, `dialogo`, `cenario`, `titulo`, `reviravolta`, `imagem`, `outro`); `titulo`, `texto`; `etiquetas` (lista de textos); `fixada` (booleano); `virou_tipo` (`historia`, `cena`, `personagem` ou `null`); `virou_id` (id ou `null`) |
| `personagens` | `historia` (id); `nome`, `papel`, `desejo`, `necessidade`, `medo`, `notas` (texto) |

O histórico de versões de uma cena e as palavras escritas por dia **não** são sincronizados: ficam
só no aparelho.

**Texto bem formado.** Todo texto (valores e chaves de `dados`) tem de ser Unicode válido: metade
de um par UTF-16 sem a outra metade (um "surrogate" solto, que aparece quando se corta um texto por
unidade UTF-16 no meio de um emoji) vira U+FFFD (`�`) **ao gravar no aparelho** e de novo **ao
enviar**. O servidor faz o mesmo ao ler o pedido (`\ud83d` sem par vira `\ufffd`), para que um
registro assim não derrube o pedido inteiro.

### Gravar no aparelho
Cada gravação local é uma transação. Para cada registro tocado:
1. pega **uma** versão nova do relógio (§2); gravações da mesma transação usam a mesma;
2. para cada campo cujo valor **mudou** (comparação de valor JSON; a ordem das chaves de um objeto
   não conta): grava o valor e põe `_v[campo] = versão nova`. Campo que não mudou fica com a versão
   que tinha. Se nada mudou, o registro não é tocado;
3. se a lápide mudou (apagar ou trazer de volta): `_v["apagado"] = versão nova`;
4. `apagado` = a regra da lápide do §4.4 (logo: editar um registro apagado o traz de volta);
5. `versao` = a versão nova. O registro entra na **fila de saída**.

Em geral `versao` é a maior versão de `_v`. A exceção é o registro que sai de uma mescla (§4), que
ganha uma versão nova e maior que todas.

Além do registro, o aparelho guarda para cada um: **`base`** (a `versao` que o servidor tem,
segundo a última notícia; `null` se o servidor nunca viu), **`baseV`** (o `_v` dessa versão) e se
está **pendente** (na fila). E guarda o **cursor** do servidor (§7).

---

## 2. A versão: relógio híbrido (HLC)

```
"<tempo em ms, 13 dígitos decimais com zeros à esquerda>-<contador, 4 hex minúsculos>-<aparelho, 8 hex minúsculos>"
^\d{13}-[0-9a-f]{4}-[0-9a-f]{8}$
```

**Comparar versões é comparar texto**, caractere a caractere (ASCII). O formato garante que isso
ordena por tempo, depois por contador, depois por aparelho.

O **aparelho** são 8 hex ao acaso, sorteados uma vez por instalação (por banco de dados local) e
guardados. O relógio tem dois números, `tempo` e `contador`, guardados entre sessões (basta
guardar a última versão dada ou absorvida).

**Gerar** (`agora`), com `f` = o relógio do sistema em ms, arredondado para baixo, mínimo 0:
1. se `f > tempo`: `tempo = f`, `contador = 0`;
2. senão, se `contador = 0xffff`: `tempo = tempo + 1`, `contador = 0`;
3. senão: `contador = contador + 1`;
4. a versão é `tempo`, `contador` e o id deste aparelho.

**Absorver** uma versão vista (toda versão que chega do servidor, antes de usá-la): se o `tempo`
dela é maior que o do relógio, ou é igual e o `contador` dela é maior, o relógio passa a ter o
`tempo` e o `contador` dela. O id de aparelho dela não é copiado.

Consequências, que os casos cobram: a versão nunca anda para trás, mesmo que o relógio do sistema
ande; e a próxima versão gerada é sempre maior que qualquer uma já vista.

---

## 3. O que o aparelho faz com um registro que vem do servidor

Vale para os registros de `GET escrita/mudancas` e para o `servidor` de um resultado `conflito`.
Seja `S` o registro do servidor e `L` o que o aparelho tem com o mesmo `id`:

1. `S` malformado (id, coleção, versão ou `dados` fora do §1): ignora.
2. Absorve `S.versao` no relógio.
3. Não existe `L`: guarda `S`; `base = S.versao`, `baseV = S.dados._v`; não pendente.
4. `L.colecao ≠ S.colecao`: ignora.
5. `L` **não está pendente**, ou `L.versao = S.versao`: `S` substitui `L` (como no passo 3).
6. `L` está pendente e `L.base = S.versao`: o servidor não tem novidade; `L` continua na fila.
   (Se `L.versao ≤ S.versao`, o que só acontece com relógio estragado, `L` ganha uma versão nova.)
7. Senão: **mescla** (§4) com `local = L`, `servidor = S`, `baseV = L.baseV`.
   - Resultado `igualAoServidor`: `S` substitui `L` (como no passo 3).
   - Senão: `L` passa a ter os `dados` e o `apagado` da mescla, **`versao` nova do relógio**,
     `base = S.versao`, `baseV = S.dados._v`, e continua pendente.
   - Se a mescla devolveu uma `copia` e o aparelho ainda **não tem** um registro com o `id` dela:
     cria a cópia como registro novo, pendente, com `base = null`.
8. **A história volta junto.** Depois de aplicar todos os registros: se um capítulo, uma cena ou
   um personagem que mudou agora está **vivo** e a história dele (`dados.historia`) está
   **apagada** (um aparelho apagou a história; outro, sem saber, continuou escrevendo, e a edição
   mais nova trouxe o registro de volta pela regra da lápide), a história volta, e com ela tudo o
   que tinha a mesma versão de lápide (`_v["apagado"]`) que ela: o que foi apagado junto. Cada um
   ganha `apagado = false`, `_v["apagado"]` = versão nova, `versao` = a mesma versão nova, e entra
   na fila. Sem isso a cena viva ficaria sem caminho na tela.

---

## 4. A mescla

Função pura: `mesclar(local, servidor, baseV) → { dados, apagado, igualAoServidor, copia }`.
Sejam `vl = local.dados._v` e `vs = servidor.dados._v` (objeto vazio se faltar). Versão ausente
vale `""` (menor que todas).

### 4.1 Campo a campo
Para cada nome de campo que aparece em `local.dados`, `servidor.dados`, `vl` ou `vs`, menos `_v` e
`apagado`:
- **vence o lado de versão maior**; no empate vence o servidor, a não ser que o servidor não tenha
  o campo;
- o valor do campo é o do lado que venceu (se esse lado não tem o campo, ele fica ausente);
- `_v[campo]` = a maior das duas versões (se houver alguma).

Listas e objetos (`etiquetas`, `capa`) são um valor só: não se mesclam por item.

### 4.2 Só em `cenas`: `palavras` acompanha o `texto`
Se a mescla tratou o campo `texto`, o valor de `palavras` é o do lado que venceu em `texto` (se
esse lado tiver `palavras`), qualquer que seja a versão de `palavras`.

### 4.3 Só em `cenas`: o conflito de texto
Ver §5. É aqui que `copia` é decidida.

### 4.4 A lápide
- `_v["apagado"]` = a maior entre `vl["apagado"]` e `vs["apagado"]` (se houver alguma).
- Candidato: o `apagado` do lado com `_v["apagado"]` maior; no empate, apagado se **algum** dos
  dois lados estiver apagado.
- **Regra da lápide:** o registro só fica apagado se o candidato é apagado **e nenhum outro campo
  tem versão maior que `_v["apagado"]`**. Uma edição mais nova que a lápide traz o registro de
  volta (quem escreveu depois não perde o que escreveu); uma lápide mais nova que a edição vence.

### 4.5 `igualAoServidor`
Verdadeiro quando `apagado`, `_v` e todos os campos do resultado são iguais (valor JSON) aos do
registro do servidor. Nesse caso não há o que enviar.

A mescla é **simétrica**: trocar `local` por `servidor` dá os mesmos `dados`, o mesmo `apagado` e
a mesma `copia`. É isso que faz dois aparelhos chegarem ao mesmo estado.

---

## 5. Conflito no texto de uma cena: a cópia de conflito

**O texto de uma cena nunca é jogado fora.** Sejam `tl = vl["texto"]`, `ts = vs["texto"]` e
`tb = baseV["texto"]` (`""` se `baseV` é `null` ou não tem o campo). Há conflito de texto quando
**todas** estas condições valem:

1. `tl ≠ ts`, `tl ≠ tb` e `ts ≠ tb` (os dois lados mudaram o texto desde a base comum);
2. `tl` e `ts` **não são do mesmo aparelho** (se as duas são HLC bem formados com o mesmo id de
   aparelho, não há conflito: o texto mais novo foi escrito por cima do mais antigo, no mesmo
   lugar; acontece quando a resposta de um envio se perde e a pessoa segue escrevendo);
3. os dois textos são diferentes (texto ausente vale `""`);
4. o lado que **perdeu** em `texto` (§4.1) não está apagado, e o texto dele não é vazio nem só
   espaços em branco.

Com conflito, o texto que venceu fica na cena (é o resultado normal do §4.1) e `copia` é a **cópia
de conflito** feita do registro `P` que perdeu:

- `v` = `P.dados._v["texto"]` (ou `P.versao`, se faltar); `tempo` e `aparelho` = as partes de `v`;
- `id` = **UUID v7 determinístico**: os 6 primeiros bytes são `tempo` (48 bits, do byte mais alto
  para o mais baixo); os outros 10 são os 10 primeiros bytes do **SHA-256** do texto (UTF-8)
  `ekfrase-writer:conflito:<P.id>:<v>`; por cima, a versão (`byte[6] = (byte[6] & 0x0f) | 0x70`) e
  a variante (`byte[8] = (byte[8] & 0x3f) | 0x80`);
- `colecao = "cenas"`, `versao = v`, `apagado = false`;
- `dados`: de `P.dados`, os campos `capitulo`, `historia`, `palavras`, `status`, `texto` e
  `titulo` (os que existirem); mais `conflito_de = P.id`, `conflito_aparelho = aparelho`,
  `conflito_em = tempo` (número); mais `ordem = P.dados.ordem + "V"` (logo depois da cena; §6);
- `dados._v`: **todos** os campos da cópia com a versão `v`.

A cópia é uma cena irmã comum (mesma história, mesmo capítulo). O título é o da cena: o app, ao
mostrar, acrescenta a marca "(cópia de conflito — aparelho, data)" no idioma da pessoa, a partir
de `conflito_aparelho` e `conflito_em`. Quando a pessoa aceita a cópia como cena comum, o app
grava `conflito_de`, `conflito_aparelho` e `conflito_em` como `null`.

**Por que não nasce cópia em cascata:** o `id`, a `versao` e o conteúdo da cópia dependem só do
registro que perdeu. Dois aparelhos que resolvem o mesmo conflito criam a **mesma** cópia: o
segundo a enviar recebe `aceito` sem regravar (regra 2 do §7). Um aparelho que já tem um registro
com aquele `id` não cria outro (§3, passo 7). Com três textos em disputa, os dois que perdem viram
duas cópias diferentes, e os três sobrevivem.

Ressalva conhecida: dois aparelhos podem montar a mesma cópia a partir de registros que diferem
num campo que não é o texto (por exemplo o título). O `id`, a `versao` e o **texto** são sempre os
mesmos; nos outros campos vale a cópia que chegou primeiro ao servidor.

---

## 6. `ordem`: índice fracionário

`ordem` é um texto. Os irmãos (capítulos de uma história; cenas de um capítulo; cenas soltas de
uma história) são mostrados em ordem crescente de `ordem`, **comparada como texto ASCII**; no
empate, pelo `id`. Para pôr um registro entre dois vizinhos gera-se uma chave entre as deles:
mover muda **um registro só**.

**Alfabeto** (base 62, na ordem ASCII): `0-9`, `A-Z`, `a-z`. `0` é o zero; `z` é o maior dígito.

**Forma da chave:** parte inteira + fração.
- A 1ª letra diz o tamanho da parte inteira (contando a própria letra): `a` = 2, `b` = 3 … `z` =
  27; e, para trás, `Z` = 2, `Y` = 3 … `A` = 27. Assim `A000…` < … < `Zz` < `a0` < `a1` < … <
  `az` < `b00` < … quando comparadas como texto.
- A fração são zero ou mais dígitos e **não termina em `0`**.
- Chave válida: não vazia; 1ª letra em `A-Z` ou `a-z`; comprimento ≥ o da parte inteira; só
  caracteres do alfabeto; fração sem `0` no fim; e não é o menor inteiro sozinho (`A` + 26 zeros).

**`meio(a, b)`**: uma fração entre as frações `a` e `b` (`b` pode ser "sem limite"):
1. Se há `b`: seja `n` o tamanho do prefixo comum de `a` e `b`, tratando `a` como se continuasse
   com zeros. Se `n > 0`: devolve esse prefixo de `b` + `meio(resto de a, resto de b)`.
2. `da` = o valor do 1º dígito de `a` (0 se `a` é vazio); `db` = o do 1º dígito de `b` (62 se não
   há `b`).
3. Se `db − da > 1`: devolve o dígito de valor `⌊(da + db + 1) / 2⌋`.
4. Senão, se há `b` e ele tem mais de um dígito: devolve o 1º dígito de `b`.
5. Senão: devolve o dígito `da` + `meio(a sem o 1º dígito, sem limite)`.

**`incrementar(inteiro)`**: soma 1 aos dígitos depois da 1ª letra, em base 62. Se estourar (todos
viraram `0`): `Z…` vira `a0`; `z…` não tem seguinte; nos outros casos a 1ª letra passa à seguinte
e a parte inteira ganha um dígito `0` se a letra nova é minúscula depois de `a`, ou perde um se é
maiúscula. **`decrementar`** é o espelho: tira 1; se emprestar (todos viraram `z`): `a…` vira
`Zz`; `A…` não tem anterior; nos outros casos a 1ª letra passa à anterior e a parte inteira ganha
um dígito `z` se a letra nova é maiúscula antes de `Z`, ou perde um se é minúscula.

**`entre(a, b)`** (`null` = sem vizinho daquele lado). Erro se alguma chave é inválida ou `a ≥ b`.
Sejam `ia`, `fa` a parte inteira e a fração de `a` (idem `ib`, `fb`):
- os dois `null` → `a0`;
- só `a` é `null`: se `ib` é o menor inteiro → `ib + meio("", fb)`; se `fb` não é vazia → `ib`;
  senão `d = decrementar(ib)` (se `d` for o menor inteiro, `d + "V"`);
- só `b` é `null`: `incrementar(ia)`; se não houver, `ia + meio(fa, sem limite)`;
- os dois: se `ia = ib` → `ia + meio(fa, fb)`; senão `i = incrementar(ia)`: se `i < b` → `i`;
  senão `ia + meio(fa, sem limite)`.

Para criar várias de uma vez (importar): cada chave é `entre(a anterior, b)`.

**A cópia de conflito** usa `ordem da cena + "V"` (sem consultar os vizinhos, para que todo
aparelho chegue à mesma chave). Chaves repetidas entre irmãos são toleradas (desempata o `id`); ao
inserir ao lado de vizinhos com chaves iguais ou inválidas, o núcleo usa `vizinho + "V"`.

---

## 7. A rede

Todas as rotas em `<base>/api/v1/`, com a sessão da conta Ekfrase (cookie). Todo `POST` leva o
cabeçalho `X-CSRF-Token` com o token que vem no campo `csrf` das respostas (para ter o primeiro,
`GET conta/eu`); se a resposta for o erro `csrf`, ela já traz o token novo: repete o pedido uma
vez. Respostas: `{ "ok": true, … }` ou `{ "ok": false, "erro": "<código>" }`.

Coleções sincronizadas: `historias`, `capitulos`, `cenas`, `ideias`, `personagens`.

**`GET escrita/servidor`** (sem login) → `{ ok, nome, versaoProtocolo: 1, aceitaCadastro }`.
Serve para "conectar a outro servidor": confirma que o endereço é de um servidor Ekfrase e que
fala este protocolo.

**`GET escrita/mudancas?desde=<inteiro ≥ 0, padrão 0>&limite=<1 a 500, padrão 500>`** (login; sem
ele, 401 `login`) → `{ ok, registros: [ { id, colecao, versao, apagado, dados, seq } ], cursor, mais }`.
Só os registros da conta, com `seq > desde`, em ordem crescente de `seq`. `seq` é um número
crescente do servidor, que muda a cada gravação aceita. `cursor` = o maior `seq` devolvido (ou o
próprio `desde`, se não veio nada). `mais` = sobrou: pedir de novo com `desde = cursor`.

**`POST escrita/enviar`** (login + CSRF), corpo `{ registros: [ { id, colecao, versao, apagado, dados, base } ] }`,
de 1 a 500 registros (mais: erro `muitos`; lista ausente ou vazia: erro `vazio`). `base` = a
`versao` do servidor que o aparelho conhecia (§1), ou `null`.
→ `{ ok, resultados: [ … na mesma ordem … ], cursor }`. Cada resultado é um destes:

| Resultado | Quer dizer | O aparelho |
|---|---|---|
| `{ id, estado: "aceito", seq }` | gravou, ou já tinha essa mesma `versao` | `base` = a versão enviada, `baseV` = o `_v` enviado; sai da fila **se não mudou depois** de enviado |
| `{ id, estado: "conflito", servidor: { id, colecao, versao, apagado, dados, seq } }` | não gravou | trata `servidor` como no §3 e reenvia (com `base = servidor.versao`) |
| `{ id, estado: "recusado", erro: "invalido" \| "grande_demais" }` | registro malformado, coleção diferente da gravada, ou JSON com mais de 5 MB | guarda o registro, tira da fila e avisa a pessoa; volta à fila quando for editado |

A regra do servidor para cada registro (numa transação, com a linha travada):
1. não existe linha (conta, id) → grava, `aceito`;
2. existe e a `versao` gravada = a recebida → `aceito` **sem regravar** (devolve o `seq` atual);
3. existe, `base` = a `versao` gravada e a `versao` recebida é maior (texto) → regrava com `seq`
   novo, `aceito`;
4. qualquer outro caso → `conflito`, com a linha do servidor.

A chave é (conta, id): outra conta que mande o mesmo `id` grava a sua própria linha e nunca vê a
da primeira.

Erros do pedido inteiro que o aparelho precisa conhecer: `login` (a sessão caiu: parar de tentar
até a pessoa entrar), `csrf`, `vazio`, `muitos`, `grande` (o pedido não coube: dividir o lote ao
meio e reenviar; um registro sozinho que não cabe conta como `grande_demais`), `cota` (a conta
ficou sem espaço), e `rede`/`servidor` do lado do aparelho (sem resposta, ou resposta fora deste
contrato).

Um registro estragado pode fazer o servidor não conseguir ler o pedido inteiro (`vazio` ou `dados`
num pedido que tinha registros). O aparelho então divide o lote, como no `grande`, até achar o
culpado: o registro que sozinho ainda falha fica **recusado** (`invalido`) e guardado no aparelho;
os outros sobem. Se nenhum pedaço passar, o problema é do servidor: o aparelho trata como erro do
pedido e tenta de novo depois, sem recusar nada.

### O ciclo de sincronização
1. **Puxar:** `mudancas` a partir do cursor guardado; aplicar cada registro (§3); guardar o cursor
   novo; repetir enquanto `mais` (parar se o cursor não andou).
2. **Enviar:** a fila de saída em ordem, em lotes (o núcleo usa até 200 registros e cerca de 2 MB
   de JSON por pedido); tratar cada resultado.
3. Se ainda há fila (houve conflito, ou algo mudou no meio), repetir 1 e 2.

**Nunca perder a fila:** um registro só sai dela com `aceito` para a versão que está no aparelho.
Sem resposta, o aparelho tenta de novo em 10 s, 30 s, 1 min, 2 min e 5 min (e fica nos 5 min), e
imediatamente quando a rede volta. Reenviar é seguro (regra 2). Os registros que o próprio
aparelho enviou voltam em `mudancas` (o `seq` deles é maior que o cursor): pelo passo 5 do §3 isso
não muda nada.

**Contas no mesmo aparelho:** cada conta tem o seu banco local (e o seu cursor); quem escreve sem
conta usa um banco próprio. Ao entrar numa conta, os registros desse banco são levados para o da
conta como pendentes com `base = null`.

---

## 8. Os casos de conformidade (`cliente/`)

Cada arquivo tem um campo `descricao` que repete o resumo abaixo.

| Arquivo | Seção | Como aplicar |
|---|---|---|
| `hlc.json` | §2 | `gerar`: criar o relógio com `aparelho` e `ultimo` (a última versão guardada, ou `null`) e seguir `passos`: `{op:"agora", fisico}` gera com o relógio do sistema valendo `fisico` e tem de dar `espera`; `{op:"absorver", versao}` absorve. No fim, a última versão do relógio (com o id deste aparelho) = `ultimoNoFim`. `comparar`: −1, 0 ou 1. `maior`: a maior da lista (`""` se vazia). `formato`: bem formado ou não |
| `mesclar.json` | §4 | `casos`: `mesclar(entrada.local, entrada.servidor, entrada.baseV)` tem de dar `saida` (`dados` por valor JSON, `apagado`, `igualAoServidor`, `copia`) |
| `conflito-texto.json` | §5 | `casos`: como acima (os dois primeiros são o mesmo conflito com os papéis trocados). `copia`: a cópia feita de `perdedor` = `espera`. `id`: o UUID determinístico de `tempo` + `semente` = `espera` (`sha256` é o hash inteiro da semente, em hex, para conferir). `idDaCopia`: com a semente do §5. `lapide`: a regra do §4.4 aplicada a `apagado` (o candidato) e `v` |
| `ordem.json` | §6 | `entre`: `entre(a, b)` = `espera`, exatamente. `erro`: pares que têm de ser recusados. `valida`: chave bem formada ou não. `logoDepois`: `ordem + "V"`. `variasEntre`: `n` chaves, cada uma `entre(anterior, b)`. `sequencias`: `fim` = inserir 70 vezes no fim; `comeco` = 70 vezes no começo; `meio` = sempre entre a 1ª e a 2ª; cada lista vem em ordem crescente |

Os registros dos exemplos usam ids `0193a5c0-0000-7000-8000-<12 dígitos>` e aparelhos `aaaaaaaa`,
`bbbbbbbb`, `cccccccc`.

**Mudar o protocolo:** qualquer mudança nos §2 a §6 muda o resultado de quem já tem dados
gravados. Mudança compatível = caso novo aqui e no núcleo, no mesmo commit. Mudança incompatível =
`versaoProtocolo: 2` no servidor e um plano de migração.
