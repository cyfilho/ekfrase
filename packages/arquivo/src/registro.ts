// SPDX-License-Identifier: MPL-2.0

/**
 * O REGISTRO: que app abre que tipo de `.ekfr`, e até que versão maior do formato. Quem roteia
 * arquivos (o "Abrir um arquivo .ekfr" de ekfrase.com, um lançador no computador) usa esta tabela
 * para mandar cada arquivo ao app certo. App novo que grava arquivo = uma entrada aqui (e o teste
 * `tests/arquivo.test.ts` confere que ela é válida).
 */
import { maior, type Envelope } from './ekfr.ts';

export interface TipoDeDocumento {
  /** O `tipo` do envelope. */
  readonly tipo: string;
  /** A versão maior do formato que o app sabe abrir (as menores mais novas também abrem). */
  readonly maior: number;
}

export interface AppNoRegistro {
  /** O `app` do envelope; também a pasta do app (`apps/<id>`) e o endereço na web (`/<id>/`). */
  readonly id: string;
  /** Endereço do app em ekfrase.com. */
  readonly endereco: string;
  /** O que ele abre. */
  readonly abre: readonly TipoDeDocumento[];
}

export const REGISTRO: readonly AppNoRegistro[] = [
  { id: 'maker', endereco: '/maker/', abre: [{ tipo: 'mundo', maior: 1 }] },
];

export const appDoRegistro = (id: string): AppNoRegistro | undefined => REGISTRO.find((a) => a.id === id);

export type Veredito =
  /** este app abre */
  | { abre: true }
  /** é de outro app que existe no registro: mande para ele */
  | { abre: false; motivo: 'outro-app'; app: AppNoRegistro }
  /** é deste app, mas de uma versão maior mais nova (atualize o app) */
  | { abre: false; motivo: 'versao-nova' }
  /** é deste app, mas de um tipo que ele não conhece */
  | { abre: false; motivo: 'tipo-desconhecido' }
  /** de um app que ainda não está no registro (talvez de uma versão mais nova do Ekfrase) */
  | { abre: false; motivo: 'app-desconhecido' };

/** O app `id` consegue abrir este envelope? Se não, por quê (e quem abre). */
export function podeAbrir(id: string, envelope: Envelope): Veredito {
  if (envelope.app !== id) {
    const outro = appDoRegistro(envelope.app);
    return outro ? { abre: false, motivo: 'outro-app', app: outro } : { abre: false, motivo: 'app-desconhecido' };
  }
  const tipo = appDoRegistro(id)?.abre.find((t) => t.tipo === envelope.tipo);
  if (!tipo) return { abre: false, motivo: 'tipo-desconhecido' };
  if (maior(envelope.formato) > tipo.maior) return { abre: false, motivo: 'versao-nova' };
  return { abre: true };
}

/** Quem abre este envelope (o roteador do site e do Motor): o app, ou o motivo de ninguém abrir. */
export function quemAbre(envelope: Envelope): { app: AppNoRegistro } | { app: null; motivo: 'app-desconhecido' | 'tipo-desconhecido' | 'versao-nova' } {
  const app = appDoRegistro(envelope.app);
  if (!app) return { app: null, motivo: 'app-desconhecido' };
  const v = podeAbrir(app.id, envelope);
  if (v.abre) return { app };
  return { app: null, motivo: v.motivo === 'versao-nova' ? 'versao-nova' : 'tipo-desconhecido' };
}
