// SPDX-License-Identifier: MPL-2.0

/**
 * O ESPELHO (parte do Motor): uma pasta que fica IGUAL a uma lista de arquivos de texto, sempre em
 * dia. O app diz o que deve existir (caminho relativo → conteúdo); o espelho grava só o que mudou,
 * cada arquivo de uma vez (temporário + troca: nunca fica um `.md` pela metade) e apaga o que saiu.
 *
 * Só mexe no que ele mesmo escreveu: a lista fica em `.ekfrase-espelho.json`. Um arquivo que a
 * pessoa pôs na pasta à mão nunca é apagado. O espelho NÃO é cifrado (é o que deixa abrir os textos
 * em qualquer computador); quem liga é avisado disso.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, rmdirSync, unlinkSync } from 'node:fs';
import { dirname, isAbsolute, join, normalize, relative, sep } from 'node:path';
import { gravarInteiro } from './pastas.ts';

export const LISTA = '.ekfrase-espelho.json';

export interface ResultadoEspelho {
  escritos: number;
  apagados: number;
}

/** O caminho relativo é seguro (fica dentro da pasta, sem `..`, sem unidade)? */
export function caminhoSeguro(rel: string): boolean {
  if (!rel || isAbsolute(rel) || /^[a-z]:/i.test(rel) || rel.includes('\0')) return false;
  const n = normalize(rel);
  return !n.split(/[\\/]/).some((p) => p === '..' || p === '') && !n.startsWith(sep);
}

export class EspelhoDePasta {
  readonly pasta: string;

  constructor(pasta: string) {
    this.pasta = pasta;
  }

  private lista(): string[] {
    try {
      const l = JSON.parse(readFileSync(join(this.pasta, LISTA), 'utf8')) as unknown;
      return Array.isArray(l) ? l.filter((x): x is string => typeof x === 'string' && caminhoSeguro(x)) : [];
    } catch {
      return [];
    }
  }

  /** Deixa a pasta igual a `arquivos` (caminhos com `/`). */
  sincronizar(arquivos: Readonly<Record<string, string>>): ResultadoEspelho {
    mkdirSync(this.pasta, { recursive: true });
    const antes = new Set(this.lista());
    const agora = Object.keys(arquivos).filter(caminhoSeguro);
    let escritos = 0;
    let apagados = 0;
    for (const rel of agora) {
      const f = join(this.pasta, ...rel.split('/'));
      const conteudo = arquivos[rel] ?? '';
      let igual = false;
      try {
        igual = readFileSync(f, 'utf8') === conteudo;
      } catch {
        // não existe ainda
      }
      if (!igual) {
        gravarInteiro(f, conteudo);
        escritos++;
      }
      antes.delete(rel);
    }
    // a lista nova vai antes de apagar: se cair no meio, o que sobrar é apagado na próxima vez
    gravarInteiro(join(this.pasta, LISTA), `${JSON.stringify(agora.sort(), null, 1)}\n`);
    const pastas = new Set<string>();
    for (const rel of antes) {
      const f = join(this.pasta, ...rel.split('/'));
      try {
        unlinkSync(f);
        apagados++;
      } catch {
        // já não estava lá
      }
      for (let d = dirname(f); relative(this.pasta, d) && !relative(this.pasta, d).startsWith('..'); d = dirname(d)) pastas.add(d);
    }
    // as pastas que ficaram vazias (de dentro para fora)
    for (const d of [...pastas].sort((a, b) => b.length - a.length)) {
      try {
        if (existsSync(d) && readdirSync(d).length === 0) rmdirSync(d);
      } catch {
        // não deu: fica a pasta vazia
      }
    }
    return { escritos, apagados };
  }
}
