// SPDX-License-Identifier: MPL-2.0

/**
 * O certificado do aparelho e a revogação (ARQUITETURA §5.1).
 *
 * A pessoa APRESENTA cada aparelho seu assinando um certificado com a chave dela: "este par é do meu notebook".
 * No dia a dia, o aparelho assina com a própria chave, e quem recebe confere o certificado para saber de quem é.
 * Aparelho perdido ou roubado: a pessoa assina uma REVOGAÇÃO; o que esse aparelho assinar dali em diante não entra
 * em lugar nenhum (o que ele já tinha mandado antes continua: não dá para "desver").
 *
 * Os dois são JSON; a assinatura cobre o JSON canônico (`canonico.ts`) do objeto sem o campo `assinatura`, com o
 * contexto `certificado-aparelho` ou `revogacao-aparelho`. Os dois levam as públicas da pessoa inteiras, para que um
 * certificado sozinho já prove a que endereço pertence o aparelho.
 */
import { doBase64urlCom, paraBase64url } from './bytes.ts';
import { bytesCanonicos, textoCanonicoValido } from './canonico.ts';
import { assinar, conferirAssinatura, enderecoDe, enderecoValido, publicasDoJson, publicasParaJson, type ChavesPublicas, type ChavesPublicasJson, type Identidade } from './chaves.ts';

export const CONTEXTO_CERTIFICADO = 'certificado-aparelho';
export const CONTEXTO_REVOGACAO = 'revogacao-aparelho';

/** O nome do aparelho: de 1 a 60 caracteres depois de tirar os espaços das pontas. */
export const NOME_MAXIMO = 60;

export interface CertificadoDeAparelho {
  readonly v: 1;
  readonly pessoa: ChavesPublicasJson;
  readonly aparelho: ChavesPublicasJson;
  /** Como a pessoa chama o aparelho ("Notebook da Ana"), em NFC. */
  readonly nome: string;
  /** Quando foi apresentado (milissegundos desde 1970, inteiro). */
  readonly criado: number;
  readonly assinatura: string;
}

export interface Revogacao {
  readonly v: 1;
  readonly pessoa: ChavesPublicasJson;
  /** O endereço do aparelho revogado. */
  readonly aparelho: string;
  readonly quando: number;
  readonly assinatura: string;
}

export type ErroDeCertificado = 'formato' | 'assinatura' | 'outra-pessoa' | 'revogado';

export type AparelhoConferido =
  | { readonly ok: true; readonly pessoa: string; readonly aparelho: string; readonly publicas: ChavesPublicas; readonly nome: string; readonly criado: number }
  | { readonly ok: false; readonly erro: ErroDeCertificado };

/** O nome normalizado, ou `null` se não serve (vazio, grande demais, com caractere de controle). */
export function nomeDeAparelho(nome: string): string | null {
  const n = nome.normalize('NFC').trim();
  if (n.length === 0 || [...n].length > NOME_MAXIMO || !textoCanonicoValido(n)) return null;
  return n;
}

const quandoValido = (n: unknown): n is number => typeof n === 'number' && Number.isSafeInteger(n) && n >= 0;

/** A pessoa apresenta um aparelho: o certificado assinado com a chave dela. */
export function emitirCertificado(pessoa: Identidade, aparelho: ChavesPublicas, nome: string, criado: number = Date.now()): CertificadoDeAparelho {
  const n = nomeDeAparelho(nome);
  if (n === null) throw new RangeError('nome de aparelho inválido');
  if (!quandoValido(criado)) throw new RangeError('data inválida');
  const corpo = { v: 1, pessoa: publicasParaJson(pessoa.publicas), aparelho: publicasParaJson(aparelho), nome: n, criado } as const;
  const assinatura = assinar(pessoa, CONTEXTO_CERTIFICADO, bytesCanonicos(corpo));
  return { ...corpo, assinatura: paraBase64url(assinatura) };
}

