// SPDX-License-Identifier: MPL-2.0

/**
 * O RASCUNHO DE EMERGÊNCIA: a folha grava no armazém a cada pausa de 400 ms, mas gravar no
 * IndexedDB leva algumas transações (é assíncrono), e fechar a aba (ou sair da página) logo depois
 * de digitar corta a gravação no meio. Então, quando a página vai sumir (`pagehide`, aba escondida,
 * `beforeunload`), a folha guarda o que ainda não foi gravado no `localStorage`, que grava na hora.
 *
 * Ao abrir a sessão, `recuperarRascunhos` põe cada rascunho na cena: se a cena ainda tem o texto em
 * que o rascunho se baseou (`base`, um resumo do texto), o rascunho vira o texto; se a cena mudou
 * por outro caminho (outra aba, a nuvem), o rascunho vai para o histórico da cena. Nada se perde.
 */
import { DONO_LOCAL } from '@ekfrase/writer-nucleo';
import { guardaDeRascunhos } from './computador/casca.ts';
import type { Sessao } from './estado.ts';

const PREFIXO = 'ekfrase.writer.rascunho:';
/** Rascunho que ninguém conseguiu usar em 30 dias (cena apagada, de outra conta) sai. */
const VALIDADE = 30 * 24 * 60 * 60 * 1000;

export interface Rascunho {
  dono: string;
  cena: string;
  texto: string;
  /** O resumo do texto que estava gravado quando a pessoa digitou o rascunho. */
  base: string;
  quando: number;
}

/** Um resumo curto de um texto (cyrb53): só para saber se a cena mudou desde o rascunho. */
export function resumo(texto: string): string {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < texto.length; i++) {
    const c = texto.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 2654435761);
    h2 = Math.imul(h2 ^ c, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return `${texto.length}:${(4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36)}`;
}

/** Guarda na hora (síncrono). `false` = não coube ou o navegador não deixou. */
export function guardarRascunho(r: Rascunho): boolean {
  return guardaDeRascunhos.por(PREFIXO + r.cena, JSON.stringify(r));
}

export function esquecerRascunho(cena: string): void {
  guardaDeRascunhos.tirar(PREFIXO + cena);
}

function rascunhos(): Rascunho[] {
  const saida: Rascunho[] = [];
  for (const [chave, valor] of Object.entries(guardaDeRascunhos.todos())) {
    if (!chave.startsWith(PREFIXO)) continue;
    try {
      const r = JSON.parse(valor) as Partial<Rascunho> | null;
      if (r && typeof r.cena === 'string' && typeof r.texto === 'string' && typeof r.dono === 'string' && typeof r.base === 'string') saida.push(r as Rascunho);
      else guardaDeRascunhos.tirar(chave);
    } catch {
      guardaDeRascunhos.tirar(chave);
    }
  }
  return saida;
}

/**
 * Põe os rascunhos deste dono nas cenas (ver o começo do arquivo). Um rascunho de quem escrevia sem
 * conta também vale na conta, se a cena foi levada para ela (`adotar` mantém o id). Devolve quantos
 * foram usados.
 */
export async function recuperarRascunhos(s: Sessao): Promise<number> {
  let n = 0;
  for (const r of rascunhos()) {
    if (r.dono !== s.dono && r.dono !== DONO_LOCAL) continue;
    let texto: string;
    try {
      texto = (await s.escrita.cena(r.cena)).texto;
    } catch {
      // a cena não está neste armazém (ainda não foi levada, ou foi apagada): fica para depois
      if (Date.now() - (r.quando || 0) > VALIDADE) esquecerRascunho(r.cena);
      continue;
    }
    try {
      if (texto !== r.texto) {
        if (resumo(texto) === r.base) await s.escrita.gravarTextoSobre(r.cena, r.texto, texto);
        else await s.escrita.guardarNoHistorico(r.cena, r.texto);
        n += 1;
      }
      esquecerRascunho(r.cena);
    } catch {
      // não deu para gravar agora: tenta de novo na próxima vez
    }
  }
  return n;
}
