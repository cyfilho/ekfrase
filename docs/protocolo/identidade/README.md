<!-- SPDX-License-Identifier: MPL-2.0 -->
# A identidade por chaves (versão 1)

A especificação da identidade do núcleo Ekfrase (DEC-P077). A implementação de referência é `packages/identidade`;
os casos de conformidade são os `*.json` desta pasta (lidos por `tests/identidade.test.ts`). Só se combinam peças
conhecidas, cada uma com os vetores oficiais no teste: Ed25519 (RFC 8032), X25519 (RFC 7748), HKDF-SHA256 (RFC 5869),
XChaCha20-Poly1305 (draft-irtf-cfrg-xchacha-03), HPKE (RFC 9180), Argon2id (RFC 9106) e BIP39.

Convenções: `‖` é juntar bytes; `utf8("x")` são os bytes UTF-8 do texto; **b64u** é base64url **sem `=`** e
canônico (os bits de sobra do último caractere são zero; quem lê recusa qualquer outra escrita); **hex** é minúsculo.

## 1. A identidade
- **Semente:** 16 bytes (a pessoa; é o kit de 12 palavras, §6) ou 32 bytes sorteados (um aparelho).
- **Segredos:** `assinar = HKDF-SHA256(ikm = semente, sal = utf8("ekfrase/identidade/v1"), info = utf8("assinar"), 32)`
  e `cifrar = HKDF-SHA256(…, info = utf8("cifrar"), 32)`. `assinar` é a chave secreta (semente) do Ed25519; `cifrar`, a
  chave secreta do X25519 (o X25519 faz o "clamping").
- **Públicas:** `{ "assinar": b64u(Ed25519 pública), "cifrar": b64u(X25519 pública) }`. A de assinar tem de ser um ponto
  válido do Ed25519 na codificação estrita; a de cifrar, se for de ordem pequena, faz a troca X25519 dar zero, e quem
  fecha uma caixa recusa.
- **Endereço:** `hex(SHA-256(cifrar_pública ‖ assinar_pública)[0..16])`, 32 letras. É o `Identity.hash` do Reticulum
  (que também usa um par X25519 e um Ed25519); o segredo no formato do Reticulum é `cifrar ‖ assinar` (64 bytes).
- Casos: `chaves.json` (`identidades`).

## 2. Assinar com contexto
- `assinatura = Ed25519.sign(segredo_assinar, utf8("ekfrase/" + contexto) ‖ 0x00 ‖ mensagem)`, 64 bytes.
- O contexto casa com `^[a-z][a-z0-9-]{0,62}$`. Os de hoje: `certificado-aparelho`, `revogacao-aparelho`,
  `caixa-da-pessoa` (§9), `cofre-da-pessoa` (§10) e `sessao-aparelho` (§12) (os próximos: os envelopes, a lista de
  membros, os pacotes).
- **Conferir é estrito** (RFC 8032 §5.1.7, sem as folgas do ZIP-215): `S < L`, a pública e o `R` na codificação
  canônica, nada de ponto de ordem pequena, como no `crypto_sign_verify_detached` do libsodium. Ao ler as públicas
  (§1), uma chave de assinar de ordem pequena é recusada.
- Casos: `chaves.json` (`assinaturas`).

## 3. O JSON canônico (o que se assina)
Um subconjunto do RFC 8785 (JCS) que toda linguagem escreve igual:
- objetos com as chaves em ordem (pela unidade UTF-16; as nossas são ASCII, então é a ordem dos bytes), sem espaço;
- números **só inteiros** de −(2⁵³−1) a 2⁵³−1 (nada de fração, `-0`, `NaN`, infinito);
- textos em UTF-8 sem escapes além de `\"` e `\\`: um texto que tenha caractere de controle (U+0000 a U+001F, U+007F
  a U+009F), U+2028, U+2029 ou surrogate solto **não pode** ser assinado;
- `true`, `false`, `null` e listas como no JSON.

No PHP: ordenar com `ksort($v, SORT_STRING)` em cada objeto e `json_encode($v, JSON_UNESCAPED_SLASHES |
JSON_UNESCAPED_UNICODE)` (cuidado com o objeto vazio, que o `json_decode(…, true)` transforma em lista). Casos: `canonico.json`.

## 4. O certificado do aparelho e a revogação
```json
{ "v": 1, "pessoa": <públicas da pessoa>, "aparelho": <públicas do aparelho>, "nome": "Notebook da Ana",
  "criado": 1795000000000, "assinatura": "<b64u>" }
{ "v": 1, "pessoa": <públicas da pessoa>, "aparelho": "<endereço do aparelho>", "quando": 1795100000000,
  "assinatura": "<b64u>" }
```
- A assinatura é da **pessoa** (§2), com o contexto `certificado-aparelho` ou `revogacao-aparelho`, sobre o JSON
  canônico do objeto **sem** o campo `assinatura`. Exatamente esses campos: campo a mais ou a menos é `formato`.
