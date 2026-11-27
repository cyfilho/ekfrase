// SPDX-License-Identifier: MPL-2.0

/**
 * O COFRE COM SENHA (ARQUITETURA §5.2, DEC-P077): a semente da pessoa guardada cifrada com uma chave tirada da senha.
 *
 * Da senha sai UMA chave mestra pelo Argon2id (RFC 9106). Dela saem, pelo HKDF-SHA256, DUAS chaves que não se
 * deduzem uma da outra:
 * - a **de entrar** (`ekfrase/senha/entrar`): vai à ponte no login, que guarda só o `password_hash` dela;
 * - a **do cofre** (`ekfrase/senha/cofre`): abre o cofre e NUNCA sai do aparelho.
 * Assim o servidor confere o login sem nunca ter o que abre o cofre (o modelo do Bitwarden). Um Argon2id só (e não
 * dois, um para cada chave) dá a mesma proteção pela metade do tempo: quem quiser adivinhar a senha paga o Argon2id
 * inteiro a cada palpite, do mesmo jeito.
 *
 * - A senha entra em NFC (o "ç" do Mac e o do Windows viram os mesmos bytes).
 * - Os parâmetros andam DENTRO do cofre (e a ponte os devolve antes do login): dá para subir depois sem quebrar nada.
 *   O padrão é o mínimo recomendado pela OWASP para o Argon2id (19 MiB, 2 passadas, 1 faixa). Medido em 26/11/2026
 *   com o `@noble/hashes` (JavaScript puro): 0,4 s no Node e 0,6 s no Chromium num Core i3 de notebook; ~1,5 s com a
 *   CPU 4× mais lenta (o "celular médio" do DevTools) e ~3 s com 6×. Só acontece ao abrir o cofre (entrar num
 *   aparelho, trocar a senha), com a barra de progresso (`aoProgredir`).
 * - Parâmetros abaixo do mínimo ou acima do máximo são RECUSADOS, venham de onde vierem: um servidor mal-intencionado
 *   não consegue pedir um Argon2id fraco (para adivinhar a senha mais rápido) nem um enorme (para travar o celular).
 * - O cofre: XChaCha20-Poly1305 com nonce sorteado; os dados associados são `ekfrase/cofre/v1` + o JSON canônico de
 *   `{v, kdf}` (mexer nos parâmetros guardados faz o cofre não abrir).
 */
import { xchacha20poly1305 } from '@noble/ciphers/chacha.js';
import { argon2idAsync } from '@noble/hashes/argon2.js';
import { hkdf } from '@noble/hashes/hkdf.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { apagar, concatBytes, doBase64url, doBase64urlCom, paraBase64url, randomBytes, textoNFC, utf8ToBytes } from './bytes.ts';
import { bytesCanonicos } from './canonico.ts';
import { assinar, conferirAssinatura, type Identidade } from './chaves.ts';

export type ParametrosDaSenha = {
  readonly alg: 'argon2id';
  /** Memória em KiB. */
  readonly m: number;
  /** Passadas. */
  readonly t: number;
  /** Faixas (paralelismo). */
  readonly p: number;
  /** 16 bytes, base64url. */
  readonly sal: string;
};

/** O padrão (o mínimo da OWASP para o Argon2id). */
export const ARGON2ID_PADRAO = { m: 19456, t: 2, p: 1 } as const;
/** Abaixo disto, recusado. */
export const ARGON2ID_MINIMO = { m: 19456, t: 2, p: 1 } as const;
/** Acima disto, recusado (256 MiB, 10 passadas, 4 faixas). */
export const ARGON2ID_MAXIMO = { m: 262144, t: 10, p: 4 } as const;

const SAL = 16;
const NONCE = 24;
const TAG = 16;
const INFO_ENTRAR = utf8ToBytes('ekfrase/senha/entrar');
const INFO_COFRE = utf8ToBytes('ekfrase/senha/cofre');

/** Parâmetros novos, com sal sorteado (uma conta nova, um cofre novo, uma senha trocada). */
export function novosParametros(): ParametrosDaSenha {
  return { alg: 'argon2id', ...ARGON2ID_PADRAO, sal: paraBase64url(randomBytes(SAL)) };
}

