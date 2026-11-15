// SPDX-License-Identifier: MPL-2.0

/**
 * O núcleo do Ekfrase Writer: modelo, UUID v7, relógio, palavras, o ARMAZÉM (os dois adaptadores
 * passam pela MESMA bateria) e as operações de domínio (`Escrita`).
 */
import 'fake-indexeddb/auto';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ArmazemSQLite } from '../sistema/writer-os/casca/src/writer/armazem-sqlite.ts';
import {
  ArmazemIndexedDB,
  ArmazemMemoria,
  ArmazemPonte,
  COLECOES,
  DONO_LOCAL,
  ErroEscrita,
  Escrita,
  INTERVALO_DE_VERSAO,
  MAX_VERSOES_POR_CENA,
  Relogio,
  STATUS_CENA,
  TIPOS_IDEIA,
  adotar,
  contarPalavras,
  ehHlc,
  ehOrdem,
  ehUuidV7,
  maiorHlc,
  nomeDoBanco,
  novoAparelho,
  padroes,
  paraEntidade,
  servirArmazem,
  tempoDoUuid,
  uuidv7,
  versoesDe,
  type Armazem,
  type Mudanca,
  type OpcoesArmazem,
  type Registro,
} from '../packages/writer-nucleo/src/index.ts';

const T0 = 1794480000000;

/** Um relógio de mentira que os testes adiantam. */
function relogio(inicio = T0): { agora: () => number; passar: (ms: number) => void } {
  let t = inicio;
  return { agora: () => t, passar: (ms) => void (t += ms) };
}

let conta = 0;
const donoNovo = (): string => `teste-${++conta}`;

describe('modelo, UUID v7, relógio e palavras', () => {
  it('as listas fechadas são as do plano (iguais às do Persis)', () => {
    expect([...COLECOES]).toEqual(['historias', 'capitulos', 'cenas', 'ideias', 'personagens']);
    expect([...STATUS_CENA]).toEqual(['ideia', 'planejada', 'rascunho', 'escrita', 'revisada', 'final']);
    expect([...TIPOS_IDEIA]).toEqual(['premissa', 'personagem', 'cena', 'dialogo', 'cenario', 'titulo', 'reviravolta', 'imagem', 'outro']);
  });

  it('os campos de cada coleção (§3 do plano)', () => {
    expect(Object.keys(padroes('historias')).sort()).toEqual(['capa', 'formato', 'genero', 'logline', 'meta_palavras', 'ponto_vista', 'publico', 'sinopse', 'subtitulo', 'tema', 'tempo_verbal', 'titulo']);
    expect(Object.keys(padroes('capitulos')).sort()).toEqual(['historia', 'ordem', 'resumo', 'titulo']);
    for (const campo of ['historia', 'capitulo', 'titulo', 'resumo', 'objetivo', 'conflito', 'desfecho', 'texto', 'palavras', 'meta_palavras', 'status', 'ordem']) expect(padroes('cenas')).toHaveProperty(campo);
    expect(Object.keys(padroes('ideias')).sort()).toEqual(['etiquetas', 'fixada', 'historia', 'texto', 'tipo', 'titulo', 'virou_id', 'virou_tipo']);
    expect(Object.keys(padroes('personagens')).sort()).toEqual(['desejo', 'historia', 'medo', 'necessidade', 'nome', 'notas', 'papel']);
  });

  it('paraEntidade: campos lado a lado, padrões no que falta, sem _v', () => {
    const r: Registro = { id: uuidv7(T0), colecao: 'cenas', versao: '1794480000000-0000-aaaaaaaa', apagado: false, dados: { titulo: 'Oi', _v: { titulo: '1794480000000-0000-aaaaaaaa' } } };
    const cena = paraEntidade(r, 'cenas', 'ana');
    expect(cena).toMatchObject({ id: r.id, versao: r.versao, apagado: false, dono: 'ana', titulo: 'Oi', texto: '', status: 'rascunho', capitulo: null, conflito_de: null });
    expect(cena).not.toHaveProperty('_v');
  });

  it('uuidv7: formato, tempo e ordem', () => {
    const a = uuidv7(T0);
    const b = uuidv7(T0 + 1);
    expect(ehUuidV7(a)).toBe(true);
    expect(a).toBe(a.toLowerCase());
    expect(tempoDoUuid(a)).toBe(T0);
    expect(a < b).toBe(true);
    expect(uuidv7(T0, () => new Uint8Array(10))).toBe('01a1cf57-cc00-7000-8000-000000000000');
    expect(uuidv7(T0, () => new Uint8Array(10).fill(0xff))).toBe('01a1cf57-cc00-7fff-bfff-ffffffffffff');
    const muitos = new Set(Array.from({ length: 500 }, () => uuidv7()));
    expect(muitos.size).toBe(500);
    for (const id of muitos) expect(ehUuidV7(id)).toBe(true);
    expect(ehUuidV7('0193A5C0-0000-7000-8000-000000000001')).toBe(false);
    expect(ehUuidV7('0193a5c0-0000-4000-8000-000000000001')).toBe(false);
  });

  it('relógio: nunca anda para trás e absorve o que vem do servidor', () => {
    const r = relogio();
    const hlc = new Relogio({ aparelho: 'aaaaaaaa', agora: r.agora });
    const v1 = hlc.agora();
    r.passar(-60_000);
    const v2 = hlc.agora();
    expect(v2 > v1).toBe(true);
    hlc.absorver('1794480999000-0003-bbbbbbbb');
    const v3 = hlc.agora();
    expect(v3).toBe('1794480999000-0004-aaaaaaaa');
    expect(maiorHlc(v1, v2, v3, null, undefined)).toBe(v3);
    expect(() => new Relogio({ aparelho: 'XYZ' })).toThrow();
    expect(() => hlc.absorver('ontem')).toThrow();
    expect(novoAparelho()).toMatch(/^[0-9a-f]{8}$/);
    expect(novoAparelho(() => new Uint8Array([1, 0xab, 0, 0xff]))).toBe('01ab00ff');
  });

  it('contarPalavras: português e inglês', () => {
    expect(contarPalavras('')).toBe(0);
    expect(contarPalavras('   \n\t ')).toBe(0);
    expect(contarPalavras('Era uma vez.')).toBe(3);
    expect(contarPalavras('— Não! — disse a mãe d’água.')).toBe(5);
    expect(contarPalavras("Don't stop; it's a well-known guarda-chuva.")).toBe(6);
    expect(contarPalavras('**Negrito** e _itálico_ # título')).toBe(4);
    expect(contarPalavras('ação coração über naïve')).toBe(4);
    expect(contarPalavras('Em 1999, 3 gatos.')).toBe(4);
    expect(contarPalavras('um\ndois\r\n\r\ntrês')).toBe(3);
  });
});

// ---------- o armazém: a mesma bateria para os dois adaptadores ----------

interface Adaptador {
  nome: string;
  abrir(o: OpcoesArmazem): Promise<Armazem>;
  /** Fecha e abre de novo o mesmo dono (só faz sentido onde os dados ficam guardados). */
  persiste: boolean;
}

// a casca do computador: SQLite cifrado (uma pasta para todos os donos, como um aparelho só)
const PASTA_SQLITE = mkdtempSync(join(tmpdir(), 'ekfrase-writer-sqlite-'));
const SENHA = 'senha dos testes';
const abrirSQLite = (o: OpcoesArmazem) => ArmazemSQLite.abrir({ ...o, pasta: PASTA_SQLITE, senha: SENHA });

/**
 * A página da casca fala com o SQLite pela ponte (preload ↔ processo principal): aqui, a ponte é de
 * mentira, mas copia tudo nos dois sentidos (`structuredClone`, como o IPC do Electron).
 */
