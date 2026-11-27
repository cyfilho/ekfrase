<!-- SPDX-License-Identifier: MPL-2.0 -->
# O protocolo do núcleo Ekfrase

Aqui fica a **especificação** do núcleo novo da família Ekfrase (local-first, Yjs, cifra de ponta a ponta), escrita
para quem quiser fazer uma implementação compatível em outra linguagem sem ler o código em TypeScript. Cada parte tem
casos de conformidade em JSON: uma implementação está conforme quando passa por todos.

| Parte | O quê | Implementação de referência | Casos conferidos por |
|---|---|---|---|
| [`identidade/`](identidade/README.md) | as chaves da pessoa e dos aparelhos, os certificados e a revogação, a caixa para uma pessoa, a chave de documento por época, o kit de 12 palavras, o cofre com senha | `packages/identidade` | `tests/identidade.test.ts` |
| `envelopes/` (a fazer) | o envelope assinado e cifrado de cada mudança, as bases, o pacote do pendrive | `packages/sincronia`, `packages/transporte` | — |

O protocolo de sincronização do Writer de hoje (registros com relógio HLC) continua em `docs/writer/protocolo/`.