const inteiroEntre = (n: unknown, min: number, max: number): n is number => typeof n === 'number' && Number.isSafeInteger(n) && n >= min && n <= max;

/** Os parâmetros servem? (formato, sal de 16 bytes, e dentro do mínimo e do máximo). */
export function parametrosValidos(k: unknown): k is ParametrosDaSenha {
  if (typeof k !== 'object' || k === null) return false;
  const o = k as Record<string, unknown>;
  return (
    Object.keys(o).length === 5 &&
    o['alg'] === 'argon2id' &&
    inteiroEntre(o['m'], ARGON2ID_MINIMO.m, ARGON2ID_MAXIMO.m) &&
    inteiroEntre(o['t'], ARGON2ID_MINIMO.t, ARGON2ID_MAXIMO.t) &&
    inteiroEntre(o['p'], ARGON2ID_MINIMO.p, ARGON2ID_MAXIMO.p) &&
    doBase64urlCom(o['sal'], SAL) !== null
  );
}

export interface ChavesDaSenha {
  /** Vai à ponte no login (32 bytes). */
  readonly entrar: Uint8Array;
  /** Abre o cofre; nunca sai do aparelho (32 bytes). */
  readonly cofre: Uint8Array;
}

export interface OpcoesDaSenha {
  /** De 0 a 1, enquanto o Argon2id trabalha (para a barra de progresso). */
  readonly aoProgredir?: (fracao: number) => void;
}

/** Da senha, as duas chaves. Lança `RangeError` se os parâmetros não servirem ou a senha for vazia. */
export async function derivarDaSenha(senha: string, k: ParametrosDaSenha, opcoes: OpcoesDaSenha = {}): Promise<ChavesDaSenha> {
  if (!parametrosValidos(k)) throw new RangeError('parâmetros da senha fora do aceito');
  if (senha.length === 0) throw new RangeError('senha vazia');
  const sal = doBase64urlCom(k.sal, SAL)!;
  const s = textoNFC(senha);
  const mestra = await argon2idAsync(s, sal, {
    m: k.m,
    t: k.t,
    p: k.p,
    dkLen: 32,
    ...(opcoes.aoProgredir ? { onProgress: opcoes.aoProgredir } : {}),
  });
  try {
    return { entrar: hkdf(sha256, mestra, undefined, INFO_ENTRAR, 32), cofre: hkdf(sha256, mestra, undefined, INFO_COFRE, 32) };
  } finally {
    apagar(mestra, s);
  }
}

export type Cofre = {
  readonly v: 1;
  readonly kdf: ParametrosDaSenha;
  /** 24 bytes, base64url. */
  readonly nonce: string;
  /** O segredo cifrado (+16 bytes), base64url. */
  readonly cifrado: string;
};

const associados = (kdf: ParametrosDaSenha) => concatBytes(utf8ToBytes('ekfrase/cofre/v1\u0000'), bytesCanonicos({ v: 1, kdf }));

/** Fecha o segredo com a chave do cofre (já derivada da senha com estes `kdf`). */
export function fecharCofre(segredo: Uint8Array, chaveDoCofre: Uint8Array, kdf: ParametrosDaSenha): Cofre {
  if (!parametrosValidos(kdf)) throw new RangeError('parâmetros da senha fora do aceito');
  if (chaveDoCofre.length !== 32) throw new RangeError('a chave do cofre tem 32 bytes');
  const nonce = randomBytes(NONCE);
  const cifrado = xchacha20poly1305(chaveDoCofre, nonce, associados(kdf)).encrypt(segredo);
  return { v: 1, kdf, nonce: paraBase64url(nonce), cifrado: paraBase64url(cifrado) };
}

/** Lê um cofre de fora (formato e parâmetros); `null` se não servir. */
export function lerCofre(c: unknown): Cofre | null {
  if (typeof c !== 'object' || c === null) return null;
  const o = c as Record<string, unknown>;
  const { kdf, nonce, cifrado } = o;
  if (Object.keys(o).length !== 4 || o['v'] !== 1 || !parametrosValidos(kdf)) return null;
  if (typeof nonce !== 'string' || doBase64urlCom(nonce, NONCE) === null || typeof cifrado !== 'string') return null;
  return { v: 1, kdf: { alg: kdf.alg, m: kdf.m, t: kdf.t, p: kdf.p, sal: kdf.sal }, nonce, cifrado };
}

