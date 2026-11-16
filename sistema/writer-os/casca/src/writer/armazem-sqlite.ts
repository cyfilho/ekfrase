// SPDX-License-Identifier: MPL-2.0

/**
 * O armazém do Writer no computador: SQLite cifrado (`motor/banco.ts`), um arquivo por dono
 * (`textos-<dono>.db`), como o IndexedDB da web tem um banco por dono. Estende `ArmazemComum`
 * (toda a regra fica lá) e só implementa a transação; passa pela MESMA bateria dos outros
 * adaptadores (`tests/writer-nucleo.test.ts`).
 *
 * Roda no PROCESSO PRINCIPAL da casca. A página nunca toca no banco: fala com ele pelo preload
 * (`ArmazemPonte` do núcleo, do lado da página; `motor/ponte-armazem.ts`, do lado de cá).
 *
 * O `better-sqlite3` é síncrono; a `Transacao` do núcleo é assíncrona. Para duas transações nunca
 * se misturarem (uma começa enquanto a outra espera um `await`), elas entram numa fila, uma de
 * cada vez, como no `ArmazemMemoria`. Cada transação de escrita é `BEGIN IMMEDIATE … COMMIT`: com
 * `synchronous=FULL`, quando a promessa resolve, o texto está no disco.
 */
import { ArmazemComum, DONO_LOCAL, type EscritaDia, type Guardado, type LojaLocal, type OpcoesArmazem, type Transacao, type VersaoCena } from '@ekfrase/writer-nucleo';
import { join } from 'node:path';
import { abrirBanco, type Banco } from '../motor/banco.ts';

/** O nome do arquivo de um dono (só letras, números, `-` e `_`; o resto vira `_`). */
export const arquivoDoDono = (dono: string): string => `textos-${dono.replace(/[^A-Za-z0-9_-]/g, '_')}.db`;

export interface OpcoesSQLite extends OpcoesArmazem {
  /** A pasta dos bancos (`<pasta>/Ekfrase Writer/dados`). */
  pasta: string;
  senha: string;
  /** O binário nativo do SQLite (ver `motor/banco.ts`). */
  nativo?: string;
}

const ESQUEMA = `
CREATE TABLE IF NOT EXISTS registros (id TEXT PRIMARY KEY, colecao TEXT NOT NULL, pendente INTEGER NOT NULL, json TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS registros_colecao ON registros (colecao, id);
CREATE INDEX IF NOT EXISTS registros_pendente ON registros (pendente, id);
CREATE TABLE IF NOT EXISTS versoes_cena (id TEXT PRIMARY KEY, cena TEXT NOT NULL, json TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS versoes_cena_cena ON versoes_cena (cena, id);
CREATE TABLE IF NOT EXISTS escrita_dia (data TEXT PRIMARY KEY, json TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS meta (chave TEXT PRIMARY KEY, json TEXT NOT NULL);
`;

type Linha = { json: string } | undefined;
const ler = <T>(linha: unknown): T | undefined => ((linha as Linha) ? (JSON.parse((linha as { json: string }).json) as T) : undefined);
const lerTodas = <T>(linhas: unknown[]): T[] => (linhas as { json: string }[]).map((l) => JSON.parse(l.json) as T);

export class ArmazemSQLite extends ArmazemComum {
  readonly caminho: string;
  private readonly db: Banco;
  private vez: Promise<unknown> = Promise.resolve();
  private fechado = false;
  private readonly sql: ReturnType<typeof preparar>;

  private constructor(db: Banco, caminho: string, opcoes: OpcoesArmazem) {
    super(opcoes);
    this.db = db;
    this.caminho = caminho;
    db.exec(ESQUEMA);
    this.sql = preparar(db);
  }

  /** Abre (ou cria) o banco do dono na pasta, com a senha. Senha errada: `ErroDoBanco('senha')`. */
  static async abrir(opcoes: OpcoesSQLite): Promise<ArmazemSQLite> {
    const { pasta, senha, nativo, ...resto } = opcoes;
    const dono = resto.dono ?? DONO_LOCAL;
    const caminho = join(pasta, arquivoDoDono(dono));
    const db = abrirBanco(caminho, senha, nativo ? { nativo } : {});
    return new ArmazemSQLite(db, caminho, { ...resto, dono });
  }

  /** `PRAGMA integrity_check` (o teste de arrancar o pendrive no meio de uma gravação): `ok` ou o defeito. */
  integridade(): string {
    const r = this.db.prepare('PRAGMA integrity_check').all() as { integrity_check: string }[];
    return r.map((l) => l.integrity_check).join('; ') || 'vazio';
  }