async function abrirPelaPonte(o: OpcoesArmazem): Promise<Armazem> {
  const a = await abrirSQLite(o);
  const ouvintes = new Set<(m: Mudanca) => void>();
  a.aoMudar((m) => ouvintes.forEach((f) => f(structuredClone(m))));
  return new ArmazemPonte(a.dono, {
    chamar: async (metodo, args) => structuredClone(await servirArmazem(a, metodo, structuredClone(args))),
    aoMudar: (f) => (ouvintes.add(f), () => ouvintes.delete(f)),
    fechar: () => a.fechar(),
  });
}

const ADAPTADORES: Adaptador[] = [
  { nome: 'ArmazemMemoria', abrir: async (o) => new ArmazemMemoria(o), persiste: false },
  { nome: 'ArmazemIndexedDB', abrir: (o) => ArmazemIndexedDB.abrir(o), persiste: true },
  { nome: 'ArmazemSQLite (casca do computador, cifrado)', abrir: abrirSQLite, persiste: true },
  { nome: 'ArmazemPonte → ArmazemSQLite (a página da casca)', abrir: abrirPelaPonte, persiste: true },
];

const servidor = (id: string, colecao: Registro['colecao'], campos: Record<string, unknown>, versao: string, apagado = false): Registro => ({
  id,
  colecao,
  versao,
  apagado,
  dados: { ...campos, _v: { ...Object.fromEntries(Object.keys(campos).map((c) => [c, versao])), ...(apagado ? { apagado: versao } : {}) } },
});