/** A pessoa revoga um aparelho (pelo endereço dele). */
export function revogarAparelho(pessoa: Identidade, aparelho: string, quando: number = Date.now()): Revogacao {
  if (!enderecoValido(aparelho)) throw new RangeError('endereço de aparelho inválido');
  if (!quandoValido(quando)) throw new RangeError('data inválida');
  const corpo = { v: 1, pessoa: publicasParaJson(pessoa.publicas), aparelho, quando } as const;
  const assinatura = assinar(pessoa, CONTEXTO_REVOGACAO, bytesCanonicos(corpo));
  return { ...corpo, assinatura: paraBase64url(assinatura) };
}

const ehObjeto = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);
const soEstesCampos = (o: Record<string, unknown>, campos: readonly string[]) => Object.keys(o).length === campos.length && campos.every((c) => c in o);

/** Confere só o certificado (formato e assinatura). Para saber se o aparelho vale, use `conferirAparelho`. */
export function conferirCertificado(c: unknown): AparelhoConferido {
  if (!ehObjeto(c) || !soEstesCampos(c, ['v', 'pessoa', 'aparelho', 'nome', 'criado', 'assinatura']) || c['v'] !== 1) return { ok: false, erro: 'formato' };
  const pessoa = publicasDoJson(c['pessoa']);
  const aparelho = publicasDoJson(c['aparelho']);
  const nome = c['nome'];
  const criado = c['criado'];
  const assinatura = doBase64urlCom(c['assinatura'], 64);
  if (!pessoa || !aparelho || !assinatura || typeof nome !== 'string' || nomeDeAparelho(nome) !== nome || !quandoValido(criado)) return { ok: false, erro: 'formato' };
  const corpo = { v: 1, pessoa: publicasParaJson(pessoa), aparelho: publicasParaJson(aparelho), nome, criado };
  if (!conferirAssinatura(pessoa.assinar, CONTEXTO_CERTIFICADO, bytesCanonicos(corpo), assinatura)) return { ok: false, erro: 'assinatura' };
  return { ok: true, pessoa: enderecoDe(pessoa), aparelho: enderecoDe(aparelho), publicas: aparelho, nome, criado };
}

/** Confere uma revogação; devolve `{pessoa, aparelho}` (endereços) ou `null`. */
export function conferirRevogacao(r: unknown): { readonly pessoa: string; readonly aparelho: string; readonly quando: number } | null {
  if (!ehObjeto(r) || !soEstesCampos(r, ['v', 'pessoa', 'aparelho', 'quando', 'assinatura']) || r['v'] !== 1) return null;
  const pessoa = publicasDoJson(r['pessoa']);
  const aparelho = r['aparelho'];
  const quando = r['quando'];
  const assinatura = doBase64urlCom(r['assinatura'], 64);
  if (!pessoa || !assinatura || !enderecoValido(aparelho) || !quandoValido(quando)) return null;
  const corpo = { v: 1, pessoa: publicasParaJson(pessoa), aparelho, quando };
  if (!conferirAssinatura(pessoa.assinar, CONTEXTO_REVOGACAO, bytesCanonicos(corpo), assinatura)) return null;
  return { pessoa: enderecoDe(pessoa), aparelho, quando };
}

/**
 * O aparelho vale? Confere o certificado, que ele é da pessoa esperada (se `pessoa` for dado) e que nenhuma revogação
 * VÁLIDA dessa mesma pessoa o atinge. Revogação estragada, de outra pessoa ou de outro aparelho é ignorada.
 */
export function conferirAparelho(cert: unknown, opcoes: { readonly pessoa?: string; readonly revogacoes?: readonly unknown[] } = {}): AparelhoConferido {
  const c = conferirCertificado(cert);
  if (!c.ok) return c;
  if (opcoes.pessoa !== undefined && opcoes.pessoa !== c.pessoa) return { ok: false, erro: 'outra-pessoa' };
  for (const r of opcoes.revogacoes ?? []) {
    const rv = conferirRevogacao(r);
    if (rv && rv.pessoa === c.pessoa && rv.aparelho === c.aparelho) return { ok: false, erro: 'revogado' };
  }
  return c;
}
