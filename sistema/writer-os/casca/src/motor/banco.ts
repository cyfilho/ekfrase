// SPDX-License-Identifier: MPL-2.0

/**
 * O BANCO CIFRADO do computador (parte do Motor: não sabe nada do Writer). SQLite com a cifra do
 * SQLCipher 4 (`better-sqlite3-multiple-ciphers`, MIT; SQLite3 Multiple Ciphers por baixo), em modo
 * WAL e `synchronous=FULL`: o que o banco diz que gravou está no disco, mesmo se a luz cair.
 *
 * Sem a senha, o arquivo é só ruído: abrir com a senha errada dá `ErroDoBanco('senha')`. Não há
 * "esqueci a senha" (DEC-P063): quem perde a senha perde o acesso aos textos (o espelho `.md`, se
 * ligado, continua legível).
 */
import Database from 'better-sqlite3-multiple-ciphers';
import { existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export type Banco = Database.Database;

export type CodigoErroBanco = 'senha' | 'sem-senha' | 'nao-abre';

export class ErroDoBanco extends Error {
  readonly codigo: CodigoErroBanco;
  constructor(codigo: CodigoErroBanco, causa?: unknown) {
    super(`banco: ${codigo}`, causa === undefined ? undefined : { cause: causa });
    this.name = 'ErroDoBanco';
    this.codigo = codigo;
  }
}

export interface OpcoesBanco {
  /** O caminho do binário nativo (na casca empacotada fica fora do .asar). Padrão: o do pacote. */
  nativo?: string;
  /** Só abre se o arquivo já existir (para conferir a senha de uma pasta que já tem textos). */
  deveExistir?: boolean;
}

/** Abre (ou cria) um banco cifrado com a senha. Confere a senha na hora (lê o esquema). */
export function abrirBanco(caminho: string, senha: string, opcoes: OpcoesBanco = {}): Banco {
  if (!senha) throw new ErroDoBanco('sem-senha');
  if (!opcoes.deveExistir) mkdirSync(dirname(caminho), { recursive: true });
  else if (!existsSync(caminho)) throw new ErroDoBanco('nao-abre');
  let db: Banco;
  try {
    db = new Database(caminho, { ...(opcoes.nativo ? { nativeBinding: opcoes.nativo } : {}), fileMustExist: !!opcoes.deveExistir });
  } catch (e) {
    throw new ErroDoBanco('nao-abre', e);
  }
  try {
    db.pragma(`cipher='sqlcipher'`);
    db.pragma('legacy=4');
    db.key(Buffer.from(senha, 'utf8'));
    // com a senha errada, a primeira leitura falha ("file is not a database")
    db.prepare('SELECT count(*) AS n FROM sqlite_master').get();
  } catch (e) {
    db.close();
    throw new ErroDoBanco('senha', e);
  }
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = FULL');
  db.pragma('foreign_keys = ON');
  return db;
}

/** A senha abre este arquivo? (Não deixa nada aberto.) */
export function senhaAbre(caminho: string, senha: string, opcoes: OpcoesBanco = {}): boolean {
  try {
    abrirBanco(caminho, senha, { ...opcoes, deveExistir: true }).close();
    return true;
  } catch (e) {
    if (e instanceof ErroDoBanco && e.codigo === 'senha') return false;
    throw e;
  }
}

/** O banco está em WAL e `synchronous=FULL`? (Para os testes.) */
export function modoDoBanco(db: Banco): { journal: string; synchronous: number } {
  return { journal: String(db.pragma('journal_mode', { simple: true })), synchronous: Number(db.pragma('synchronous', { simple: true })) };
}
