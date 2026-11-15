// SPDX-License-Identifier: MPL-2.0

/**
 * O COFRE de uma pasta de dados (parte do Motor; DEC-P063): a senha obrigatória. Não existe pasta
 * sem senha, e não existe "esqueci a senha": sem ela os textos não abrem (a tela avisa antes de criar).
 *
 * `dados/cofre.db` é um banco cifrado pequeno, com a mesma senha de todos os bancos da pasta. Ele
 * confere a senha (abrir com a errada falha) e guarda o rascunho de emergência (o que a página não
 * conseguiu gravar quando ia fechar), também cifrado: nada de texto sai da cifra.
 *
 * A senha fica só na memória do processo principal enquanto os textos estão abertos (para abrir o
 * banco de cada dono) e some ao trancar ou fechar a casca.
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { SENHA_MINIMA } from '@ekfrase/writer-nucleo';
import { abrirBanco, ErroDoBanco, type Banco } from './banco.ts';

export const ARQUIVO_DO_COFRE = 'cofre.db';

export class Cofre {
  /** `<pasta do app>/dados`. */
  readonly pastaDosBancos: string;
  private readonly nativo: string | undefined;
  private db: Banco | null = null;
  private senhaAberta: string | null = null;

  constructor(pastaDoApp: string, nativo?: string) {
    this.pastaDosBancos = join(pastaDoApp, 'dados');
    this.nativo = nativo;
  }

  /** A pasta já tem textos (e uma senha)? */
  get temSenha(): boolean {
    return existsSync(join(this.pastaDosBancos, ARQUIVO_DO_COFRE));
  }

  get aberto(): boolean {
    return this.db !== null;
  }

  /** A senha, só enquanto aberto (para abrir os bancos dos donos). */
  get senha(): string {
    if (!this.senhaAberta) throw new ErroDoBanco('sem-senha');
    return this.senhaAberta;
  }

  private ligar(senha: string, criar: boolean): void {
    const db = abrirBanco(join(this.pastaDosBancos, ARQUIVO_DO_COFRE), senha, { ...(this.nativo ? { nativo: this.nativo } : {}), deveExistir: !criar });
    db.exec('CREATE TABLE IF NOT EXISTS rascunhos (chave TEXT PRIMARY KEY, valor TEXT NOT NULL)');
    db.exec('CREATE TABLE IF NOT EXISTS segredos (chave TEXT PRIMARY KEY, valor TEXT NOT NULL)');
    this.db = db;
    this.senhaAberta = senha;
  }

  /** Pasta nova: cria o cofre com esta senha. */
  criar(senha: string): void {
    if (senha.length < SENHA_MINIMA) throw new ErroDoBanco('sem-senha');
    if (this.temSenha) throw new ErroDoBanco('nao-abre');
    this.ligar(senha, true);
  }

  /** Abre com a senha. Errada: `ErroDoBanco('senha')`. */
  abrir(senha: string): void {
    this.fechar();
    this.ligar(senha, false);
  }

  fechar(): void {
    try {
      this.db?.close();
    } catch {
      // já fechado
    }
    this.db = null;
    this.senhaAberta = null;
  }

  // ---------- o rascunho de emergência (síncrono: a página está fechando) ----------

  porRascunho(chave: string, valor: string): boolean {
    if (!this.db) return false;
    try {
      this.db.prepare('INSERT INTO rascunhos (chave, valor) VALUES (?, ?) ON CONFLICT(chave) DO UPDATE SET valor = excluded.valor').run(chave, valor);
      return true;
    } catch {
      return false;
    }
  }

  tirarRascunho(chave: string): void {
    this.db?.prepare('DELETE FROM rascunhos WHERE chave = ?').run(chave);
  }

  // ---------- os segredos do sistema (Writer OS: as redes Wi-Fi conhecidas, o que a página lembra) ----------
  // Ficam cifrados aqui, nunca na página: a página não lê esta tabela.

  segredo(chave: string): string | null {
    if (!this.db) return null;
    const l = this.db.prepare('SELECT valor FROM segredos WHERE chave = ?').get(chave) as { valor: string } | undefined;
    return l?.valor ?? null;
  }

  porSegredo(chave: string, valor: string | null): void {
    if (!this.db) return;
    if (valor === null) this.db.prepare('DELETE FROM segredos WHERE chave = ?').run(chave);
    else this.db.prepare('INSERT INTO segredos (chave, valor) VALUES (?, ?) ON CONFLICT(chave) DO UPDATE SET valor = excluded.valor').run(chave, valor);
  }

  rascunhos(): Record<string, string> {
    if (!this.db) return {};
    const saida: Record<string, string> = {};
    for (const l of this.db.prepare('SELECT chave, valor FROM rascunhos').all() as { chave: string; valor: string }[]) saida[l.chave] = l.valor;
    return saida;
  }
}
