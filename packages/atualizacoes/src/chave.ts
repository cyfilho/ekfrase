// SPDX-License-Identifier: MPL-2.0

/**
 * A chave PÚBLICA do lacre da Ekfrase (PLANO §12, linha 10), embutida nos apps. É a mesma de
 * `sistema/writer-os/imagem/minisign.pub` (o teste confere que as duas são iguais). Vale para TODOS os apps de computador da
 * Ekfrase (o Gravador, o Writer no computador e o Writer OS): docs/ATUALIZACOES.md §3. A secreta
 * nunca entra no Git: fica no segredo EKFRASE_MINISIGN_CHAVE do GitHub, que o CI usa para assinar.
 */
export const CHAVE_EKFRASE = `untrusted comment: minisign public key 2B28FD813F9BFCDC
RWTc/Js/gf0oK0nfAK7FtHtHncwhyq2JI/0IovnJw9pJb5h0isuza+Wz
`;

export const ID_CHAVE_EKFRASE = '2B28FD813F9BFCDC';
