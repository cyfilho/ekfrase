// SPDX-License-Identifier: MPL-2.0

/**
 * O MANIFESTO de uma atualização (docs/ATUALIZACOES.md §3 e §4): `<app>-<versão>.atualizacao.json` + o `.minisig` dele.
 * Diz a versão, o canal e, por arquivo, o papel, o nome, o tamanho e o SHA-256. O lacre cobre o manifesto inteiro; os
 * arquivos ficam amarrados pelo SHA-256 que está nele. O comentário de confiança diz o app e a versão
 * (`Ekfrase Writer OS 0.2.0 atualizacao`): um lacre de outro app ou de outra versão é recusado.
 *
 * O MESMO formato é lido pelo `ekfrase-atualizar.sh` do Writer OS (com o `jq`, como root, antes de gravar): mudou
 * aqui, mude lá.
 */
import { conferirAssinatura, hashesDeBytes, lerChavePublica } from './minisign.ts';
import { ehVersao, type Canal } from './versoes.ts';

export interface ArquivoDaAtualizacao {
  /** O que o arquivo é (no Writer OS: `squashfs`, `vmlinuz`, `initrd`, `grub.cfg`). */
  papel: string;
  nome: string;
  tamanho: number;
  sha256: string;
}

export interface Manifesto {
  app: string;
  versao: string;
  canal: Canal;
  arquivos: ArquivoDaAtualizacao[];
}

export type MotivoManifesto = 'formato' | 'lacre' | 'outro-app' | 'outra-versao';

export class ErroManifesto extends Error {
  readonly motivo: MotivoManifesto;
  constructor(motivo: MotivoManifesto, detalhe = '') {
    super(detalhe ? `${motivo}: ${detalhe}` : motivo);
    this.motivo = motivo;
  }
}

/** O nome de um arquivo de atualização: letras, números, ponto, traço; nada de barra nem de ponto no começo. */
export const NOME_DE_ARQUIVO = /^[a-z0-9][a-z0-9.-]{0,120}$/;

export const nomeDoManifesto = (app: string, versao: string): string => `${app}-${versao}.atualizacao.json`;
export const comentarioDoLacre = (nome: string, versao: string): string => `${nome} ${versao} atualizacao`;

/** Lê o manifesto e recusa o que foge do formato (o lacre ainda não foi conferido aqui). */
export function lerManifesto(texto: string): Manifesto {
  let j: unknown;
  try {
    j = JSON.parse(texto);
  } catch {
    throw new ErroManifesto('formato', 'não é JSON');
  }
  const m = j as Partial<Manifesto>;
  if (!m || typeof m !== 'object' || typeof m.app !== 'string' || !NOME_DE_ARQUIVO.test(m.app)) throw new ErroManifesto('formato', 'app');
  if (!ehVersao(m.versao)) throw new ErroManifesto('formato', 'versao');
  if (m.canal !== 'estavel' && m.canal !== 'teste') throw new ErroManifesto('formato', 'canal');
  if (!Array.isArray(m.arquivos) || !m.arquivos.length || m.arquivos.length > 16) throw new ErroManifesto('formato', 'arquivos');
  const arquivos: ArquivoDaAtualizacao[] = [];
  const papeis = new Set<string>();
  for (const a of m.arquivos as Partial<ArquivoDaAtualizacao>[]) {
    if (typeof a?.papel !== 'string' || !/^[a-z0-9.-]{1,20}$/.test(a.papel) || papeis.has(a.papel)) throw new ErroManifesto('formato', 'papel');
    if (typeof a.nome !== 'string' || !NOME_DE_ARQUIVO.test(a.nome)) throw new ErroManifesto('formato', 'nome');
    if (typeof a.tamanho !== 'number' || !Number.isSafeInteger(a.tamanho) || a.tamanho <= 0) throw new ErroManifesto('formato', 'tamanho');
    if (typeof a.sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(a.sha256)) throw new ErroManifesto('formato', 'sha256');
    papeis.add(a.papel);
    arquivos.push({ papel: a.papel, nome: a.nome, tamanho: a.tamanho, sha256: a.sha256 });
  }
  return { app: m.app, versao: m.versao, canal: m.canal, arquivos };
}

/**
 * Confere o lacre do manifesto com uma das `chaves` (a da Ekfrase; nos testes, uma chave de teste a mais) e que ele é
 * do app `app` (nome `nome` no comentário) na versão `versao`. Devolve o manifesto lido.
 */
export function conferirManifesto(texto: string, minisig: string, o: { chaves: readonly string[]; app: string; nome: string; versao: string }): Manifesto {
  const { blake2b } = hashesDeBytes(new TextEncoder().encode(texto));
  let comentario: string | null = null;
  for (const c of o.chaves) {
    let chave;
    try {
      chave = lerChavePublica(c);
    } catch {
      continue;
    }
    const r = conferirAssinatura(chave, minisig, blake2b);
    if (r.ok) {
      comentario = r.comentario;
      break;
    }
  }
  if (comentario === null) throw new ErroManifesto('lacre');
  if (comentario !== comentarioDoLacre(o.nome, o.versao)) throw new ErroManifesto('outra-versao', comentario);
  const m = lerManifesto(texto);
  if (m.app !== o.app) throw new ErroManifesto('outro-app', m.app);
  if (m.versao !== o.versao) throw new ErroManifesto('outra-versao', m.versao);
  return m;
}