for (const ad of ADAPTADORES) {
  // o SQLite cifrado deriva a chave a cada abertura (lento de propósito): no runner do público passava de 5 s (15/11/2026)
  describe(`armazém: ${ad.nome}`, { timeout: 60_000 }, () => {
    const novo = async (extra: Partial<OpcoesArmazem> = {}): Promise<{ a: Armazem; r: ReturnType<typeof relogio>; dono: string }> => {
      const r = relogio();
      const dono = extra.dono ?? donoNovo();
      return { a: await ad.abrir({ dono, aparelho: 'aaaaaaaa', agora: r.agora, ...extra }), r, dono };
    };

    it('gravar carimba versao e dados._v só do que mudou', async () => {
      const { a, r } = await novo();
      const id = uuidv7(T0);
      const g1 = await a.gravar({ colecao: 'historias', id, dados: { titulo: 'A torre', genero: 'fantasia' } });
      expect(ehHlc(g1.versao)).toBe(true);
      expect(g1.versao.endsWith('-aaaaaaaa')).toBe(true);
      expect(g1.apagado).toBe(false);
      expect(versoesDe(g1.dados)).toEqual({ titulo: g1.versao, genero: g1.versao });
      r.passar(1000);
      const g2 = await a.gravar({ colecao: 'historias', id, dados: { titulo: 'A torre', genero: 'terror' } });
      expect(g2.versao > g1.versao).toBe(true);
      expect(versoesDe(g2.dados)).toEqual({ titulo: g1.versao, genero: g2.versao });
      expect(g2.versao).toBe(maiorHlc(...Object.values(versoesDe(g2.dados))));
      // gravar o mesmo valor não muda nada (nem a versão)
      r.passar(1000);
      const g3 = await a.gravar({ colecao: 'historias', id, dados: { genero: 'terror' } });
      expect(g3).toEqual(g2);
      expect(await a.ler('historias', id)).toEqual(g2);
      expect(await a.ler('cenas', id)).toBeNull();
      expect(await a.ler('historias', uuidv7())).toBeNull();
      a.fechar();
    });

    it('o que se lê é cópia: mexer no objeto não mexe no armazém', async () => {
      const { a } = await novo();
      const id = uuidv7(T0);
      const etiquetas = ['mar'];
      await a.gravar({ colecao: 'ideias', id, dados: { titulo: 'x', etiquetas } });
      etiquetas.push('de fora');
      const lido = await a.ler('ideias', id);
      (lido!.dados['etiquetas'] as string[]).push('de fora também');
      expect((await a.ler('ideias', id))!.dados['etiquetas']).toEqual(['mar']);
      a.fechar();
    });

    it('gravarVarios é tudo ou nada, com a mesma versão', async () => {
      const { a } = await novo();
      const [h, c] = [uuidv7(T0), uuidv7(T0 + 1)];
      const gravados = await a.gravarVarios([
        { colecao: 'historias', id: h, dados: { titulo: 'H' } },
        { colecao: 'capitulos', id: c, dados: { historia: h, titulo: 'C', ordem: 'a0' } },
      ]);
      expect(gravados.map((g) => g.versao)).toEqual([gravados[0]!.versao, gravados[0]!.versao]);
      await expect(
        a.gravarVarios([
          { colecao: 'historias', id: h, dados: { titulo: 'mudou' } },
          { colecao: 'cenas', id: 'não é uuid', dados: { titulo: 'ruim' } },
        ]),
      ).rejects.toThrow();
      expect((await a.ler('historias', h))!.dados['titulo']).toBe('H');
      // um id não troca de coleção
      await expect(a.gravar({ colecao: 'cenas', id: h, dados: { titulo: 'x' } })).rejects.toThrow();
      // e o armazém segue funcionando depois do erro
      await a.gravar({ colecao: 'historias', id: h, dados: { titulo: 'H2' } });
      expect((await a.ler('historias', h))!.dados['titulo']).toBe('H2');
      a.fechar();
    });

    it('listar: por coleção, história, capítulo e lápides', async () => {
      const { a } = await novo();
      const [h1, h2, cap, c1, c2, c3] = Array.from({ length: 6 }, (_, i) => uuidv7(T0 + i));
      await a.gravarVarios([
        { colecao: 'historias', id: h1!, dados: { titulo: '1' } },
        { colecao: 'historias', id: h2!, dados: { titulo: '2' } },
        { colecao: 'capitulos', id: cap!, dados: { historia: h1, ordem: 'a0' } },
        { colecao: 'cenas', id: c1!, dados: { historia: h1, capitulo: cap, ordem: 'a0' } },
        { colecao: 'cenas', id: c2!, dados: { historia: h1, capitulo: null, ordem: 'a0' } },
        { colecao: 'cenas', id: c3!, dados: { historia: h2, capitulo: null, ordem: 'a0' } },
      ]);
      const ids = async (...p: Parameters<Armazem['listar']>): Promise<string[]> => (await a.listar(...p)).map((x) => x.id).sort();
      expect(await ids('historias')).toEqual([h1, h2].sort());
      expect(await ids('cenas')).toEqual([c1, c2, c3].sort());
      expect(await ids('cenas', { historia: h1! })).toEqual([c1, c2].sort());
      expect(await ids('cenas', { historia: h1!, capitulo: null })).toEqual([c2]);
      expect(await ids('cenas', { capitulo: cap! })).toEqual([c1]);
      const apagada = await a.gravar({ colecao: 'cenas', id: c1!, apagado: true });
      expect(apagada.apagado).toBe(true);
      expect(versoesDe(apagada.dados)['apagado']).toBe(apagada.versao);
      expect(apagada.dados['historia']).toBe(h1);
      expect(await ids('cenas', { historia: h1! })).toEqual([c2]);
      expect(await ids('cenas', { historia: h1!, apagados: true })).toEqual([c1, c2].sort());
      // editar um registro apagado (versão maior que a da lápide) traz de volta
      const voltou = await a.gravar({ colecao: 'cenas', id: c1!, dados: { titulo: 'voltei' } });
      expect(voltou.apagado).toBe(false);
      a.fechar();
    });

    it('fila de saída: mudancasDesde, marcarEnviadas, base', async () => {
      const { a, r } = await novo();
      const ids = Array.from({ length: 5 }, (_, i) => uuidv7(T0 + i));
      for (const id of ids) {
        r.passar(10);
        await a.gravar({ colecao: 'ideias', id, dados: { titulo: id } });
      }
      expect(await a.pendentes()).toEqual({ fila: 5, recusados: 0 });
      const p1 = await a.mudancasDesde(0, 2);
      expect(p1.registros.map((x) => x.id)).toEqual(ids.slice(0, 2));
      expect(p1.mais).toBe(true);
      expect(p1.registros.every((x) => x.base === null)).toBe(true);
      const p2 = await a.mudancasDesde(p1.cursor, 2);
      expect(p2.registros.map((x) => x.id)).toEqual(ids.slice(2, 4));
      const p3 = await a.mudancasDesde(p2.cursor, 2);
      expect(p3.registros.map((x) => x.id)).toEqual(ids.slice(4));
      expect(p3.mais).toBe(false);
      expect((await a.mudancasDesde(p3.cursor)).registros).toEqual([]);

      // o servidor aceitou os dois primeiros
      await a.marcarEnviadas(p1.registros);
      expect(await a.pendentes()).toEqual({ fila: 3, recusados: 0 });
      // edita um já enviado: volta à fila, com a base = a versão que o servidor tem
      r.passar(10);
      const editado = await a.gravar({ colecao: 'ideias', id: ids[0]!, dados: { titulo: 'de novo' } });
      const fila = await a.mudancasDesde();
      const naFila = fila.registros.find((x) => x.id === ids[0]);
      expect(naFila).toMatchObject({ versao: editado.versao, base: p1.registros[0]!.versao });
      expect(fila.registros.at(-1)!.id).toBe(ids[0]);
      // "aceito" de uma versão ANTIGA (mudou enquanto o pedido viajava) não tira da fila
      await a.marcarEnviadas([p1.registros[0]!]);
      expect((await a.mudancasDesde()).registros.some((x) => x.id === ids[0])).toBe(true);
      await a.marcarEnviadas((await a.mudancasDesde()).registros);
      expect(await a.pendentes()).toEqual({ fila: 0, recusados: 0 });
      a.fechar();
    });

    it('recusados saem da fila mas ficam guardados; editar devolve à fila', async () => {
      const { a, r } = await novo();
      const id = uuidv7(T0);
      const g = await a.gravar({ colecao: 'ideias', id, dados: { titulo: 'x' } });
      await a.marcarRecusadas([{ id, versao: g.versao, erro: 'grande_demais' }]);
      expect(await a.pendentes()).toEqual({ fila: 0, recusados: 1 });
      expect((await a.mudancasDesde()).registros).toEqual([]);
      expect((await a.ler('ideias', id))!.dados['titulo']).toBe('x');
      r.passar(5);
      await a.gravar({ colecao: 'ideias', id, dados: { titulo: 'menor' } });
      expect(await a.pendentes()).toEqual({ fila: 1, recusados: 0 });
      a.fechar();
    });

    it('aplicarDoServidor: registro novo, troca do que não está pendente, e o relógio absorve', async () => {
      const { a } = await novo();
      const id = uuidv7(T0);
      const futuro = '1794489999000-0002-bbbbbbbb';
      const r1 = await a.aplicarDoServidor([servidor(id, 'ideias', { titulo: 'do servidor' }, futuro)]);
      expect(r1).toEqual({ mudaram: [id], copias: [] });
      expect(await a.pendentes()).toEqual({ fila: 0, recusados: 0 });
      expect((await a.ler('ideias', id))!.versao).toBe(futuro);
      // de novo o mesmo: nada muda
      expect((await a.aplicarDoServidor([servidor(id, 'ideias', { titulo: 'do servidor' }, futuro)])).mudaram).toEqual([]);
      // o relógio daqui passou a andar na frente do servidor
      const g = await a.gravar({ colecao: 'ideias', id, dados: { texto: 'meu' } });
      expect(g.versao > futuro).toBe(true);
      expect((await a.mudancasDesde()).registros[0]).toMatchObject({ id, base: futuro });
      // malformados e de outra coleção são ignorados
      const lixo = [{ id: 'x', colecao: 'ideias', versao: futuro, apagado: false, dados: {} }, { id: uuidv7(), colecao: 'outra', versao: futuro, apagado: false, dados: {} }, servidor(id, 'cenas', { titulo: 'troquei de coleção' }, '1794499999000-0000-bbbbbbbb')] as unknown as Registro[];
      expect((await a.aplicarDoServidor(lixo)).mudaram).toEqual([]);
      expect((await a.ler('ideias', id))!.dados['texto']).toBe('meu');
      a.fechar();
    });

    it('aplicarDoServidor com mudança pendente: mescla campo a campo e continua na fila', async () => {
      const { a, r } = await novo();
      const id = uuidv7(T0);
      const v1 = '1794480000100-0000-bbbbbbbb';
      await a.aplicarDoServidor([servidor(id, 'ideias', { titulo: 'T', texto: 'X', fixada: false }, v1)]);
      r.passar(5000);
      await a.gravar({ colecao: 'ideias', id, dados: { titulo: 'T local' } });
      // o servidor mudou OUTRO campo (em outro aparelho), depois
      const v2 = '1794480009000-0000-cccccccc';
      const doServidor = servidor(id, 'ideias', { titulo: 'T', texto: 'X', fixada: true }, v1);
      (doServidor.dados['_v'] as Record<string, string>)['fixada'] = v2;
      doServidor.versao = v2;
      const feito = await a.aplicarDoServidor([doServidor]);
      expect(feito).toEqual({ mudaram: [id], copias: [] });
      const junto = (await a.ler('ideias', id))!;
      expect(junto.dados).toMatchObject({ titulo: 'T local', fixada: true, texto: 'X' });
      expect(junto.versao > v2).toBe(true);
      const fila = await a.mudancasDesde();
      expect(fila.registros).toHaveLength(1);
      expect(fila.registros[0]).toMatchObject({ id, base: v2, versao: junto.versao });
      a.fechar();
    });

    it('aplicarDoServidor com TEXTO de cena mudado dos dois lados: cria a cópia de conflito uma vez só', async () => {
      const { a, r } = await novo();
      const [h, id] = [uuidv7(T0), uuidv7(T0 + 1)];
      const v1 = '1794480000100-0000-bbbbbbbb';
      const baseCena = { historia: h, capitulo: null, titulo: 'Cena', ordem: 'a1', texto: 'Base.', palavras: 1 };
      await a.aplicarDoServidor([servidor(id, 'cenas', baseCena, v1)]);
      r.passar(5000);
      const local = await a.gravar({ colecao: 'cenas', id, dados: { texto: 'Texto do aparelho A.', palavras: 4 } });
      const v2 = '1794480009000-0000-bbbbbbbb';
      const novoNoServidor = servidor(id, 'cenas', baseCena, v1);
      Object.assign(novoNoServidor.dados, { texto: 'Texto do aparelho B.', palavras: 4 });
      Object.assign(novoNoServidor.dados['_v'] as object, { texto: v2, palavras: v2 });
      novoNoServidor.versao = v2;

      const feito = await a.aplicarDoServidor([novoNoServidor]);
      expect(feito.copias).toHaveLength(1);
      const copia = feito.copias[0]!;
      expect(copia.dados).toMatchObject({ texto: 'Texto do aparelho A.', conflito_de: id, conflito_aparelho: 'aaaaaaaa', historia: h, capitulo: null, ordem: 'a1V' });
      expect(copia.versao).toBe(local.versao);
      expect((await a.ler('cenas', id))!.dados['texto']).toBe('Texto do aparelho B.');
      expect((await a.listar('cenas', { historia: h })).map((c) => c.dados['texto']).sort()).toEqual(['Texto do aparelho A.', 'Texto do aparelho B.']);
      // a cópia vai para a fila (o servidor ainda não a tem); a cena não (ficou igual à do servidor)
      expect((await a.mudancasDesde()).registros.map((x) => x.id)).toEqual([copia.id]);
      // o mesmo registro chegando de novo não cria outra cópia
      expect((await a.aplicarDoServidor([novoNoServidor])).copias).toEqual([]);
      expect(await a.listar('cenas', { historia: h })).toHaveLength(2);
      a.fechar();
    });

    it('cursor do servidor, configuração, histórico e dias (só locais)', async () => {
      const { a } = await novo();
      expect(await a.cursorDoServidor()).toBe(0);
      await a.guardarCursorDoServidor(42);
      expect(await a.cursorDoServidor()).toBe(42);
      expect(await a.lerConfig('meta_dia')).toBeUndefined();
      await a.gravarConfig('meta_dia', 500);
      expect(await a.lerConfig('meta_dia')).toBe(500);

      const cena = uuidv7(T0);
      const v = (n: number): { id: string; cena: string; texto: string; palavras: number; criado_em: number } => ({ id: uuidv7(T0 + n), cena, texto: `versão ${n}`, palavras: 2, criado_em: T0 + n });
      await a.gravarVarios([{ colecao: 'cenas', id: cena, dados: { titulo: 'c' } }], { versoes: [v(1), v(2)], somarDia: { data: '2026-11-12', palavras: 10 } });
      await a.gravarVarios([], { versoes: [v(3)], apagarVersoes: [(await a.versoesDaCena(cena)).at(-1)!.id], somarDia: { data: '2026-11-12', palavras: -3 } });
      expect((await a.versoesDaCena(cena)).map((x) => x.texto)).toEqual(['versão 3', 'versão 2']);
      expect(await a.versoesDaCena(uuidv7())).toEqual([]);
      const primeira = (await a.versoesDaCena(cena))[0]!;
      expect(await a.lerVersao(primeira.id)).toEqual(primeira);
      expect(await a.lerVersao('nada')).toBeNull();
      expect(await a.lerDia('2026-11-12')).toEqual({ data: '2026-11-12', palavras: 7 });
      expect(await a.lerDia('2026-11-13')).toBeNull();
      expect(await a.dias()).toEqual([{ data: '2026-11-12', palavras: 7 }]);
      // nada disso entra na fila de saída
      expect((await a.mudancasDesde()).registros.map((x) => x.id)).toEqual([cena]);
      a.fechar();
    });

    it('avisa quem ouve: mudança local e mudança vinda do servidor', async () => {
      const { a } = await novo();
      const vistos: Mudanca[] = [];
      const parar = a.aoMudar((m) => vistos.push(m));
      a.aoMudar(() => {
        throw new Error('ouvinte com defeito não derruba a gravação');
      });
      const id = uuidv7(T0);
      await a.gravar({ colecao: 'ideias', id, dados: { titulo: 'x' } });
      const outro = uuidv7(T0 + 1);
      await a.aplicarDoServidor([servidor(outro, 'ideias', { titulo: 'y' }, '1794480000100-0000-bbbbbbbb')]);
      expect(vistos).toEqual([
        { origem: 'local', ids: [id] },
        { origem: 'servidor', ids: [outro] },
      ]);
      parar();
      await a.gravar({ colecao: 'ideias', id, dados: { titulo: 'z' } });
      expect(vistos).toHaveLength(2);
      a.fechar();
    });

    it('gravações ao mesmo tempo não se atropelam', async () => {
      const { a } = await novo();
      const ids = Array.from({ length: 20 }, (_, i) => uuidv7(T0 + i));
      const gravados = await Promise.all(ids.map((id, i) => a.gravar({ colecao: 'ideias', id, dados: { titulo: String(i) } })));
      expect(new Set(gravados.map((g) => g.versao)).size).toBe(20);
      expect(await a.listar('ideias')).toHaveLength(20);
      expect((await a.mudancasDesde()).registros).toHaveLength(20);
      a.fechar();
    });

    it('contas diferentes não se misturam, e quem escreveu sem conta leva os textos (adotar)', async () => {
      const r = relogio();
      const local = await ad.abrir({ dono: ad.persiste ? `${DONO_LOCAL}-${donoNovo()}` : DONO_LOCAL, aparelho: 'aaaaaaaa', agora: r.agora });
      const ana = await ad.abrir({ dono: donoNovo(), aparelho: 'aaaaaaaa', agora: r.agora });
      const bia = await ad.abrir({ dono: donoNovo(), aparelho: 'aaaaaaaa', agora: r.agora });
      const [h, c] = [uuidv7(T0), uuidv7(T0 + 1)];
      await local.gravarVarios(
        [
          { colecao: 'historias', id: h, dados: { titulo: 'Escrita sem conta' } },
          { colecao: 'cenas', id: c, dados: { historia: h, capitulo: null, ordem: 'a0', texto: 'Meu texto.', palavras: 2 } },
        ],
        { versoes: [{ id: uuidv7(T0 + 2), cena: c, texto: 'Meu', palavras: 1, criado_em: T0 }], somarDia: { data: '2026-11-12', palavras: 2 } },
      );
      await local.gravarConfig('meta_dia', 300);
      await bia.gravar({ colecao: 'historias', id: uuidv7(T0 + 9), dados: { titulo: 'Da Bia' } });
      expect(await ana.listar('historias')).toEqual([]);
      expect(await bia.listar('historias')).toHaveLength(1);

      r.passar(1000);
      const feito = await adotar(local, ana);
      expect(feito.mudaram.sort()).toEqual([h, c].sort());
      expect((await ana.listar('historias')).map((x) => x.dados['titulo'])).toEqual(['Escrita sem conta']);
      expect((await ana.ler('cenas', c))!.dados['texto']).toBe('Meu texto.');
      // tudo entra como pendente da conta (vai subir), sem base
      const fila = await ana.mudancasDesde();
      expect(fila.registros.map((x) => x.id).sort()).toEqual([h, c].sort());
      expect(fila.registros.every((x) => x.base === null)).toBe(true);
      expect(await ana.versoesDaCena(c)).toHaveLength(1);
      expect(await ana.lerDia('2026-11-12')).toEqual({ data: '2026-11-12', palavras: 2 });
      expect(await ana.lerConfig('meta_dia')).toBe(300);
      // a origem fica vazia; a outra conta não viu nada
      expect(await local.listar('historias')).toEqual([]);
      expect(await local.pendentes()).toEqual({ fila: 0, recusados: 0 });
      expect((await bia.listar('historias')).map((x) => x.dados['titulo'])).toEqual(['Da Bia']);
      // adotar de novo (origem vazia) não muda nada
      expect((await adotar(local, ana)).mudaram).toEqual([]);
      expect(await ana.listar('cenas')).toHaveLength(1);
      for (const x of [local, ana, bia]) x.fechar();
    });

    it.skipIf(!ad.persiste)('fecha, abre de novo e está tudo lá (com o mesmo aparelho e o relógio na frente)', async () => {
      const dono = donoNovo();
      const r = relogio();
      const a1 = await ad.abrir({ dono, agora: r.agora });
      const aparelho = await a1.aparelho();
      expect(aparelho).toMatch(/^[0-9a-f]{8}$/);
      const id = uuidv7(T0);
      const g1 = await a1.gravar({ colecao: 'historias', id, dados: { titulo: 'Guardada' } });
      await a1.guardarCursorDoServidor(7);
      a1.fechar();
      // o relógio do aparelho voltou no tempo entre as sessões
      const a2 = await ad.abrir({ dono, agora: () => T0 - 86_400_000 });
      expect(await a2.aparelho()).toBe(aparelho);
      expect(await a2.ler('historias', id)).toEqual(g1);
      expect(await a2.cursorDoServidor()).toBe(7);
      expect((await a2.mudancasDesde()).registros.map((x) => x.id)).toEqual([id]);
      const g2 = await a2.gravar({ colecao: 'historias', id, dados: { titulo: 'Editada depois' } });
      expect(g2.versao > g1.versao).toBe(true);
      a2.fechar();
    });
  });
}

