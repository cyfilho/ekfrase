// SPDX-License-Identifier: MPL-2.0

/**
 * AS REGRAS DA JANELA DO PORTAL CATIVO (PLANO §7, "Portal cativo", W4): sem o Electron, para o `casca.test.ts`.
 * A janela (`portal.ts`) abre o endereço do teste de conectividade; a rede do hotel ou do café redireciona para a
 * página de login dela. Os sites dessa PRIMEIRA cadeia de redirecionamentos (até a 1ª página carregar) viram os sites
 * do portal; depois, a página principal e os quadros só navegam dentro deles. É a única exceção à regra de não abrir
 * páginas da internet no Writer OS, e fecha sozinha quando a internet aparece.
 */

import type { Conectividade as ConectividadeDoNucleo } from '@ekfrase/writer-nucleo';

/** Os sufixos de dois nomes (o site é o nome antes deles: `hotel.com.br`, não `com.br`). Lista curta, de propósito. */
const SUFIXOS_DUPLOS = new Set([
  'com.br', 'net.br', 'org.br', 'gov.br', 'edu.br', 'art.br', 'tur.br',
  'co.uk', 'org.uk', 'ac.uk', 'gov.uk', 'me.uk',
  'com.au', 'net.au', 'org.au', 'edu.au',
  'co.jp', 'ne.jp', 'or.jp', 'co.nz', 'co.za', 'co.kr', 'co.in',
  'com.ar', 'com.mx', 'com.pt', 'com.es', 'com.co', 'com.pe', 'com.uy', 'com.py', 'com.bo', 'com.ec', 'com.ve',
  'com.cn', 'com.tw', 'com.hk', 'com.sg', 'com.tr',
]);

const IPV4 = /^\d{1,3}(?:\.\d{1,3}){3}$/;

/**
 * O "site" de um endereço `http`/`https`: o IP (v4 ou v6) inteiro, `localhost`, ou os dois últimos nomes (três num
 * sufixo duplo: `wifi.hotel.com.br` → `hotel.com.br`). `null` para qualquer outro esquema ou endereço inválido.
 */
export function siteDe(endereco: string): string | null {
  let u: URL;
  try {
    u = new URL(endereco);
  } catch {
    return null;
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
  const host = u.hostname.toLowerCase().replace(/\.$/, '');
  if (!host) return null;
  if (host.startsWith('[') || IPV4.test(host) || !host.includes('.')) return host;
  const partes = host.split('.');
  const n = partes.length >= 3 && SUFIXOS_DUPLOS.has(partes.slice(-2).join('.')) ? 3 : 2;
  return partes.slice(-n).join('.');
}

/** O que a janela pede: a página principal, um quadro, ou outra coisa (imagem, folha de estilo, script…). */
export type TipoPedido = 'principal' | 'quadro' | 'outro';

/**
 * Deixar o pedido passar? `aprendendo` = a primeira cadeia ainda não terminou (os sites dela entram em `sites`, que a
 * janela guarda). Só `http`/`https` saem; `data:` e `blob:` só como recurso (imagens do portal), nunca como página.
 * O `about:blank` dos quadros vazios passa.
 */
export function deixarPassar(endereco: string, tipo: TipoPedido, sites: Set<string>, aprendendo: boolean): boolean {
  if (endereco === 'about:blank') return tipo !== 'principal';
  if (/^(data|blob):/i.test(endereco)) return tipo === 'outro';
  const site = siteDe(endereco);
  if (!site) return false;
  if (tipo === 'outro') return true;
  if (aprendendo && tipo === 'principal') {
    sites.add(site);
    return true;
  }
  return sites.has(site);
}

/** Uma janela nova (`target=_blank`, `window.open`) pedida pelo portal: abre na MESMA janela só se for um site dele. */
export const abrirNaMesma = (endereco: string, sites: ReadonlySet<string>): boolean => {
  const site = siteDe(endereco);
  return !!site && sites.has(site);
};

/** A janela fecha sozinha em 10 minutos, e confere a internet a cada 3 s. */
export const PORTAL_MAXIMO_MS = 10 * 60 * 1000;
export const PORTAL_CONFERIR_MS = 3000;

/** O que o NetworkManager diz (`nmcli networking connectivity check`) → o que a casca entende (o tipo é do núcleo). */
export type Conectividade = ConectividadeDoNucleo;

export function lerConectividade(saida: string): Conectividade {
  switch (saida.trim().toLowerCase()) {
    case 'full':
      return 'internet';
    case 'portal':
      return 'portal';
    case 'limited':
    case 'none':
      return 'sem';
    default:
      return 'desconhecida';
  }
}