/** Abre o cofre com a chave do cofre; `null` se a chave for outra ou o cofre foi mexido. */
export function abrirCofre(c: unknown, chaveDoCofre: Uint8Array): Uint8Array | null {
  const cofre = lerCofre(c);
  if (!cofre || chaveDoCofre.length !== 32) return null;
  const nonce = doBase64urlCom(cofre.nonce, NONCE)!;
  const cifrado = doBase64url(cofre.cifrado);
  if (!cifrado || cifrado.length < TAG) return null;
  try {
    return xchacha20poly1305(chaveDoCofre, nonce, associados(cofre.kdf)).decrypt(cifrado);
  } catch {
    return null;
  }
}

// --- com a senha (o que as telas da X2 chamam) ---------------------------------------------------------------

/** Fecha o segredo com a senha (parâmetros novos). Devolve o cofre e a chave de entrar (para a ponte). */
export async function fecharComSenha(segredo: Uint8Array, senha: string, opcoes: OpcoesDaSenha = {}): Promise<{ cofre: Cofre; entrar: Uint8Array }> {
  const kdf = novosParametros();
  const chaves = await derivarDaSenha(senha, kdf, opcoes);
  try {
    return { cofre: fecharCofre(segredo, chaves.cofre, kdf), entrar: chaves.entrar };
  } finally {
    apagar(chaves.cofre);
  }
}

/** Abre o cofre com a senha. `null` se a senha estiver errada (ou o cofre não servir). */
export async function abrirComSenha(c: unknown, senha: string, opcoes: OpcoesDaSenha = {}): Promise<{ segredo: Uint8Array; entrar: Uint8Array } | null> {
  const cofre = lerCofre(c);
  if (!cofre || senha.length === 0) return null;
  const chaves = await derivarDaSenha(senha, cofre.kdf, opcoes);
  try {
    const segredo = abrirCofre(cofre, chaves.cofre);
    return segredo ? { segredo, entrar: chaves.entrar } : null;
  } finally {
    apagar(chaves.cofre);
  }
}

/**
 * Troca a senha: abre com a antiga e fecha de novo com a nova (sal novo). Devolve o cofre novo e a chave de entrar
 * nova (para a ponte trocar o `password_hash`); `null` se a senha antiga estiver errada.
 */
export async function trocarSenha(c: unknown, senhaAntiga: string, senhaNova: string, opcoes: OpcoesDaSenha = {}): Promise<{ cofre: Cofre; entrar: Uint8Array } | null> {
  const aberto = await abrirComSenha(c, senhaAntiga, opcoes);
  if (!aberto) return null;
  try {
    return await fecharComSenha(aberto.segredo, senhaNova, opcoes);
  } finally {
    apagar(aberto.segredo);
  }
}

// --- o cofre assinado (X2): a ponte só troca o cofre de quem tem a chave da pessoa ---------------------------------

export const CONTEXTO_COFRE = 'cofre-da-pessoa';

/**
 * A pessoa assina o cofre (o JSON canônico dele, contexto `cofre-da-pessoa`). A ponte confere com a pública da pessoa
 * antes de guardar: quem só tem a sessão (ou trocou a senha pelo e-mail) não consegue pôr outro cofre no lugar.
 */
export function assinarCofre(pessoa: Identidade, cofre: Cofre): string {
  const c = lerCofre(cofre);
  if (!c) throw new RangeError('cofre inválido');
  return paraBase64url(assinar(pessoa, CONTEXTO_COFRE, bytesCanonicos(c)));
}

/** Confere a assinatura do cofre (o que a ponte faz com o `sodium`). */
export function conferirCofreAssinado(publicaDeAssinar: Uint8Array, cofre: unknown, assinatura: string): boolean {
  const c = lerCofre(cofre);
  const a = doBase64urlCom(assinatura, 64);
  return !!c && !!a && conferirAssinatura(publicaDeAssinar, CONTEXTO_COFRE, bytesCanonicos(c), a);
}