describe('ArmazemIndexedDB', () => {
  it('um banco por dono, e pede armazenamento persistente quando o navegador tem', async () => {
    expect(nomeDoBanco('42')).toBe('ekfrase-writer:42');
    const sem = await ArmazemIndexedDB.abrir({ dono: donoNovo() });
    expect(sem.persistente).toBeNull();
    sem.fechar();
    let pedidos = 0;
    Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { storage: { persisted: async () => false, persist: async () => (pedidos++, true) } } });
    try {
      const dono = donoNovo();
      const com = await ArmazemIndexedDB.abrir({ dono });
      expect(com.persistente).toBe(true);
      expect(pedidos).toBe(1);
      await com.gravar({ colecao: 'ideias', id: uuidv7(), dados: { titulo: 'x' } });
      com.fechar();
      await ArmazemIndexedDB.apagarBanco(dono);
      const vazio = await ArmazemIndexedDB.abrir({ dono });
      expect(await vazio.listar('ideias')).toEqual([]);
      vazio.fechar();
    } finally {
      Reflect.deleteProperty(globalThis, 'navigator');
    }
  });
});

// ---------- as operações de domínio ----------

describe('Escrita: as operações que o app chama', () => {
  const nova = (): { e: Escrita; a: ArmazemMemoria; r: ReturnType<typeof relogio> } => {
    const r = relogio();
    const a = new ArmazemMemoria({ dono: 'ana', aparelho: 'aaaaaaaa', agora: r.agora });
    // cada chamada anda 1 ms: os ids (UUID v7) saem em ordem de criação
    const e = new Escrita(a, { agora: () => (r.passar(1), r.agora()), dia: () => '2026-11-12' });
    return { e, a, r };
  };
  const titulos = (lista: readonly { titulo: string }[]): string[] => lista.map((x) => x.titulo);
  const forma = async (e: Escrita, historia: string): Promise<string> => {
    const arv = await e.arvore(historia);
    return [`[${titulos(arv.soltas).join(',')}]`, ...arv.capitulos.map((c) => `${c.capitulo.titulo}[${titulos(c.cenas).join(',')}]`)].join(' ');
  };

  it('criar, editar e ler: história, capítulo, cena, personagem', async () => {
    const { e } = nova();
    const h = await e.criarHistoria({ titulo: 'A torre', genero: 'fantasia' });
    expect(h).toMatchObject({ titulo: 'A torre', genero: 'fantasia', sinopse: '', meta_palavras: 0, apagado: false, dono: 'ana' });
    expect(ehUuidV7(h.id) && ehHlc(h.versao)).toBe(true);
    const cap = await e.criarCapitulo(h.id, { titulo: 'Um' });
    const cena = await e.criarCena(h.id, { titulo: 'Abertura', capitulo: cap.id, texto: 'Era uma vez.' });
    expect(cena).toMatchObject({ historia: h.id, capitulo: cap.id, status: 'rascunho', palavras: 3 });
    expect(ehOrdem(cena.ordem) && ehOrdem(cap.ordem)).toBe(true);
    expect((await e.editarHistoria(h.id, { logline: 'Uma torre.' })).logline).toBe('Uma torre.');
    expect((await e.editarCapitulo(cap.id, { resumo: 'r' })).resumo).toBe('r');
    expect((await e.editarCena(cena.id, { status: 'revisada', objetivo: 'o' })).status).toBe('revisada');
    const p = await e.criarPersonagem(h.id, { nome: 'Zeca', papel: 'vilão' });
    await e.criarPersonagem(h.id, { nome: 'Ana' });
    expect((await e.editarPersonagem(p.id, { medo: 'altura' })).medo).toBe('altura');
    expect((await e.personagens(h.id)).map((x) => x.nome)).toEqual(['Ana', 'Zeca']);
    const outra = await e.criarHistoria({ titulo: 'Segunda' });
    expect(titulos(await e.historias())).toEqual(['Segunda', 'A torre']);
    expect((await e.historia(outra.id)).titulo).toBe('Segunda');

    // erros são códigos
    await expect(e.historia(uuidv7())).rejects.toMatchObject({ codigo: 'nao-existe' });
    await expect(e.criarCena(uuidv7())).rejects.toBeInstanceOf(ErroEscrita);
    const capDaOutra = await e.criarCapitulo(outra.id, { titulo: 'x' });
    await expect(e.criarCena(h.id, { capitulo: capDaOutra.id })).rejects.toMatchObject({ codigo: 'invalido' });
    await expect(e.moverCenaPara(cena.id, { capitulo: capDaOutra.id })).rejects.toMatchObject({ codigo: 'invalido' });
  });

  it('a árvore, e mover cenas pelo teclado: cima, baixo, dentro, fora (muda UM registro)', async () => {
    const { e, a } = nova();
    const h = await e.criarHistoria({ titulo: 'H' });
    const c1 = await e.criarCapitulo(h.id, { titulo: 'C1' });
    const c2 = await e.criarCapitulo(h.id, { titulo: 'C2' });
    const s = await e.criarCena(h.id, { titulo: 's' });
    const x = await e.criarCena(h.id, { titulo: 'x', capitulo: c1.id });
    const y = await e.criarCena(h.id, { titulo: 'y', capitulo: c1.id });
    const z = await e.criarCena(h.id, { titulo: 'z', capitulo: c1.id });
    const w = await e.criarCena(h.id, { titulo: 'w', capitulo: c2.id });
    expect(await forma(e, h.id)).toBe('[s] C1[x,y,z] C2[w]');
    // nova cena logo depois de outra (Ctrl+Enter)
    const x2 = await e.criarCena(h.id, { titulo: 'x2' }, { depoisDe: x.id });
    expect(x2.capitulo).toBe(c1.id);
    expect(await forma(e, h.id)).toBe('[s] C1[x,x2,y,z] C2[w]');

    const versoesAntes = new Map((await a.listar('cenas')).map((r) => [r.id, r.versao]));
    await e.moverCena(z.id, 'cima');
    expect(await forma(e, h.id)).toBe('[s] C1[x,x2,z,y] C2[w]');
    const mudaram = (await a.listar('cenas')).filter((r) => versoesAntes.get(r.id) !== r.versao).map((r) => r.id);
    expect(mudaram).toEqual([z.id]);

    await e.moverCena(z.id, 'baixo');
    await e.moverCena(z.id, 'baixo'); // na ponta: vai para o começo do capítulo seguinte
    expect(await forma(e, h.id)).toBe('[s] C1[x,x2,y] C2[z,w]');
    await e.moverCena(z.id, 'cima'); // e volta para o fim do anterior
    expect(await forma(e, h.id)).toBe('[s] C1[x,x2,y,z] C2[w]');
    await e.moverCena(x.id, 'cima'); // do começo do 1º capítulo para as soltas
    expect(await forma(e, h.id)).toBe('[s,x] C1[x2,y,z] C2[w]');
    await e.moverCena(s.id, 'cima'); // já é a primeira de tudo
    expect(await forma(e, h.id)).toBe('[s,x] C1[x2,y,z] C2[w]');
    await e.moverCena(w.id, 'baixo'); // já é a última de tudo
    expect(await forma(e, h.id)).toBe('[s,x] C1[x2,y,z] C2[w]');
    await e.moverCena(w.id, 'fora');
    expect(await forma(e, h.id)).toBe('[s,x,w] C1[x2,y,z] C2[]');
    await e.moverCena(s.id, 'dentro');
    expect(await forma(e, h.id)).toBe('[x,w] C1[s,x2,y,z] C2[]');
    await e.moverCena(s.id, 'dentro'); // já está num capítulo
    expect(await forma(e, h.id)).toBe('[x,w] C1[s,x2,y,z] C2[]');
    // arrastar: para um lugar exato
    await e.moverCenaPara(w.id, { capitulo: c2.id });
    await e.moverCenaPara(y.id, { capitulo: c2.id, antesDe: w.id });
    await e.moverCenaPara(x.id, { capitulo: c1.id, depoisDe: s.id });
    expect(await forma(e, h.id)).toBe('[] C1[s,x,x2,z] C2[y,w]');
    for (const c of await e.cenas(h.id)) expect(ehOrdem(c.ordem), c.ordem).toBe(true);

    // capítulos
    const c3 = await e.criarCapitulo(h.id, { titulo: 'C3' }, { depoisDe: c1.id });
    expect(titulos(await e.capitulos(h.id))).toEqual(['C1', 'C3', 'C2']);
    await e.moverCapitulo(c3.id, 'baixo');
    await e.moverCapitulo(c3.id, 'baixo');
    expect(titulos(await e.capitulos(h.id))).toEqual(['C1', 'C2', 'C3']);
    await e.moverCapitulo(c3.id, 'cima');
    await e.moverCapitulo(c3.id, 'cima');
    await e.moverCapitulo(c3.id, 'cima');
    expect(titulos(await e.capitulos(h.id))).toEqual(['C3', 'C1', 'C2']);
    await e.moverCapituloPara(c3.id, { depoisDe: c1.id });
    expect(titulos(await e.capitulos(h.id))).toEqual(['C1', 'C3', 'C2']);
  });

  it('mover muitas vezes no mesmo lugar não estraga a ordem', async () => {
    const { e } = nova();
    const h = await e.criarHistoria({ titulo: 'H' });
    const cenas = [];
    for (let i = 0; i < 6; i++) cenas.push(await e.criarCena(h.id, { titulo: String(i) }));
    for (let i = 0; i < 60; i++) await e.moverCenaPara(cenas[5 - (i % 2)]!.id, { capitulo: null, antesDe: cenas[1]!.id });
    const arv = await e.arvore(h.id);
    expect(titulos(arv.soltas).slice(0, 1)).toEqual(['0']);
    expect(new Set(arv.soltas.map((c) => c.ordem)).size).toBe(6);
    for (const c of arv.soltas) expect(ehOrdem(c.ordem)).toBe(true);
  });

  it('apagar é lápide, em cascata; restaurar traz de volta o que saiu junto', async () => {
    const { e, a, r } = nova();
    const h = await e.criarHistoria({ titulo: 'H' });
    const cap = await e.criarCapitulo(h.id, { titulo: 'C' });
    const c1 = await e.criarCena(h.id, { titulo: '1', capitulo: cap.id });
    const c2 = await e.criarCena(h.id, { titulo: '2', capitulo: cap.id });
    const solta = await e.criarCena(h.id, { titulo: 'solta' });
    const p = await e.criarPersonagem(h.id, { nome: 'P' });
    const ideia = await e.criarIdeia({ titulo: 'ideia da história', historia: h.id });

    await e.apagarCena(c1.id); // apagada ANTES, sozinha
    r.passar(1000);
    await e.apagarCapitulo(cap.id);
    expect(await forma(e, h.id)).toBe('[solta]');
    expect((await a.ler('cenas', c2.id))!.apagado).toBe(true);
    expect((await a.ler('cenas', c2.id))!.dados['titulo']).toBe('2'); // nada some sem rastro
    await expect(e.cena(c2.id)).rejects.toMatchObject({ codigo: 'nao-existe' });
    await e.restaurar('capitulos', cap.id);
    expect(await forma(e, h.id)).toBe('[solta] C[2]'); // a cena 1 continua apagada: saiu antes

    r.passar(1000);
    await e.apagarHistoria(h.id);
    expect(await e.historias()).toEqual([]);
    for (const [colecao, id] of [['capitulos', cap.id], ['cenas', c2.id], ['cenas', solta.id], ['personagens', p.id]] as const) expect((await a.ler(colecao, id))!.apagado, colecao).toBe(true);
    expect((await a.ler('ideias', ideia.id))!.apagado).toBe(false); // as ideias ficam
    // tudo na mesma transação, com a mesma versão
    const lapides = (await a.listar('cenas', { historia: h.id, apagados: true })).filter((x) => x.id !== c1.id).map((x) => versoesDe(x.dados)['apagado']);
    expect(new Set([...lapides, versoesDe((await a.ler('historias', h.id))!.dados)['apagado']]).size).toBe(1);

    await e.restaurar('historias', h.id);
    expect(await forma(e, h.id)).toBe('[solta] C[2]');
    expect(await e.personagens(h.id)).toHaveLength(1);
    await e.restaurar('cenas', c1.id);
    expect(await forma(e, h.id)).toBe('[solta] C[1,2]');
    await e.apagarPersonagem(p.id);
    await e.apagarIdeia(ideia.id);
    expect(await e.personagens(h.id)).toEqual([]);
    expect(await e.ideias()).toEqual([]);
  });

  it('cena cujo capítulo sumiu aparece entre as soltas (nunca fica invisível)', async () => {
    const { e, a } = nova();
    const h = await e.criarHistoria({ titulo: 'H' });
    const cap = await e.criarCapitulo(h.id, { titulo: 'C' });
    const cena = await e.criarCena(h.id, { titulo: 'órfã', capitulo: cap.id });
    await a.gravar({ colecao: 'capitulos', id: cap.id, apagado: true }); // só o capítulo, como viria de outro aparelho
    expect(await forma(e, h.id)).toBe('[órfã]');
    expect((await e.moverCena(cena.id, 'fora')).capitulo).toBeNull();
  });

  it('gravarTexto: palavras, palavras do dia e meta', async () => {
    const { e } = nova();
    const h = await e.criarHistoria({ titulo: 'H', meta_palavras: 1000 });
    const cena = await e.criarCena(h.id, { titulo: 'c' });
    expect((await e.gravarTexto(cena.id, 'Era uma vez um gato.')).palavras).toBe(5);
    expect((await e.gravarTexto(cena.id, 'Era uma vez um gato preto e gordo.')).palavras).toBe(8);
    expect((await e.gravarTexto(cena.id, 'Era uma vez.')).palavras).toBe(3);
    const mesma = await e.gravarTexto(cena.id, 'Era uma vez.');
    expect(mesma.versao).toBe((await e.cena(cena.id)).versao);
    expect(await e.escritaDoDia()).toEqual({ data: '2026-11-12', palavras: 3, meta: 0, cumprida: false });
    await e.definirMetaDoDia(3);
    expect(await e.metaDoDia()).toBe(3);
    expect(await e.escritaDoDia()).toEqual({ data: '2026-11-12', palavras: 3, meta: 3, cumprida: true });
    expect(await e.escritaDoDia('2026-01-01')).toEqual({ data: '2026-01-01', palavras: 0, meta: 3, cumprida: false });
    expect(await e.diasDeEscrita()).toHaveLength(1);
    // cortar mais do que escreveu: o dia não fica negativo para quem vê
    await e.gravarTexto(cena.id, '');
    expect((await e.escritaDoDia()).palavras).toBe(0);

    const cap = await e.criarCapitulo(h.id, { titulo: 'C' });
    const outra = await e.criarCena(h.id, { titulo: 'd', capitulo: cap.id, status: 'final', texto: 'Dois gatos.' });
    await e.gravarTexto(cena.id, 'Um.');
    expect(await e.totais(h.id)).toEqual({ palavras: 3, cenas: 2, capitulos: 1, meta: 1000, porStatus: { ideia: 0, planejada: 0, rascunho: 1, escrita: 0, revisada: 0, final: 1 } });
    const h2 = await e.criarHistoria({ titulo: 'H2' });
    await e.criarCena(h2.id, { texto: 'a b c d' });
    expect(await e.palavrasPorHistoria()).toEqual({ total: 7, porHistoria: { [h.id]: 3, [h2.id]: 4 } });
    await e.apagarCena(outra.id);
    expect((await e.totais(h.id)).palavras).toBe(1);
  });

  it('histórico da cena: a cada 5 minutos com mudança, ao sair, restaurar, e o limite', async () => {
    const { e, r } = nova();
    const h = await e.criarHistoria({ titulo: 'H' });
    const cena = await e.criarCena(h.id, { titulo: 'c' });
    await e.gravarTexto(cena.id, 'Um.');
    expect(await e.historicoDaCena(cena.id)).toEqual([]);
    await e.gravarTexto(cena.id, 'Um. Dois.'); // primeira mudança sobre um texto que existia: guarda como estava
    expect((await e.historicoDaCena(cena.id)).map((v) => v.texto)).toEqual(['Um.']);
    r.passar(60_000);
    await e.gravarTexto(cena.id, 'Um. Dois. Três.'); // 1 minuto depois: ainda não
    expect(await e.historicoDaCena(cena.id)).toHaveLength(1);
    r.passar(INTERVALO_DE_VERSAO);
    await e.gravarTexto(cena.id, 'Um. Dois. Três. Quatro.'); // passaram 5 minutos
    const historico = await e.historicoDaCena(cena.id);
    expect(historico.map((v) => v.texto)).toEqual(['Um. Dois. Três. Quatro.', 'Um.']);
    expect(historico[0]).toMatchObject({ cena: cena.id, palavras: 4 });
    expect(historico[0]!.criado_em).toBeGreaterThan(historico[1]!.criado_em);

    await e.gravarTexto(cena.id, 'Um. Dois. Três. Quatro. Cinco.');
    await e.sairDaCena(cena.id); // ao sair: guarda o texto de agora
    await e.sairDaCena(cena.id); // sem mudança: não guarda de novo
    expect((await e.historicoDaCena(cena.id)).map((v) => v.palavras)).toEqual([5, 4, 1]);

    // restaurar: volta o texto, e o de agora continua no histórico (dá para desfazer)
    const antiga = (await e.historicoDaCena(cena.id)).at(-1)!;
    await e.gravarTexto(cena.id, 'Texto novo que não foi guardado.');
    const voltou = await e.restaurarVersao(antiga.id);
    expect(voltou).toMatchObject({ texto: 'Um.', palavras: 1 });
    expect((await e.historicoDaCena(cena.id))[0]!.texto).toBe('Texto novo que não foi guardado.');
    await expect(e.restaurarVersao('nada')).rejects.toMatchObject({ codigo: 'nao-existe' });

    // o limite por cena
    for (let i = 0; i < MAX_VERSOES_POR_CENA + 15; i++) {
      r.passar(INTERVALO_DE_VERSAO + 1);
      await e.gravarTexto(cena.id, `Texto número ${i}.`);
    }
    const cheio = await e.historicoDaCena(cena.id);
    expect(cheio).toHaveLength(MAX_VERSOES_POR_CENA);
    expect(cheio[0]!.texto).toBe(`Texto número ${MAX_VERSOES_POR_CENA + 14}.`);
    expect(cheio.some((v) => v.texto === 'Um.')).toBe(false);
    // o histórico é só deste aparelho: não entra na fila de saída
    const outraCena = await e.criarCena(h.id, { titulo: 'outra' });
    expect(await e.historicoDaCena(outraCena.id)).toEqual([]);
  });

  it('ideias: criar, fixar, filtrar e transformar em história, cena ou personagem', async () => {
    const { e } = nova();
    const h = await e.criarHistoria({ titulo: 'H' });
    const cap = await e.criarCapitulo(h.id, { titulo: 'C' });
    const i1 = await e.criarIdeia({ titulo: 'Um farol que apaga', texto: 'E se…', tipo: 'premissa', etiquetas: ['mar'] });
    const i2 = await e.criarIdeia({ titulo: 'A briga', texto: 'Na cozinha.', tipo: 'cena', historia: h.id });
    const i3 = await e.criarIdeia({ titulo: 'Dona Lia', texto: 'Faroleira.', tipo: 'personagem' });
    expect(titulos(await e.ideias())).toEqual(['Dona Lia', 'A briga', 'Um farol que apaga']);
    await e.editarIdeia(i1.id, { fixada: true });
    expect(titulos(await e.ideias())).toEqual(['Um farol que apaga', 'Dona Lia', 'A briga']);
    expect(titulos(await e.ideias({ historia: null }))).toEqual(['Um farol que apaga', 'Dona Lia']);
    expect(titulos(await e.ideias({ historia: h.id }))).toEqual(['A briga']);

    const emHistoria = await e.transformarIdeia(i1.id, 'historia');
    expect(emHistoria.ideia).toMatchObject({ virou_tipo: 'historia', virou_id: emHistoria.id });
    expect(await e.historia(emHistoria.id)).toMatchObject({ titulo: 'Um farol que apaga', sinopse: 'E se…' });

    const emCena = await e.transformarIdeia(i2.id, 'cena', { capitulo: cap.id });
    expect(await e.cena(emCena.id)).toMatchObject({ titulo: 'A briga', resumo: 'Na cozinha.', status: 'ideia', historia: h.id, capitulo: cap.id });
    expect((await e.ideias({ historia: h.id }))[0]).toMatchObject({ virou_tipo: 'cena', virou_id: emCena.id });

    await expect(e.transformarIdeia(i3.id, 'personagem')).rejects.toMatchObject({ codigo: 'sem-historia' });
    const emPersonagem = await e.transformarIdeia(i3.id, 'personagem', { historia: h.id });
    expect(await e.personagens(h.id)).toMatchObject([{ id: emPersonagem.id, nome: 'Dona Lia', notas: 'Faroleira.' }]);
    // a ideia continua existindo
    expect(await e.ideias()).toHaveLength(3);
  });

  it('cópias de conflito: listar e dispensar', async () => {
    const { e, a } = nova();
    const h = await e.criarHistoria({ titulo: 'H' });
    const cena = await e.criarCena(h.id, { titulo: 'c', texto: 'x' });
    await a.gravar({ colecao: 'cenas', id: uuidv7(T0 + 500), dados: { historia: h.id, capitulo: null, titulo: 'c', texto: 'y', ordem: `${cena.ordem}V`, conflito_de: cena.id, conflito_aparelho: 'bbbbbbbb', conflito_em: T0 } });
    const copias = await e.copiasDeConflito();
    expect(copias).toMatchObject([{ conflito_de: cena.id, conflito_aparelho: 'bbbbbbbb', conflito_em: T0, texto: 'y' }]);
    expect(await e.copiasDeConflito(h.id)).toHaveLength(1);
    expect(titulos((await e.arvore(h.id)).soltas)).toEqual(['c', 'c']);
    await e.dispensarConflito(copias[0]!.id);
    expect(await e.copiasDeConflito()).toEqual([]);
    expect((await e.arvore(h.id)).soltas).toHaveLength(2);
  });
});

