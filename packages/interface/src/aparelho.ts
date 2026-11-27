// SPDX-License-Identifier: MPL-2.0

/**
 * Onde as chaves DESTE aparelho ficam no navegador (X2, `docs/ARQUITETURA.md` §5.6). Sem cifra nenhuma aqui: só ler,
 * gravar e apagar, para que o `ponte.ts` (que todo app importa) apague as chaves ao sair sem carregar o
 * `@ekfrase/identidade`. Quem cria e usa as chaves é o `chaves.ts`.
 *
 * `ekfrase.aparelho.<endereço da pessoa>` = {semente do aparelho, certificado, guardado, caixas por geração}.
 * **Nunca a semente da pessoa.** `ekfrase.aparelho.atual` = o endereço da pessoa da conta que entrou aqui (para o
 * "Sair" saber o que apagar). `ekfrase.contas-com-chaves` = o SHA-256 dos e-mails que já entraram com chaves neste
 * navegador (um servidor não rebaixa o login deles para a senha em claro); só o hash, nunca o e-mail.
 */

export interface AparelhoGuardado {
  readonly v: 1;
  /** A semente do aparelho (32 bytes, base64url). */
  readonly semente: string;
  /** O certificado que a pessoa assinou para este aparelho (como foi à ponte). */
  readonly certificado: unknown;
  /** A cópia cifrada da semente da pessoa (a guarda fica só na ponte). */
  readonly guardado: unknown;
  /** As gerações da chave de caixa que este aparelho tem: geração → segredo (base64url). */
  readonly caixas: Readonly<Record<string, string>>;
}

/** O pedaço do `Storage` que usamos (no teste, um objeto em memória). */
export type Armazem = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

const PREFIXO = 'ekfrase.aparelho.';
const ATUAL = 'ekfrase.aparelho.atual';
const LEMBRADOS = 'ekfrase.contas-com-chaves';
const ENDERECO = /^[0-9a-f]{32}$/;

let armazem: Armazem | null | undefined;

/** Troca o armazém (o teste usa um em memória por "aparelho"); `null` = sem armazém. */
export function usarArmazem(a: Armazem | null): void {
  armazem = a;
}

function onde(): Armazem | null {
  if (armazem !== undefined) return armazem;
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null; // navegador que barra o armazenamento
  }
}

function ler(chave: string): string | null {
  try {
    return onde()?.getItem(chave) ?? null;
  } catch {
    return null;
  }
}

function gravar(chave: string, valor: string): boolean {
  try {
    const a = onde();
    if (!a) return false;
    a.setItem(chave, valor);
    return true;
  } catch {
    return false; // cheio ou barrado
  }
}

function tirar(chave: string): void {
  try {
    onde()?.removeItem(chave);
  } catch {
    // nada a fazer
  }
}

/** As chaves deste aparelho para a pessoa, ou `null`. Nunca lança com dado estragado. */
export function lerAparelho(pessoa: string): AparelhoGuardado | null {
  if (!ENDERECO.test(pessoa)) return null;
  const bruto = ler(PREFIXO + pessoa);
  if (!bruto) return null;
  try {
    const j = JSON.parse(bruto) as Record<string, unknown>;
    const caixas = j['caixas'];
    if (j['v'] !== 1 || typeof j['semente'] !== 'string' || !caixas || typeof caixas !== 'object' || Array.isArray(caixas)) return null;
    const limpas: Record<string, string> = {};
    for (const [g, s] of Object.entries(caixas as Record<string, unknown>)) if (/^[1-9][0-9]{0,6}$/.test(g) && typeof s === 'string') limpas[g] = s;
    return { v: 1, semente: j['semente'], certificado: j['certificado'], guardado: j['guardado'], caixas: limpas };
  } catch {
    return null;
  }
}

export function gravarAparelho(pessoa: string, a: AparelhoGuardado): boolean {
  if (!ENDERECO.test(pessoa)) return false;
  const ok = gravar(PREFIXO + pessoa, JSON.stringify(a));
  if (ok) gravar(ATUAL, pessoa);
  return ok;
}

export function apagarAparelho(pessoa: string): void {
  if (!ENDERECO.test(pessoa)) return;
  tirar(PREFIXO + pessoa);
  if (ler(ATUAL) === pessoa) tirar(ATUAL);
}

/** A pessoa da conta que entrou neste navegador (o "Sair" apaga as chaves dela). */
export function marcarPessoaAtual(pessoa: string): void {
  if (ENDERECO.test(pessoa)) gravar(ATUAL, pessoa);
}

/** Sair (ou excluir a conta): as chaves da pessoa que estava aqui somem do navegador. */
export function esquecerChavesDesteAparelho(): void {
  const p = ler(ATUAL);
  if (p && ENDERECO.test(p)) tirar(PREFIXO + p);
  tirar(ATUAL);
}

function lembrados(): string[] {
  try {
    const l = JSON.parse(ler(LEMBRADOS) ?? '[]') as unknown;
    return Array.isArray(l) ? l.filter((x): x is string => typeof x === 'string' && /^[0-9a-f]{64}$/.test(x)) : [];
  } catch {
    return [];
  }
}

/** Guarda que este e-mail já entrou com chaves (o hash dele; até 20). */
export function lembrarContaComChaves(hashDoEmail: string): void {
  const l = lembrados().filter((x) => x !== hashDoEmail);
  gravar(LEMBRADOS, JSON.stringify([hashDoEmail, ...l].slice(0, 20)));
}

export function contaComChavesLembrada(hashDoEmail: string): boolean {
  return lembrados().includes(hashDoEmail);
}
