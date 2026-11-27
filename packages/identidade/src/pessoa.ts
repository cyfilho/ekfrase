// SPDX-License-Identifier: MPL-2.0

/**
 * A pessoa e os aparelhos dela, de ponta a ponta (o que as telas da X2 vão chamar).
 *
 * - `novaPessoa`: o kit (a semente) e a identidade da pessoa. A semente vai para o cofre (`fecharComSenha`) e o kit
 *   é oferecido para a pessoa guardar.
 * - `pessoaDoKit`: esqueceu a senha? As 12 palavras refazem a mesma identidade.
 * - `novoAparelho` + `apresentarAparelho`: cada navegador, computador ou pendrive tem o próprio par; a pessoa o
 *   apresenta com o certificado.
 * - `levarSemente` / `receberSemente`: "confirme no outro aparelho": um aparelho seu já aberto entrega a semente da
 *   pessoa ao aparelho novo numa caixa para a chave dele (o aparelho novo ainda precisa ser conferido pela pessoa
 *   nos dois lados: o parear, X14, e a tela da X2).
 */
import { abrirCaixa, fecharCaixa } from './caixa.ts';
import { emitirCertificado, type CertificadoDeAparelho } from './certificado.ts';
import { identidadeDaSemente, novaSementeDeAparelho, type ChavesPublicas, type Identidade } from './chaves.ts';
import { lerKit, novoKit, type ErroDoKit, type IdiomaDoKit, type Kit } from './kit.ts';

export interface PessoaNova {
  readonly kit: Kit;
  readonly identidade: Identidade;
}

/** Uma pessoa nova: o kit sorteado e a identidade que sai dele. */
export function novaPessoa(idioma: IdiomaDoKit = 'pt'): PessoaNova {
  const kit = novoKit(idioma);
  return { kit, identidade: identidadeDaSemente(kit.semente) };
}

/** A identidade da pessoa a partir das 12 palavras. */
export function pessoaDoKit(texto: string | readonly string[]): { readonly ok: true; readonly semente: Uint8Array; readonly identidade: Identidade } | { readonly ok: false; readonly erro: ErroDoKit; readonly posicoes?: readonly number[] } {
  const k = lerKit(texto);
  if (!k.ok) return k;
  return { ok: true, semente: k.semente, identidade: identidadeDaSemente(k.semente) };
}

export interface AparelhoNovo {
  /** 32 bytes: vão para o armazém do aparelho (no computador, dentro do SQLCipher). */
  readonly semente: Uint8Array;
  readonly identidade: Identidade;
}

export function novoAparelho(): AparelhoNovo {
  const semente = novaSementeDeAparelho();
  return { semente, identidade: identidadeDaSemente(semente) };
}

/** A pessoa apresenta o aparelho (o certificado assinado por ela). */
export function apresentarAparelho(pessoa: Identidade, aparelho: ChavesPublicas, nome: string, criado?: number): CertificadoDeAparelho {
  return emitirCertificado(pessoa, aparelho, nome, criado);
}

const CONTEXTO_SEMENTE = 'semente-da-pessoa';

/** Um aparelho já aberto fecha a semente da pessoa para a pública de `cifrar` do aparelho novo. */
export function levarSemente(sementeDaPessoa: Uint8Array, publicaDoAparelhoNovo: Uint8Array): Uint8Array {
  if (sementeDaPessoa.length !== 16) throw new RangeError('a semente da pessoa tem 16 bytes');
  return fecharCaixa(publicaDoAparelhoNovo, CONTEXTO_SEMENTE, sementeDaPessoa);
}

/** O aparelho novo abre a semente que chegou; `null` se não era para ele. */
export function receberSemente(aparelhoNovo: Identidade, caixa: Uint8Array): Uint8Array | null {
  const s = abrirCaixa(aparelhoNovo, CONTEXTO_SEMENTE, caixa);
  return s && s.length === 16 ? s : null;
}
