// SPDX-License-Identifier: MPL-2.0

/**
 * O JSON canônico: a forma única de escrever um objeto antes de assiná-lo. É o RFC 8785 (JCS) num pedaço menor,
 * fácil de refazer em outra linguagem (a ponte em PHP confere as mesmas assinaturas):
 * - as chaves dos objetos em ordem (pela unidade UTF-16, a ordem do RFC 8785; as nossas são todas ASCII);
 * - sem espaço nenhum;
 * - números só inteiros seguros (nada de fração, -0, NaN ou infinito, que cada linguagem escreve de um jeito);
 * - textos sem caractere de controle, sem U+2028/U+2029 e sem surrogate solto. Assim o único escape é `\"` e `\\`,
 *   igual em toda linguagem (no PHP: `json_encode` com `JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE`).
 * Valor fora disso lança `ErroCanonico` (quem monta o objeto errou; não é um dado de fora).
 */
import { utf8ToBytes } from './bytes.ts';

export type ValorCanonico = null | boolean | number | string | readonly ValorCanonico[] | { readonly [chave: string]: ValorCanonico };

export class ErroCanonico extends Error {
  override readonly name = 'ErroCanonico';
}

const PROIBIDO = /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/;
const SURROGATE_SOLTO = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;

/** O texto pode entrar num objeto assinado? (sem controle, sem U+2028/2029, Unicode bem formado). */
export function textoCanonicoValido(texto: string): boolean {
  return !PROIBIDO.test(texto) && !SURROGATE_SOLTO.test(texto);
}

export function canonico(valor: ValorCanonico): string {
  if (valor === null) return 'null';
  switch (typeof valor) {
    case 'boolean':
      return valor ? 'true' : 'false';
    case 'number':
      if (!Number.isSafeInteger(valor) || Object.is(valor, -0)) throw new ErroCanonico(`número fora do JSON canônico: ${valor}`);
      return String(valor);
    case 'string':
      if (!textoCanonicoValido(valor)) throw new ErroCanonico('texto com caractere que o JSON canônico não aceita');
      return JSON.stringify(valor);
    case 'object': {
      if (Array.isArray(valor)) return `[${(valor as readonly ValorCanonico[]).map(canonico).join(',')}]`;
      const obj = valor as { readonly [chave: string]: ValorCanonico };
      const chaves = Object.keys(obj).sort();
      return `{${chaves
        .map((c) => {
          const v = obj[c];
          if (v === undefined) throw new ErroCanonico(`campo "${c}" sem valor`);
          return `${canonico(c)}:${canonico(v)}`;
        })
        .join(',')}}`;
    }
    default:
      throw new ErroCanonico(`tipo fora do JSON canônico: ${typeof valor}`);
  }
}

/** Os bytes (UTF-8) do JSON canônico: o que de fato se assina. */
export function bytesCanonicos(valor: ValorCanonico): Uint8Array {
  return utf8ToBytes(canonico(valor));
}