- `nome`: em NFC, sem espaço nas pontas, de 1 a 60 caracteres (pontos de código), e que possa ser assinado (§3).
- `criado` e `quando`: milissegundos desde 1970 (inteiro ≥ 0). Servem para mostrar; nada depende da hora.
- **Conferir um aparelho:** (1) o certificado (formato e assinatura) → `formato` ou `assinatura`; (2) se se espera uma
  pessoa, o endereço das públicas dela → `outra-pessoa`; (3) qualquer revogação **válida** da mesma pessoa para o
  mesmo endereço → `revogado`. Revogação estragada, de outra pessoa ou de outro aparelho é ignorada.
- Casos: `certificados.json` (os objetos e as conferências esperadas).

## 5. A caixa para uma pessoa
- É o **HPKE** (RFC 9180) no modo base, numa mensagem só: KEM `0x0020` DHKEM(X25519, HKDF-SHA256), KDF `0x0001`
  HKDF-SHA256, AEAD `0x0003` ChaCha20-Poly1305. `info = utf8("ekfrase/caixa/" + contexto)`, `aad` vazio.
- **Formato:** `caixa = enc (32 bytes) ‖ cifrado (a mensagem + 16 bytes)`.
- O contexto casa com `^[a-z][a-z0-9-]{0,62}(:[A-Za-z0-9._-]{1,128}){0,4}$`. Os de hoje: `chave-doc:<doc>:<época>`
  (§7), `semente-da-pessoa` (um aparelho aberto entrega a semente da pessoa a um aparelho novo dela, §11) e
  `caixa-da-pessoa:<g>` (a geração `g` da chave de caixa, §9).
- A caixa não diz quem a fechou; quando importa, quem fecha assina por fora.
- Casos: `caixa.json` (com a chave de uso único fixa, para dar os mesmos bytes).

## 6. O kit de recuperação (as 12 palavras)
- As 12 palavras **são** a semente da pessoa: o BIP39 de 128 bits (16 bytes + 4 bits de conferência do SHA-256), com
  a lista oficial em **português** (2048 palavras sem acento; as 4 primeiras letras identificam cada uma) ou em inglês.
  As duas listas não têm palavra em comum: o idioma sai das palavras.
- Ao ler: NFKD, tirar as marcas (acentos), minúsculas, separar por tudo o que não é letra de `a` a `z`; cada palavra
  vale se estiver na lista ou se for o começo (4 letras ou mais) de exatamente uma palavra da lista.
- Erros: `quantidade` (não são 12), `palavra-desconhecida` (com as posições), `conferencia` (os 4 bits não batem).
- Casos: `kit.json`.

## 7. A chave de documento por época
- 32 bytes sorteados por documento e por época (a época 0 é a primeira; nasce uma nova quando alguém sai).
- **Cifrar:** XChaCha20-Poly1305 com nonce sorteado de 24 bytes; `cifrado = nonce ‖ texto cifrado (+16)`.
- **Dados associados:** `utf8("ekfrase/doc/v1") ‖ 0x00 ‖ utf8(doc) ‖ 0x00 ‖ época (u32, big-endian) ‖ aad`. O `doc`
  casa com `^[A-Za-z0-9._-]{1,128}$` (o UUID v7 do documento).
- **Entregar a chave:** a caixa (§5) para a pública de `cifrar` de quem recebe, contexto `chave-doc:<doc>:<época>`,
  com os 32 bytes dentro.
- Casos: `documento.json`.

## 8. O cofre com senha
- **Parâmetros:** `{ "alg": "argon2id", "m": <KiB>, "t": <passadas>, "p": <faixas>, "sal": b64u(16 bytes) }`.
  Aceitos: `19456 ≤ m ≤ 262144`, `2 ≤ t ≤ 10`, `1 ≤ p ≤ 4`; o padrão é `m = 19456, t = 2, p = 1` (o mínimo da OWASP).
  **Fora disso, recusar**, venham de onde vierem (um servidor não pode pedir um Argon2id fraco nem um enorme).
- **Da senha às chaves:** `mestra = Argon2id(senha em NFC, em UTF-8; sal; m, t, p; versão 0x13; 32 bytes)`;
  `entrar = HKDF-SHA256(ikm = mestra, sal = vazio, info = utf8("ekfrase/senha/entrar"), 32)` (vai ao servidor no
  login) e `cofre = HKDF-SHA256(…, info = utf8("ekfrase/senha/cofre"), 32)` (nunca sai do aparelho). No libsodium: o
  `crypto_pwhash` com `ALG_ARGON2ID13`, `opslimit = t` e `memlimit = m × 1024` (ele só faz `p = 1`).
