// SPDX-License-Identifier: MPL-2.0

/**
 * Para onde vai um pedido da página (usado pela `rede.ts`; aqui sem o Electron, para o teste).
 * A página pede `app://writer/api/v1/conta/eu`; a janela entrega o que vem depois de `/api/`
 * (`v1/conta/eu`) e a base já termina na versão (`https://ekfrase.com/api/v1/`): a versão não pode
 * entrar duas vezes (`…/api/v1/v1/conta/eu` dava `rota` em todo pedido).
 */
export const destinoDaApi = (caminhoDaApi: string, base: string): string => {
  const resto = caminhoDaApi.replace(/^\/+/, '');
  const versao = /\/(v\d+)\/?$/.exec(new URL(base).pathname)?.[1];
  const semVersao = versao && resto.startsWith(versao + '/') ? resto.slice(versao.length + 1) : resto;
  return new URL(semVersao, base.endsWith('/') ? base : base + '/').toString();
};