describe('revisão da fase 1: abas no mesmo banco, adotar com outra aba, relógio para trás, texto bem formado', () => {
  it('duas abas na mesma cena: a que tinha o texto velho não apaga o da outra (vira versão do histórico)', async () => {
    const dono = donoNovo();
    const r = relogio();
    // duas conexões no MESMO banco = duas abas
    const a1 = await ArmazemIndexedDB.abrir({ dono, aparelho: 'aaaaaaaa', agora: r.agora });
    const a2 = await ArmazemIndexedDB.abrir({ dono, aparelho: 'aaaaaaaa', agora: r.agora });
    const aba1 = new Escrita(a1, { agora: () => (r.passar(1), r.agora()), dia: () => '2026-11-12' });
    const aba2 = new Escrita(a2, { agora: () => (r.passar(1), r.agora()), dia: () => '2026-11-12' });
    const h = await aba1.criarHistoria({ titulo: 'H' });
    const c = await aba1.criarCena(h.id, { texto: 'Primeira frase gravada.' });
    const base = c.texto;

    // a aba 1 escreve; a aba 2 continua com o texto velho na tela e digita "!"
    const g1 = await aba1.gravarTextoSobre(c.id, `${base} TEXTO DA ABA 1.`, base);
    expect(g1.outro).toBe(false);
    const g2 = await aba2.gravarTextoSobre(c.id, `${base}!`, base);
    expect(g2.outro).toBe(true);
    expect(g2.cena.texto).toBe(`${base}!`);
    // o texto da aba 1 não se perdeu: está no histórico
    expect((await aba2.historicoDaCena(c.id)).map((v) => v.texto)).toContain(`${base} TEXTO DA ABA 1.`);

    // a conferência é na transação: com `seAinda` errado nada é gravado
    await expect(a1.gravar({ colecao: 'cenas', id: c.id, dados: { texto: 'x' }, seAinda: { texto: 'não é este' } })).rejects.toMatchObject({ codigo: 'mudou' });
    expect((await aba1.cena(c.id)).texto).toBe(`${base}!`);

    // o outro lado avisado (origem `fora`) não conta como mudança local
    const vistos: Mudanca[] = [];
    a1.aoMudar((m) => vistos.push(m));
    a1.avisarDeFora([c.id]);
    expect(vistos).toEqual([{ origem: 'fora', ids: [c.id] }]);
    a1.fechar();
    a2.fechar();
  });

  it('gravarTexto sem base, com outra gravação no meio: tenta de novo e guarda o texto do outro', async () => {
    const r = relogio();
    const a = new ArmazemMemoria({ dono: 'ana', aparelho: 'aaaaaaaa', agora: r.agora });
    const e = new Escrita(a, { agora: () => (r.passar(1), r.agora()), dia: () => '2026-11-12' });
    const h = await e.criarHistoria({});
    const c = await e.criarCena(h.id, { texto: 'Começo.' });
    // outra aba grava entre a leitura e a gravação (a primeira tentativa falha no `seAinda`)
    const ler = a.versoesDaCena.bind(a);
    let uma = true;
    a.versoesDaCena = async (id) => {
      if (uma) {
        uma = false;
        await a.gravar({ colecao: 'cenas', id: c.id, dados: { texto: 'Começo. Da outra aba.' } });
      }
      return ler(id);
    };
    const feito = await e.gravarTextoSobre(c.id, 'Começo. Desta aba.');
    expect(feito).toMatchObject({ outro: true, cena: { texto: 'Começo. Desta aba.' } });
    expect((await e.historicoDaCena(c.id)).map((v) => v.texto)).toContain('Começo. Da outra aba.');
  });

  it('adotar com outra aba escrevendo no meio: o que mudou depois do despejo fica na origem', async () => {
    const r = relogio();
    const local = new ArmazemMemoria({ dono: DONO_LOCAL, aparelho: 'aaaaaaaa', agora: r.agora });
    const ana = new ArmazemMemoria({ dono: 'ana', aparelho: 'bbbbbbbb', agora: r.agora });
    const [h, c, i] = [uuidv7(T0), uuidv7(T0 + 1), uuidv7(T0 + 2)];
    await local.gravarVarios([
      { colecao: 'historias', id: h, dados: { titulo: 'Sem conta' } },
      { colecao: 'cenas', id: c, dados: { historia: h, capitulo: null, ordem: 'a0', texto: 'Escrito sem conta.' } },
      { colecao: 'ideias', id: i, dados: { titulo: 'Ideia' } },
    ]);
    const d = await local.despejar();
    r.passar(10);
    // a aba antiga continua escrevendo na origem enquanto a nova leva os textos
    await local.gravar({ colecao: 'cenas', id: c, dados: { texto: 'Escrito sem conta. E continuei.' } });
    await ana.receber(d);
    await local.esquecer(d);
    expect((await local.listar('historias')).map((x) => x.id)).toEqual([]);
    expect((await local.ler('cenas', c))!.dados['texto']).toBe('Escrito sem conta. E continuei.');
    // levar de novo leva o resto, e o texto mais novo vence (mesmo aparelho de origem: sem cópia)
    await adotar(local, ana);
    expect((await ana.ler('cenas', c))!.dados['texto']).toBe('Escrito sem conta. E continuei.');
    expect((await ana.listar('cenas')).length).toBe(1);
    expect(await local.listar('cenas')).toEqual([]);
  });

  it('relógio que volta para trás: o histórico de 5 em 5 minutos continua', async () => {
    let agora = Date.UTC(2030, 0, 1);
    const a = new ArmazemMemoria({ dono: 'ana', aparelho: 'aaaaaaaa', agora: () => agora });
    const e = new Escrita(a, { agora: () => agora, dia: () => '2026-11-12' });
    const h = await e.criarHistoria({});
    const c = await e.criarCena(h.id, {});
    await e.gravarTexto(c.id, 'Um.');
    agora += INTERVALO_DE_VERSAO;
    await e.gravarTexto(c.id, 'Um. Dois.');
    const antes = (await e.historicoDaCena(c.id)).length;
    // o relógio estava adiantado e foi acertado
    agora = Date.UTC(2026, 10, 13, 12);
    for (let k = 0; k < 12; k++) {
      agora += INTERVALO_DE_VERSAO;
      await e.gravarTexto(c.id, `Um. Dois. Mais ${k}.`);
    }
    expect((await e.historicoDaCena(c.id)).length - antes).toBe(12);
    // e não vira uma versão por gravação: duas gravações seguidas, uma versão só
    agora += 1000;
    await e.gravarTexto(c.id, 'Um. Dois. Mais 12.');
    expect((await e.historicoDaCena(c.id)).length - antes).toBe(12);
  });

  it('meio emoji solto não entra no armazém nem sai na fila', async () => {
    const r = relogio();
    const a = new ArmazemMemoria({ dono: 'ana', aparelho: 'aaaaaaaa', agora: r.agora });
    const e = new Escrita(a, { agora: () => (r.passar(1), r.agora()) });
    const meio = String.fromCharCode(0xd83d);
    const ideia = await e.criarIdeia({ titulo: `Um farol ${meio}`, texto: `navio 🚢 e ${String.fromCharCode(0xdea2)} sozinho`, etiquetas: [`x${meio}`] });
    expect(ideia.titulo).toBe('Um farol \uFFFD');
    expect(ideia.texto).toBe('navio 🚢 e \uFFFD sozinho');
    expect(ideia.etiquetas).toEqual(['x\uFFFD']);
    const fila = await a.mudancasDesde();
    expect(JSON.stringify(fila.registros)).not.toMatch(/\\ud[89a-f][0-9a-f]{2}/i);
  });
});