  protected transacao<T>(escreve: boolean, f: (t: Transacao) => Promise<T>): Promise<T> {
    const rodar = async (): Promise<T> => {
      if (this.fechado) throw new Error('armazém fechado');
      const s = this.sql;
      const t: Transacao = {
        obter: async (id) => ler<Guardado>(s.obter.get(id)),
        por: async (g) => void s.por.run(g.id, g.colecao, g.pendente, JSON.stringify(g)),
        tirar: async (id) => void s.tirar.run(id),
        daColecao: async (colecao) => lerTodas<Guardado>(s.daColecao.all(colecao)),
        pendentes: async () => lerTodas<Guardado>(s.pendentes.all()),
        todos: async () => lerTodas<Guardado>(s.todos.all()),
        lerMeta: async (chave) => ler<unknown>(s.lerMeta.get(chave)),
        porMeta: async (chave, valor) => void s.porMeta.run(chave, JSON.stringify(valor)),
        lerLocal: async (loja: LojaLocal, chave) => ler<unknown>((loja === 'versoes_cena' ? s.lerVersao : s.lerDia).get(chave)),
        listarLocal: async (loja: LojaLocal, cena) =>
          lerTodas<unknown>(loja === 'versoes_cena' ? (cena === undefined ? s.listarVersoes.all() : s.versoesDaCena.all(cena)) : s.listarDias.all()),
        porLocal: async (loja: LojaLocal, valor: VersaoCena | EscritaDia) => {
          if (loja === 'versoes_cena') {
            const v = valor as VersaoCena;
            s.porVersao.run(v.id, v.cena, JSON.stringify(v));
          } else {
            const d = valor as EscritaDia;
            s.porDia.run(d.data, JSON.stringify(d));
          }
        },
        tirarLocal: async (loja: LojaLocal, chave) => void (loja === 'versoes_cena' ? s.tirarVersao : s.tirarDia).run(chave),
        limpar: async () => void this.db.exec('DELETE FROM registros; DELETE FROM versoes_cena; DELETE FROM escrita_dia; DELETE FROM meta;'),
      };
      if (!escreve) return f(t);
      this.db.exec('BEGIN IMMEDIATE');
      try {
        const saida = await f(t);
        this.db.exec('COMMIT');
        return saida;
      } catch (e) {
        if (this.db.inTransaction) this.db.exec('ROLLBACK');
        throw e;
      }
    };
    const p = this.vez.then(rodar, rodar);
    this.vez = p.catch(() => undefined);
    return p;
  }

  /** Fecha depois da última transação da fila. */
  fechar(): void {
    const fim = () => {
      if (this.fechado) return;
      this.fechado = true;
      try {
        this.db.close();
      } catch {
        // já estava fechado
      }
    };
    this.vez = this.vez.then(fim, fim);
  }

  /** Espera a fila esvaziar (a casca, antes de sair; os testes). */
  async terminar(): Promise<void> {
    await this.vez;
  }

  /** O modo do banco (WAL, `synchronous`), para os testes. */
  modo(): { journal: string; synchronous: number } {
    return { journal: String(this.db.pragma('journal_mode', { simple: true })), synchronous: Number(this.db.pragma('synchronous', { simple: true })) };
  }
}

function preparar(db: Banco) {
  const p = (s: string) => db.prepare(s);
  return {
    obter: p('SELECT json FROM registros WHERE id = ?'),
    por: p('INSERT INTO registros (id, colecao, pendente, json) VALUES (?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET colecao = excluded.colecao, pendente = excluded.pendente, json = excluded.json'),
    tirar: p('DELETE FROM registros WHERE id = ?'),
    daColecao: p('SELECT json FROM registros WHERE colecao = ? ORDER BY id'),
    pendentes: p('SELECT json FROM registros WHERE pendente = 1 ORDER BY id'),
    todos: p('SELECT json FROM registros ORDER BY id'),
    lerMeta: p('SELECT json FROM meta WHERE chave = ?'),
    porMeta: p('INSERT INTO meta (chave, json) VALUES (?, ?) ON CONFLICT(chave) DO UPDATE SET json = excluded.json'),
    lerVersao: p('SELECT json FROM versoes_cena WHERE id = ?'),
    listarVersoes: p('SELECT json FROM versoes_cena ORDER BY id'),
    versoesDaCena: p('SELECT json FROM versoes_cena WHERE cena = ? ORDER BY id'),
    porVersao: p('INSERT INTO versoes_cena (id, cena, json) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET cena = excluded.cena, json = excluded.json'),
    tirarVersao: p('DELETE FROM versoes_cena WHERE id = ?'),
    lerDia: p('SELECT json FROM escrita_dia WHERE data = ?'),
    listarDias: p('SELECT json FROM escrita_dia ORDER BY data'),
    porDia: p('INSERT INTO escrita_dia (data, json) VALUES (?, ?) ON CONFLICT(data) DO UPDATE SET json = excluded.json'),
    tirarDia: p('DELETE FROM escrita_dia WHERE data = ?'),
  };
}
