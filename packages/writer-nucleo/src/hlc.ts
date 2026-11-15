// SPDX-License-Identifier: MPL-2.0

/**
 * O relógio híbrido (HLC) que dá a `versao` de tudo (docs/writer/protocolo/README.md §2).
 *
 *   "<tempo em ms, 13 dígitos>-<contador, 4 hex>-<aparelho, 8 hex>"
 *
 * O texto é montado para que comparar versões seja comparar TEXTO (`a < b`). O relógio nunca anda
 * para trás (mesmo que o relógio do aparelho ande) e ABSORVE toda versão que chega do servidor:
 * a próxima versão gerada aqui é sempre maior que qualquer uma já vista.
 */

export const REGEX_HLC = /^\d{13}-[0-9a-f]{4}-[0-9a-f]{8}$/;
export const REGEX_APARELHO = /^[0-9a-f]{8}$/;
const CONTADOR_MAX = 0xffff;

export const ehHlc = (v: unknown): v is string => typeof v === 'string' && REGEX_HLC.test(v);

export function montarHlc(tempo: number, contador: number, aparelho: string): string {
  return `${String(tempo).padStart(13, '0')}-${contador.toString(16).padStart(4, '0')}-${aparelho}`;
}

export function partesHlc(versao: string): { tempo: number; contador: number; aparelho: string } {
  if (!ehHlc(versao)) throw new Error(`versão (HLC) malformada: ${versao}`);
  return { tempo: Number(versao.slice(0, 13)), contador: parseInt(versao.slice(14, 18), 16), aparelho: versao.slice(19) };
}

/** -1, 0 ou 1: a comparação é de texto. */
export const compararHlc = (a: string, b: string): -1 | 0 | 1 => (a < b ? -1 : a > b ? 1 : 0);

/** A maior das versões dadas (`''` se nenhuma). */
export function maiorHlc(...versoes: readonly (string | null | undefined)[]): string {
  let m = '';
  for (const v of versoes) if (v && v > m) m = v;
  return m;
}

export function bytesAoAcaso(n: number): Uint8Array {
  const b = new Uint8Array(n);
  globalThis.crypto.getRandomValues(b);
  return b;
}

/** Um id de aparelho novo: 8 hex ao acaso. Quem cria guarda e reusa. */
export function novoAparelho(aleatorio: (n: number) => Uint8Array = bytesAoAcaso): string {
  return [...aleatorio(4)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export interface OpcoesRelogio {
  /** 8 hex minúsculos. */
  aparelho: string;
  /** O relógio do aparelho, em ms (padrão: `Date.now`). */
  agora?: () => number;
  /** A última versão que este relógio já deu ou viu (guardada entre sessões). */
  ultimo?: string | null;
}

export class Relogio {
  readonly aparelho: string;
  private readonly fisico: () => number;
  private tempo = -1;
  private contador = 0;

  constructor(o: OpcoesRelogio) {
    if (!REGEX_APARELHO.test(o.aparelho)) throw new Error(`id de aparelho malformado: ${o.aparelho}`);
    this.aparelho = o.aparelho;
    this.fisico = o.agora ?? Date.now;
    if (o.ultimo) this.absorver(o.ultimo);
  }

  /** Gera a próxima versão: maior que todas as que este relógio já deu ou absorveu. */
  agora(): string {
    const f = Math.max(0, Math.floor(this.fisico()));
    if (f > this.tempo) {
      this.tempo = f;
      this.contador = 0;
    } else if (this.contador >= CONTADOR_MAX) {
      this.tempo += 1;
      this.contador = 0;
    } else {
      this.contador += 1;
    }
    return montarHlc(this.tempo, this.contador, this.aparelho);
  }

  /** Absorve uma versão vista (do servidor ou de outro aparelho): o relógio não fica atrás dela. */
  absorver(versao: string): void {
    const { tempo, contador } = partesHlc(versao);
    if (tempo > this.tempo || (tempo === this.tempo && contador > this.contador)) {
      this.tempo = tempo;
      this.contador = contador;
    }
  }

  /** A última versão dada ou absorvida (com o id DESTE aparelho), ou `null` se nenhuma. */
  get ultimo(): string | null {
    return this.tempo < 0 ? null : montarHlc(this.tempo, this.contador, this.aparelho);
  }
}