- **O cofre:** `{ "v": 1, "kdf": <parâmetros>, "nonce": b64u(24 bytes), "cifrado": b64u(…) }`, com XChaCha20-Poly1305
  e a chave `cofre`; os dados associados são `utf8("ekfrase/cofre/v1") ‖ 0x00 ‖` o JSON canônico de `{"v":1,"kdf":…}`.
  Dentro, a semente da pessoa (16 bytes).
- **Trocar a senha:** abrir com a antiga e fechar com a nova, com sal novo; o servidor recebe a chave de entrar nova.
- Casos: `cofre.json` (a mestra, as duas chaves e um cofre que abre).

## 9. A chave de caixa da pessoa, por gerações (X2)
- As entregas para a **pessoa** (as chaves de documento dos convites, X4) não vão para a pública de `cifrar` da identidade
  (§1): vão para a **chave de caixa** da geração atual. A geração `g` (inteiro de 1 a 1 000 000) é
  `segredo = HKDF-SHA256(ikm = semente da pessoa, sal = utf8("ekfrase/caixa/v1"), info = utf8("geracao:" + g), 32)`, o
  segredo de um X25519. O kit refaz todas as gerações.
- **A declaração** (o que a ponte guarda e entrega a quem quer mandar uma chave):
  `{ "v": 1, "pessoa": <públicas>, "geracao": g, "cifrar": b64u(pública da geração), "quando": <ms>, "assinatura": "<b64u>" }`,
  assinada pela pessoa (§2, contexto `caixa-da-pessoa`) sobre o JSON canônico sem `assinatura`; exatamente esses campos.
  Quem manda uma chave confere a assinatura com a pública da pessoa antes de fechar a caixa.
- **Revogar um aparelho** faz nascer a geração `g + 1`. Quem revoga a entrega aos aparelhos que ficam numa caixa (§5) com o
  contexto `caixa-da-pessoa:<g+1>` e os 32 bytes do segredo dentro.
- Os aparelhos guardam as gerações que receberam, **nunca a semente da pessoa** (ela só fica aberta por instantes: ao entrar,
  trocar a senha, revogar ou refazer o cofre pelo kit).
- Casos: `geracoes.json`.

## 10. O cofre assinado (X2)
- Para guardar ou trocar o cofre (§8) na ponte, a pessoa assina o JSON canônico do cofre inteiro (`{v, kdf, nonce,
  cifrado}`) com o contexto `cofre-da-pessoa` (§2). A ponte confere com a pública de assinar da pessoa daquela conta: quem
  só tem a sessão, ou trocou a senha pelo e-mail, não põe outro cofre no lugar.
- Casos: `geracoes.json` (`cofre`, sobre o cofre de `cofre.json`).

## 11. A guarda dividida (X2, "confirme no outro aparelho")
- O aparelho guarda a semente da pessoa cifrada: `guarda` = 32 bytes sorteados; `guardado = { "v": 1, "nonce": b64u(24
  bytes), "cifrado": b64u(…) }`, XChaCha20-Poly1305 com a chave `guarda` e os dados associados
  `utf8("ekfrase/guarda/v1") ‖ 0x00 ‖ utf8(endereço do aparelho)`; dentro, os 16 bytes da semente.
- A `guarda` vai à ponte (que a guarda com o aparelho) e é apagada do aparelho; o `guardado` fica só no aparelho. A ponte
  entrega a `guarda` só para atender o pedido de um aparelho novo da mesma conta (o aparelho aberto abre a cópia e manda a
  semente ao novo numa caixa, contexto `semente-da-pessoa`, §5) e apaga a guarda quando o aparelho é revogado ou sai.
- **O código do aparelho** (as duas telas mostram o mesmo): `n = u32 big-endian dos 4 primeiros bytes de
  SHA-256(utf8("ekfrase/codigo-aparelho/v1") ‖ 0x00 ‖ cifrar ‖ assinar)` (as públicas do aparelho novo), `n mod 10⁶` com
  6 algarismos, escrito `"ddd ddd"`. Serve para aprovar o aparelho certo; contra um servidor mal-intencionado, quem
  protege no Motor é o PAKE do pareamento (ARQUITETURA §9.3).
- Casos: `geracoes.json` (`guarda`, `aparelho.codigo`).

## 12. A prova da sessão (X2)
- A ponte sorteia um desafio por sessão (64 letras hex). O aparelho assina `utf8(desafio)` com a chave DELE (§2, contexto
  `sessao-aparelho`); a ponte confere com a pública de assinar do certificado e liga a sessão ao aparelho (revogar o
  aparelho tira a sessão dele).
- Casos: `geracoes.json` (`sessao`).
