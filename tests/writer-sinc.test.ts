// SPDX-License-Identifier: MPL-2.0

/**
 * A SINCRONIZAÇÃO do Writer contra um servidor falso em memória que cumpre o contrato de rede
 * (docs/writer/protocolo/README.md §7; o servidor de verdade é testado em tests/ponte.test.ts com
 * os casos de docs/writer/protocolo/servidor/). Dois aparelhos, sem rede, conflitos, lápides,
 * reenvio depois de falha, páginas, lotes, contas separadas e o transporte HTTP.
 */
import { describe, expect, it } from 'vitest';
import {
  ArmazemMemoria,
  ESPERAS,
  Escrita,
  MAX_POR_PEDIDO,
  REGEX_HLC,
  REGEX_UUID_V7,
  Sincronizador,
  TransporteHttp,
  adotar,
  baseDoServidor,
  bemFormado,
  conferirServidor,
  ehColecao,
  uuidv7,
  type Agendador,
  type Envio,
  type EstadoSinc,
  type Mudancas,
  type RegistroEnvio,
  type RegistroServidor,
  type Resposta,
  type ResultadoEnvio,
  type Transporte,
} from '../packages/writer-nucleo/src/index.ts';

const T0 = 1794480000000;
const CINCO_MB = 5 * 1024 * 1024;

/** O servidor do CONTRATO, em memória: uma tabela por conta, `seq` crescente, as 4 regras do enviar. */
class ServidorFalso {
  private readonly contas = new Map<string, { linhas: Map<string, RegistroServidor>; seq: number }>();
  /** `rede` = não responde; outro texto = responde `{ok:false, erro}`. */
  falha: string | null = null;
  /** Grava, mas a resposta se perde no caminho (uma vez). */
  perderResposta = false;
  /** O servidor fecha a página antes do que o aparelho pediu. */
  pagina = MAX_POR_PEDIDO;
  /** Pedidos com mais registros que isto não cabem (erro `grande`). */
  cabem = MAX_POR_PEDIDO;
  /** Um registro que o servidor não consegue ler: o pedido INTEIRO que o levar falha com `vazio`. */
  ilegivel: (r: RegistroEnvio) => boolean = () => false;
  pedidos = { mudancas: 0, enviar: 0 };
  lotes: number[] = [];

  private conta(nome: string): { linhas: Map<string, RegistroServidor>; seq: number } {
    let c = this.contas.get(nome);
    if (!c) this.contas.set(nome, (c = { linhas: new Map(), seq: 0 }));
    return c;
  }

  linhas(conta: string): RegistroServidor[] {
    return [...this.conta(conta).linhas.values()].sort((a, b) => a.seq - b.seq);
  }

  /** `null` = sem login. */
  transporte(conta: string | null): Transporte {
    const copia = <T>(v: T): T => structuredClone(v);
    return {
      mudancas: async (desde, limite = MAX_POR_PEDIDO): Promise<Resposta<Mudancas>> => {
        this.pedidos.mudancas += 1;
        if (this.falha) return { ok: false, erro: this.falha };
        if (conta === null) return { ok: false, erro: 'login' };
        const depois = this.linhas(conta).filter((l) => l.seq > desde);
        const registros = depois.slice(0, Math.min(limite, this.pagina));
        return { ok: true, registros: copia(registros), cursor: registros.at(-1)?.seq ?? desde, mais: depois.length > registros.length };
      },
      enviar: async (registros): Promise<Resposta<Envio>> => {
        this.pedidos.enviar += 1;
        if (this.falha) return { ok: false, erro: this.falha };
        if (conta === null) return { ok: false, erro: 'login' };
        if (!registros.length) return { ok: false, erro: 'vazio' };
        if (registros.length > MAX_POR_PEDIDO) return { ok: false, erro: 'muitos' };
        if (registros.length > this.cabem) return { ok: false, erro: 'grande' };
        if (registros.some(this.ilegivel)) return { ok: false, erro: 'vazio' };
        this.lotes.push(registros.length);
        const c = this.conta(conta);
        const resultados = registros.map((r) => this.um(c, copia(r)));
        if (this.perderResposta) {
          this.perderResposta = false;
          return { ok: false, erro: 'rede' };
        }
        return { ok: true, resultados, cursor: c.seq };
      },
    };
  }

  private um(c: { linhas: Map<string, RegistroServidor>; seq: number }, r: RegistroEnvio): ResultadoEnvio {
    const formado = REGEX_UUID_V7.test(r.id) && ehColecao(r.colecao) && REGEX_HLC.test(r.versao) && typeof r.apagado === 'boolean' && !!r.dados && typeof r.dados === 'object' && !Array.isArray(r.dados) && (r.base === null || REGEX_HLC.test(r.base));
    if (!formado) return { id: r.id, estado: 'recusado', erro: 'invalido' };
    if (JSON.stringify(r.dados).length > CINCO_MB) return { id: r.id, estado: 'recusado', erro: 'grande_demais' };
    const linha = c.linhas.get(r.id);
    const gravar = (): ResultadoEnvio => {
      const seq = ++c.seq;
      c.linhas.set(r.id, { id: r.id, colecao: r.colecao, versao: r.versao, apagado: r.apagado, dados: r.dados, seq });
      return { id: r.id, estado: 'aceito', seq };
    };
    if (!linha) return gravar();
    if (linha.colecao !== r.colecao) return { id: r.id, estado: 'recusado', erro: 'invalido' };
    if (linha.versao === r.versao) return { id: r.id, estado: 'aceito', seq: linha.seq };
    if (r.base === linha.versao && r.versao > linha.versao) return gravar();
    return { id: r.id, estado: 'conflito', servidor: structuredClone(linha) };
  }
}

/** Um agendador de mentira: guarda o que foi marcado e roda quando o teste manda. */
class AgendadorFalso implements Agendador {
  marcados: { ms: number; f: () => void }[] = [];
  depois(ms: number, f: () => void): () => void {
    const item = { ms, f };
    this.marcados.push(item);
    return () => void (this.marcados = this.marcados.filter((x) => x !== item));
  }
  /** Roda o próximo marcado e devolve de quanto era a espera. */
  rodar(): number {
    const item = this.marcados.shift();
    if (!item) throw new Error('nada marcado');
    item.f();
    return item.ms;
  }
}

interface Aparelho {
  armazem: ArmazemMemoria;
  escrita: Escrita;
  sinc: Sincronizador;
  agendador: AgendadorFalso;
  estados: EstadoSinc[];
  /** Avisa "a rede voltou" (o evento `online`). */
  redeVoltou: () => void;
}

/** O tempo é um só para todos os aparelhos do teste (e cada leitura anda 1 ms). */
function mundo(): { agora: () => number; passar: (ms: number) => void; aparelho: (id: string, transporte: Transporte | null, extra?: { lote?: number; dono?: string }) => Aparelho } {
  let t = T0;
  const agora = (): number => ++t;
  return {
    agora,
    passar: (ms) => void (t += ms),
    aparelho(id, transporte, extra = {}) {
      const armazem = new ArmazemMemoria({ dono: extra.dono ?? 'ana', aparelho: id, agora });
      const agendador = new AgendadorFalso();
      let voltou: () => void = () => undefined;
      const sinc = new Sincronizador({
        armazem,
        transporte,
        agora,
        agendador,
        aoVoltarARede: (f) => {
          voltou = f;
          return () => void (voltou = () => undefined);
        },
        ...(extra.lote ? { lote: extra.lote } : {}),
      });
      const estados: EstadoSinc[] = [];
      sinc.aoMudar((e) => estados.push(e));
      return { armazem, escrita: new Escrita(armazem, { agora, dia: () => '2026-11-12' }), sinc, agendador, estados, redeVoltou: () => voltou() };
    },
  };
}

const textos = async (e: Escrita, historia: string): Promise<string[]> => {
  const a = await e.arvore(historia);
  return [...a.soltas, ...a.capitulos.flatMap((c) => c.cenas)].map((c) => c.texto);
};

/** O retrato de um armazém, para comparar dois aparelhos. */
const retrato = async (a: ArmazemMemoria): Promise<unknown> => {
  const tudo = (await a.despejar()).registros.sort((x, y) => (x.id < y.id ? -1 : 1));
  return tudo.map((r) => ({ ...r, dados: Object.fromEntries(Object.entries(r.dados).sort(([x], [y]) => (x < y ? -1 : 1))) }));
};

describe('sincronização do Writer (servidor falso que cumpre o contrato)', () => {
  it('escreve sem rede em A, a rede volta, sincroniza, e aparece em B', async () => {
    const s = new ServidorFalso();
    const m = mundo();
    const A = m.aparelho('aaaaaaaa', s.transporte('ana'));
    const B = m.aparelho('bbbbbbbb', s.transporte('ana'));
    expect(A.sinc.estado.situacao).toBe('enviando');

    s.falha = 'rede';
    const h = await A.escrita.criarHistoria({ titulo: 'A torre' });
    const cap = await A.escrita.criarCapitulo(h.id, { titulo: 'Um' });
    const cena = await A.escrita.criarCena(h.id, { titulo: 'Abertura', capitulo: cap.id });
    await A.escrita.gravarTexto(cena.id, 'Era uma vez, sem internet.');
    await A.escrita.criarIdeia({ titulo: 'Ideia solta' });
    await A.escrita.criarPersonagem(h.id, { nome: 'Lia' });

    const e1 = await A.sinc.sincronizar();
    expect(e1).toMatchObject({ situacao: 'sem-rede', pendentes: 5, erro: null, ultimaVez: null });
    expect(e1.proximaTentativa).not.toBeNull();
    expect(s.linhas('ana')).toEqual([]);

    s.falha = null;
    const e2 = await A.sinc.sincronizar();
    expect(e2).toMatchObject({ situacao: 'em-dia', pendentes: 0, recusados: 0, erro: null, proximaTentativa: null });
    expect(e2.ultimaVez).not.toBeNull();
    expect(s.linhas('ana')).toHaveLength(5);
    expect(A.estados.map((x) => x.situacao)).toContain('enviando');

    expect(await B.escrita.historias()).toEqual([]);
    expect((await B.sinc.sincronizar()).situacao).toBe('em-dia');
    expect((await B.escrita.historias()).map((x) => x.titulo)).toEqual(['A torre']);
    expect(await textos(B.escrita, h.id)).toEqual(['Era uma vez, sem internet.']);
    expect((await B.escrita.cena(cena.id)).palavras).toBe(5);
    expect((await B.escrita.ideias()).map((x) => x.titulo)).toEqual(['Ideia solta']);
    expect((await B.escrita.personagens(h.id)).map((x) => x.nome)).toEqual(['Lia']);
    expect(await retrato(B.armazem)).toEqual(await retrato(A.armazem));
    // o que veio do servidor não volta para a fila
    expect(await B.armazem.pendentes()).toEqual({ fila: 0, recusados: 0 });

    // e de B para A
    await B.escrita.gravarTexto(cena.id, 'Era uma vez, sem internet. Continuei no celular.');
    await B.sinc.sincronizar();
    await A.sinc.sincronizar();
    expect(await textos(A.escrita, h.id)).toEqual(['Era uma vez, sem internet. Continuei no celular.']);
    expect(await A.escrita.copiasDeConflito()).toEqual([]);
    // sincronizar sem novidade não regrava nada no servidor
    const seqAntes = s.linhas('ana').map((l) => l.seq);
    await A.sinc.sincronizar();
    await B.sinc.sincronizar();
    expect(s.linhas('ana').map((l) => l.seq)).toEqual(seqAntes);
  });

  it('nova tentativa em 10 s, 30 s, 1 min, 2 min, 5 min (e fica nos 5); quando a rede volta, na hora', async () => {
    const s = new ServidorFalso();
    const m = mundo();
    const A = m.aparelho('aaaaaaaa', s.transporte('ana'));
    s.falha = 'rede';
    await A.escrita.criarIdeia({ titulo: 'não pode se perder' });
    A.sinc.ligar();
    await A.sinc.sincronizar();
    expect(A.sinc.estado.situacao).toBe('sem-rede');
    const esperas: number[] = [];
    for (let i = 0; i < 7; i++) {
      expect(A.agendador.marcados).toHaveLength(1);
      esperas.push(A.agendador.rodar());
      await A.sinc.sincronizar();
      expect(A.sinc.estado).toMatchObject({ situacao: 'sem-rede', pendentes: 1 });
    }
    expect(esperas).toEqual([10_000, 30_000, 60_000, 120_000, 300_000, 300_000, 300_000]);
    expect([...ESPERAS]).toEqual([10_000, 30_000, 60_000, 120_000, 300_000]);
    expect(s.linhas('ana')).toEqual([]);

    // a rede volta: não espera os 5 minutos
    s.falha = null;
    const pedidosAntes = s.pedidos.enviar;
    A.redeVoltou();
    await A.sinc.sincronizar();
    expect(s.pedidos.enviar).toBe(pedidosAntes + 1);
    expect(A.sinc.estado).toMatchObject({ situacao: 'em-dia', pendentes: 0 });
    expect(s.linhas('ana')).toHaveLength(1);
    // em dia e ligado: fica marcado só o puxar de rotina (1 min)
    expect(A.agendador.marcados.map((x) => x.ms)).toEqual([60_000]);
    // depois de dar certo, a contagem das esperas recomeça
    s.falha = 'rede';
    A.agendador.rodar();
    await A.sinc.sincronizar();
    expect(A.agendador.marcados.map((x) => x.ms)).toEqual([10_000]);
    A.sinc.desligar();
    expect(A.agendador.marcados).toEqual([]);
  });

  it('ligado: uma mudança local marca a sincronização sozinha', async () => {
    const s = new ServidorFalso();
    const m = mundo();
    const A = m.aparelho('aaaaaaaa', s.transporte('ana'));
    A.sinc.ligar();
    await A.sinc.sincronizar();
    expect(A.agendador.marcados.map((x) => x.ms)).toEqual([60_000]);
    await A.escrita.criarIdeia({ titulo: 'x' });
    await A.escrita.criarIdeia({ titulo: 'y' });
    // troca a espera longa pela curta (2 s depois da mudança), uma vez só
    expect(A.agendador.marcados.map((x) => x.ms)).toEqual([2000]);
    A.agendador.rodar();
    await A.sinc.sincronizar();
    expect(s.linhas('ana')).toHaveLength(2);
    expect(A.sinc.estado.situacao).toBe('em-dia');
    A.sinc.desligar();
  });

  it('conflito de texto: o vencedor fica na cena, o perdedor vira cena irmã; os dois aparelhos ficam iguais e não nasce cópia em cascata', async () => {
    const s = new ServidorFalso();
    const m = mundo();
    const A = m.aparelho('aaaaaaaa', s.transporte('ana'));
    const B = m.aparelho('bbbbbbbb', s.transporte('ana'));
    const h = await A.escrita.criarHistoria({ titulo: 'H' });
    const cap = await A.escrita.criarCapitulo(h.id, { titulo: 'C' });
    const cena = await A.escrita.criarCena(h.id, { titulo: 'A cena', capitulo: cap.id, texto: 'Texto de base.' });
    const depois = await A.escrita.criarCena(h.id, { titulo: 'A seguinte', capitulo: cap.id, texto: 'Depois.' });
    await A.sinc.sincronizar();
    await B.sinc.sincronizar();

    // os dois escrevem sem rede; B escreve por último (versão maior)
    await A.escrita.gravarTexto(cena.id, 'Escrito no computador.');
    m.passar(60_000);
    await B.escrita.gravarTexto(cena.id, 'Escrito no celular, mais tarde.');
    await B.escrita.editarCena(cena.id, { status: 'revisada' });
    const versaoDeA = (await A.escrita.cena(cena.id)).versao;

    await A.sinc.sincronizar(); // A chega primeiro: o servidor fica com o texto de A
    expect(s.linhas('ana').find((l) => l.id === cena.id)!.dados['texto']).toBe('Escrito no computador.');
    await B.sinc.sincronizar(); // B recebe "conflito", mescla e reenvia
    expect(B.sinc.estado).toMatchObject({ situacao: 'em-dia', pendentes: 0, copias: 1 });

    const emB = await B.escrita.arvore(h.id);
    expect(emB.capitulos[0]!.cenas.map((c) => c.texto)).toEqual(['Escrito no celular, mais tarde.', 'Escrito no computador.', 'Depois.']);
    const copia = emB.capitulos[0]!.cenas[1]!;
    expect(copia).toMatchObject({ titulo: 'A cena', historia: h.id, capitulo: cap.id, conflito_de: cena.id, conflito_aparelho: 'aaaaaaaa', palavras: 3 });
    expect(copia.conflito_em).toBe(Number(versaoDeA.slice(0, 13)));
    expect(copia.id).not.toBe(cena.id);
    expect(depois.ordem > copia.ordem && copia.ordem > cena.ordem).toBe(true);
    expect(await B.escrita.copiasDeConflito()).toHaveLength(1);
    expect((await B.escrita.cena(cena.id)).status).toBe('revisada');

    await A.sinc.sincronizar();
    expect(await retrato(A.armazem)).toEqual(await retrato(B.armazem));
    expect(await textos(A.escrita, h.id)).toEqual(['Escrito no celular, mais tarde.', 'Escrito no computador.', 'Depois.']);
    expect(A.sinc.estado.copias).toBe(0); // em A a cópia chegou pronta do servidor

    // mais voltas de sincronização: nada muda, nenhuma cópia nova
    const linhas = JSON.stringify(s.linhas('ana'));
    for (let i = 0; i < 3; i++) {
      await B.sinc.sincronizar();
      await A.sinc.sincronizar();
    }
    expect(JSON.stringify(s.linhas('ana'))).toBe(linhas);
    expect(await A.escrita.cenas(h.id)).toHaveLength(3);
    expect(s.linhas('ana').filter((l) => l.colecao === 'cenas')).toHaveLength(3);

    // a pessoa aceita a cópia como cena comum
    await A.escrita.dispensarConflito(copia.id);
    await A.sinc.sincronizar();
    await B.sinc.sincronizar();
    expect(await B.escrita.copiasDeConflito()).toEqual([]);
    expect(await B.escrita.cenas(h.id)).toHaveLength(3);
  });

  it('conflito de texto com três aparelhos sem rede: os três textos sobrevivem, e todos ficam iguais', async () => {
    const s = new ServidorFalso();
    const m = mundo();
    const [A, B, C] = ['aaaaaaaa', 'bbbbbbbb', 'cccccccc'].map((id) => m.aparelho(id, s.transporte('ana'))) as [Aparelho, Aparelho, Aparelho];
    const h = await A.escrita.criarHistoria({ titulo: 'H' });
    const cena = await A.escrita.criarCena(h.id, { titulo: 'c', texto: 'Base.' });
    await A.sinc.sincronizar();
    await B.sinc.sincronizar();
    await C.sinc.sincronizar();
    await C.escrita.gravarTexto(cena.id, 'Texto C.');
    m.passar(1000);
    await A.escrita.gravarTexto(cena.id, 'Texto A.');
    m.passar(1000);
    await B.escrita.gravarTexto(cena.id, 'Texto B.');
    // ordem de chegada diferente da ordem de escrita
    await A.sinc.sincronizar();
    await C.sinc.sincronizar();
    await B.sinc.sincronizar();
    for (let i = 0; i < 2; i++) for (const x of [A, B, C]) await x.sinc.sincronizar();
    expect((await A.escrita.cena(cena.id)).texto).toBe('Texto B.');
    expect((await textos(A.escrita, h.id)).sort()).toEqual(['Texto A.', 'Texto B.', 'Texto C.']);
    expect(await retrato(B.armazem)).toEqual(await retrato(A.armazem));
    expect(await retrato(C.armazem)).toEqual(await retrato(A.armazem));
    for (const x of [A, B, C]) expect(x.sinc.estado).toMatchObject({ situacao: 'em-dia', pendentes: 0 });
  });

  it('metadados mudados dos dois lados: campo a campo, sem cópia', async () => {
    const s = new ServidorFalso();
    const m = mundo();
    const A = m.aparelho('aaaaaaaa', s.transporte('ana'));
    const B = m.aparelho('bbbbbbbb', s.transporte('ana'));
    const h = await A.escrita.criarHistoria({ titulo: 'H' });
    const c1 = await A.escrita.criarCena(h.id, { titulo: 'um', texto: 'Um.' });
    const c2 = await A.escrita.criarCena(h.id, { titulo: 'dois', texto: 'Dois.' });
    await A.sinc.sincronizar();
    await B.sinc.sincronizar();

    await A.escrita.editarCena(c1.id, { titulo: 'um (título de A)' });
    await A.escrita.editarHistoria(h.id, { genero: 'conto' });
    await B.escrita.editarCena(c1.id, { status: 'final', resumo: 'resumo de B' });
    await B.escrita.editarHistoria(h.id, { genero: 'romance', logline: 'de B' }); // depois: vence no gênero
    await B.escrita.moverCena(c2.id, 'cima'); // reordenar mexe só em c2
    await A.sinc.sincronizar();
    await B.sinc.sincronizar();
    await A.sinc.sincronizar();
    for (const x of [A, B]) {
      expect(await x.escrita.cena(c1.id)).toMatchObject({ titulo: 'um (título de A)', status: 'final', resumo: 'resumo de B', texto: 'Um.' });
      expect(await x.escrita.historia(h.id)).toMatchObject({ genero: 'romance', logline: 'de B' });
      expect((await x.escrita.arvore(h.id)).soltas.map((c) => c.titulo)).toEqual(['dois', 'um (título de A)']);
      expect(await x.escrita.copiasDeConflito()).toEqual([]);
    }
    expect(await retrato(A.armazem)).toEqual(await retrato(B.armazem));
  });

  it('lápide: apagar viaja; edição mais nova que a lápide traz de volta; lápide mais nova vence', async () => {
    const s = new ServidorFalso();
    const m = mundo();
    const A = m.aparelho('aaaaaaaa', s.transporte('ana'));
    const B = m.aparelho('bbbbbbbb', s.transporte('ana'));
    const h = await A.escrita.criarHistoria({ titulo: 'H' });
    const cap = await A.escrita.criarCapitulo(h.id, { titulo: 'C' });
    const c1 = await A.escrita.criarCena(h.id, { titulo: '1', capitulo: cap.id, texto: 'Um.' });
    const c2 = await A.escrita.criarCena(h.id, { titulo: '2', texto: 'Dois.' });
    const c3 = await A.escrita.criarCena(h.id, { titulo: '3', texto: 'Três.' });
    await A.sinc.sincronizar();
    await B.sinc.sincronizar();

    // apagar o capítulo em A some com ele e com a cena dele em B
    await A.escrita.apagarCapitulo(cap.id);
    await A.sinc.sincronizar();
    await B.sinc.sincronizar();
    expect((await B.escrita.arvore(h.id)).capitulos).toEqual([]);
    await expect(B.escrita.cena(c1.id)).rejects.toMatchObject({ codigo: 'nao-existe' });
    const noServidor = s.linhas('ana').find((l) => l.id === c1.id)!;
    expect(noServidor.apagado).toBe(true);
    expect(noServidor.dados['texto']).toBe('Um.'); // a lápide guarda os dados

    // A apaga a cena 2; B, sem saber, edita DEPOIS: a cena volta, com o texto de B
    await A.escrita.apagarCena(c2.id);
    m.passar(1000);
    await B.escrita.gravarTexto(c2.id, 'Dois, e continuei.');
    // B edita a cena 3; A apaga DEPOIS: fica apagada
    await B.escrita.gravarTexto(c3.id, 'Três, editado antes.');
    m.passar(1000);
    await A.escrita.apagarCena(c3.id);
    await A.sinc.sincronizar();
    await B.sinc.sincronizar();
    await A.sinc.sincronizar();
    for (const x of [A, B]) {
      expect(await textos(x.escrita, h.id)).toEqual(['Dois, e continuei.']);
      expect(await x.escrita.copiasDeConflito()).toEqual([]);
    }
    expect(await retrato(A.armazem)).toEqual(await retrato(B.armazem));
    // nada some sem rastro: o texto de B na cena apagada continua guardado na lápide
    expect((await A.armazem.ler('cenas', c3.id))!).toMatchObject({ apagado: true, dados: { texto: 'Três, editado antes.' } });
    // e dá para trazer de volta
    await B.escrita.restaurar('cenas', c3.id);
    await B.sinc.sincronizar();
    await A.sinc.sincronizar();
    expect((await textos(A.escrita, h.id)).sort()).toEqual(['Dois, e continuei.', 'Três, editado antes.']);
  });

  it('reenvio depois de falha: a resposta se perdeu, o servidor já tinha gravado; nada duplica e nada se perde', async () => {
    const s = new ServidorFalso();
    const m = mundo();
    const A = m.aparelho('aaaaaaaa', s.transporte('ana'));
    const B = m.aparelho('bbbbbbbb', s.transporte('ana'));
    const h = await A.escrita.criarHistoria({ titulo: 'H' });
    const cena = await A.escrita.criarCena(h.id, { titulo: 'c', texto: 'Primeiro.' });
    s.perderResposta = true;
    expect(await A.sinc.sincronizar()).toMatchObject({ situacao: 'sem-rede', pendentes: 2 });
    expect(s.linhas('ana')).toHaveLength(2); // o servidor gravou, mas A não sabe
    const seqs = s.linhas('ana').map((l) => l.seq);
    // enquanto isso A continua escrevendo
    await A.escrita.gravarTexto(cena.id, 'Primeiro. Segundo.');
    expect(await A.sinc.sincronizar()).toMatchObject({ situacao: 'em-dia', pendentes: 0 });
    expect(s.linhas('ana')).toHaveLength(2);
    expect(s.linhas('ana').find((l) => l.id === h.id)!.seq).toBe(seqs[0]); // a história não foi regravada
    expect(s.linhas('ana').find((l) => l.id === cena.id)!.dados['texto']).toBe('Primeiro. Segundo.');
    expect(await A.escrita.copiasDeConflito()).toEqual([]);
    await B.sinc.sincronizar();
    expect(await textos(B.escrita, h.id)).toEqual(['Primeiro. Segundo.']);

    // erro do servidor (não é rede): estado "erro" com o código, e tenta de novo depois
    await A.escrita.gravarTexto(cena.id, 'Primeiro. Segundo. Terceiro.');
    s.falha = 'cota';
    expect(await A.sinc.sincronizar()).toMatchObject({ situacao: 'erro', erro: 'cota', pendentes: 1 });
    expect(A.agendador.marcados.map((x) => x.ms)).toEqual([10_000]);
    s.falha = null;
    A.agendador.rodar();
    expect(await A.sinc.sincronizar()).toMatchObject({ situacao: 'em-dia', erro: null, pendentes: 0 });
  });

  it('mudança durante a sincronização não se perde', async () => {
    const s = new ServidorFalso();
    const m = mundo();
    const A = m.aparelho('aaaaaaaa', s.transporte('ana'));
    const h = await A.escrita.criarHistoria({ titulo: 'H' });
    const cena = await A.escrita.criarCena(h.id, { titulo: 'c', texto: 'Um.' });
    const andando = A.sinc.sincronizar();
    const outra = A.sinc.sincronizar(); // chamadas ao mesmo tempo viram uma só
    await A.escrita.gravarTexto(cena.id, 'Um. Dois.'); // digitou no meio
    await Promise.all([andando, outra]);
    await A.sinc.sincronizar();
    expect(A.sinc.estado).toMatchObject({ situacao: 'em-dia', pendentes: 0 });
    expect(s.linhas('ana').find((l) => l.id === cena.id)!.dados['texto']).toBe('Um. Dois.');
  });

  it('paginação: puxa com cursor enquanto houver "mais"; envia em lotes', async () => {
    const s = new ServidorFalso();
    const m = mundo();
    const A = m.aparelho('aaaaaaaa', s.transporte('ana'), { lote: 3 });
    for (let i = 0; i < 10; i++) await A.escrita.criarIdeia({ titulo: `ideia ${i}` });
    await A.sinc.sincronizar();
    expect(s.lotes).toEqual([3, 3, 3, 1]);
    expect(s.linhas('ana')).toHaveLength(10);

    s.pagina = 4; // o servidor fecha a página antes (como a ponte faz por tamanho)
    const B = m.aparelho('bbbbbbbb', s.transporte('ana'));
    const antes = s.pedidos.mudancas;
    await B.sinc.sincronizar();
    expect(s.pedidos.mudancas - antes).toBe(3); // 4 + 4 + 2
    expect((await B.escrita.ideias()).map((i) => i.titulo).sort()).toEqual(Array.from({ length: 10 }, (_, i) => `ideia ${i}`));
    expect(await B.armazem.cursorDoServidor()).toBe(10);
    // da próxima vez só pede o que vem depois do cursor
    await A.escrita.criarIdeia({ titulo: 'a décima primeira' });
    await A.sinc.sincronizar();
    const antes2 = s.pedidos.mudancas;
    await B.sinc.sincronizar();
    expect(s.pedidos.mudancas - antes2).toBe(1);
    expect(await B.escrita.ideias()).toHaveLength(11);
    expect(await B.armazem.cursorDoServidor()).toBe(11);
  });

  it('pedido que não cabe no servidor ("grande"): divide o lote', async () => {
    const s = new ServidorFalso();
    s.cabem = 2;
    const m = mundo();
    const A = m.aparelho('aaaaaaaa', s.transporte('ana'));
    for (let i = 0; i < 7; i++) await A.escrita.criarIdeia({ titulo: `ideia ${i}` });
    expect(await A.sinc.sincronizar()).toMatchObject({ situacao: 'em-dia', pendentes: 0 });
    expect(s.linhas('ana')).toHaveLength(7);
    expect(Math.max(...s.lotes)).toBe(2);
  });

  it('registro recusado pelo servidor: fica guardado no aparelho, o resto sobe, e o estado avisa', async () => {
    const s = new ServidorFalso();
    const m = mundo();
    const A = m.aparelho('aaaaaaaa', s.transporte('ana'));
    const h = await A.escrita.criarHistoria({ titulo: 'H' });
    const enorme = await A.escrita.criarCena(h.id, { titulo: 'enorme', texto: 'palavra '.repeat(700_000) });
    const normal = await A.escrita.criarCena(h.id, { titulo: 'normal', texto: 'Curta.' });
    expect(await A.sinc.sincronizar()).toMatchObject({ situacao: 'erro', erro: 'recusado', pendentes: 0, recusados: 1 });
    expect(s.linhas('ana').map((l) => l.id).sort()).toEqual([h.id, normal.id].sort());
    expect((await A.escrita.cena(enorme.id)).palavras).toBe(700_000); // o texto continua no aparelho
    // não fica reenviando o que foi recusado
    const pedidos = s.pedidos.enviar;
    await A.sinc.sincronizar();
    expect(s.pedidos.enviar).toBe(pedidos);
    // a pessoa encurta a cena: volta à fila e sobe
    await A.escrita.gravarTexto(enorme.id, 'Agora cabe.');
    expect(await A.sinc.sincronizar()).toMatchObject({ situacao: 'em-dia', erro: null, recusados: 0 });
    expect(s.linhas('ana')).toHaveLength(3);
  });

  it('sem conta: nada sai do aparelho; ao entrar, adota os textos e sobe; a sessão caiu = sem conta de novo', async () => {
    const s = new ServidorFalso();
    const m = mundo();
    const local = m.aparelho('aaaaaaaa', null, { dono: 'local' });
    expect(local.sinc.estado.situacao).toBe('sem-conta');
    const h = await local.escrita.criarHistoria({ titulo: 'Escrita antes de entrar' });
    await local.escrita.criarCena(h.id, { titulo: 'c', texto: 'Sem conta.' });
    expect(await local.sinc.sincronizar()).toMatchObject({ situacao: 'sem-conta', pendentes: 2 });
    expect(s.pedidos).toEqual({ mudancas: 0, enviar: 0 });

    // entrou: o armazém da conta adota o que estava no `local`
    const ana = m.aparelho('aaaaaaaa', s.transporte('ana'), { dono: '7' });
    await adotar(local.armazem, ana.armazem);
    expect(await ana.sinc.sincronizar()).toMatchObject({ situacao: 'em-dia', pendentes: 0 });
    expect(s.linhas('ana')).toHaveLength(2);
    expect(await local.escrita.historias()).toEqual([]);
    const outro = m.aparelho('bbbbbbbb', s.transporte('ana'), { dono: '7' });
    await outro.sinc.sincronizar();
    expect(await textos(outro.escrita, h.id)).toEqual(['Sem conta.']);

    // a sessão caiu (401 login): fica só no aparelho, sem insistir
    ana.sinc.trocarTransporte(s.transporte(null));
    await ana.escrita.criarIdeia({ titulo: 'x' });
    expect(await ana.sinc.sincronizar()).toMatchObject({ situacao: 'sem-conta', pendentes: 1 });
    expect(ana.agendador.marcados).toEqual([]);
    // entrou de novo
    ana.sinc.trocarTransporte(s.transporte('ana'));
    expect(await ana.sinc.sincronizar()).toMatchObject({ situacao: 'em-dia', pendentes: 0 });
    expect(s.linhas('ana')).toHaveLength(3);
    // saiu
    ana.sinc.trocarTransporte(null);
    expect((await ana.sinc.sincronizar()).situacao).toBe('sem-conta');
  });

  it('contas diferentes no mesmo servidor nunca se veem', async () => {
    const s = new ServidorFalso();
    const m = mundo();
    const ana = m.aparelho('aaaaaaaa', s.transporte('ana'), { dono: 'ana' });
    const bia = m.aparelho('bbbbbbbb', s.transporte('bia'), { dono: 'bia' });
    await ana.escrita.criarHistoria({ titulo: 'Da Ana' });
    await bia.escrita.criarHistoria({ titulo: 'Da Bia' });
    for (const x of [ana, bia, ana, bia]) await x.sinc.sincronizar();
    expect((await ana.escrita.historias()).map((h) => h.titulo)).toEqual(['Da Ana']);
    expect((await bia.escrita.historias()).map((h) => h.titulo)).toEqual(['Da Bia']);
    expect(s.linhas('ana')).toHaveLength(1);
    expect(s.linhas('bia')).toHaveLength(1);
  });

  it('resposta fora do contrato não derruba nem apaga a fila', async () => {
    const m = mundo();
    const torto: Transporte = {
      mudancas: async () => ({ ok: true, registros: [], cursor: 0, mais: false }),
      enviar: async () => ({ ok: true, resultados: [], cursor: 0 }), // não respondeu por nenhum registro
    };
    const A = m.aparelho('aaaaaaaa', torto);
    await A.escrita.criarIdeia({ titulo: 'x' });
    const e = await A.sinc.sincronizar();
    expect(e.pendentes).toBe(1);
    expect(e.situacao).toBe('enviando');
    const quebrado: Transporte = {
      mudancas: async () => {
        throw new Error('caiu');
      },
      enviar: async () => ({ ok: false, erro: 'rede' }),
    };
    A.sinc.trocarTransporte(quebrado);
    expect(await A.sinc.sincronizar()).toMatchObject({ situacao: 'sem-rede', pendentes: 1 });
  });
});

// ---------- o transporte HTTP ----------

interface Pedido {
  url: string;
  metodo: string;
  credenciais: string | undefined;
  csrf: string | null;
  corpo: unknown;
}

/** Um `fetch` de mentira que responde como a ponte. */
function ponteFalsa(responder: (p: Pedido) => { status?: number; corpo: unknown } | 'cai'): { fetch: typeof fetch; pedidos: Pedido[] } {
  const pedidos: Pedido[] = [];
  const f = (async (entrada: RequestInfo | URL, init?: RequestInit) => {
    const cabecalhos = new Headers(init?.headers);
    const p: Pedido = { url: String(entrada), metodo: init?.method ?? 'GET', credenciais: init?.credentials, csrf: cabecalhos.get('X-CSRF-Token'), corpo: typeof init?.body === 'string' ? (JSON.parse(init.body) as unknown) : undefined };
    pedidos.push(p);
    const r = responder(p);
    if (r === 'cai') throw new TypeError('fetch failed');
    return new Response(typeof r.corpo === 'string' ? r.corpo : JSON.stringify(r.corpo), { status: r.status ?? 200 });
  }) as typeof fetch;
  return { fetch: f, pedidos };
}

describe('revisão da fase 1: nada se perde', () => {
  it('A apaga a história; B, sem rede, escreve numa cena dela: a história volta nos dois, com o texto de B', async () => {
    const s = new ServidorFalso();
    const m = mundo();
    const A = m.aparelho('aaaaaaaa', s.transporte('ana'));
    const B = m.aparelho('bbbbbbbb', s.transporte('ana'));
    const h = await A.escrita.criarHistoria({ titulo: 'H' });
    const cap = await A.escrita.criarCapitulo(h.id, { titulo: 'C' });
    const c1 = await A.escrita.criarCena(h.id, { capitulo: cap.id, texto: 'Começo.' });
    const c2 = await A.escrita.criarCena(h.id, { texto: 'Outra cena.' });
    await A.escrita.criarPersonagem(h.id, { nome: 'Lia' });
    await A.sinc.sincronizar();
    await B.sinc.sincronizar();

    await A.escrita.apagarHistoria(h.id);
    await A.sinc.sincronizar();
    m.passar(1000);
    await B.escrita.gravarTexto(c1.id, 'Começo. E B escreveu um capítulo inteiro DEPOIS.');
    await B.sinc.sincronizar();
    await A.sinc.sincronizar();
    await B.sinc.sincronizar();
    for (const x of [A, B]) {
      expect((await x.escrita.historias()).map((y) => y.id)).toEqual([h.id]);
      const arv = await x.escrita.arvore(h.id);
      // volta tudo o que foi apagado junto com a história
      expect(arv.capitulos.map((y) => y.capitulo.id)).toEqual([cap.id]);
      expect(arv.capitulos[0]!.cenas.map((y) => y.texto)).toEqual(['Começo. E B escreveu um capítulo inteiro DEPOIS.']);
      expect(arv.soltas.map((y) => y.id)).toEqual([c2.id]);
      expect((await x.escrita.personagens(h.id)).map((p) => p.nome)).toEqual(['Lia']);
      expect(await x.escrita.copiasDeConflito()).toEqual([]);
    }
    expect(await retrato(A.armazem)).toEqual(await retrato(B.armazem));
    expect((await A.armazem.pendentes()).fila).toBe(0);
  });

  it('apagar a história sem ninguém editando depois continua apagando', async () => {
    const s = new ServidorFalso();
    const m = mundo();
    const A = m.aparelho('aaaaaaaa', s.transporte('ana'));
    const B = m.aparelho('bbbbbbbb', s.transporte('ana'));
    const h = await A.escrita.criarHistoria({ titulo: 'H' });
    const c = await A.escrita.criarCena(h.id, { texto: 'Antes.' });
    await A.sinc.sincronizar();
    await B.sinc.sincronizar();
    await B.escrita.gravarTexto(c.id, 'Antes, editado antes de apagar.');
    m.passar(1000);
    await A.escrita.apagarHistoria(h.id);
    await A.sinc.sincronizar();
    await B.sinc.sincronizar();
    await A.sinc.sincronizar();
    for (const x of [A, B]) expect(await x.escrita.historias()).toEqual([]);
  });

  it('meio emoji no título da ideia: a nuvem continua, e o que vem depois na fila sobe', async () => {
    const s = new ServidorFalso();
    const m = mundo();
    const A = m.aparelho('aaaaaaaa', s.transporte('ana'));
    // como a ponte antiga: um texto com metade de emoji derruba o pedido inteiro
    s.ilegivel = (r) => JSON.stringify(bemFormado(r.dados)) !== JSON.stringify(r.dados);
    const corte = ('Um farol ' + 'x'.repeat(67) + '🚢 e depois some no mar').slice(0, 77);
    await A.escrita.criarIdeia({ titulo: `${corte}…` });
    await A.escrita.criarHistoria({ titulo: 'Nova' });
    const e = await A.sinc.sincronizar();
    expect(e).toMatchObject({ situacao: 'em-dia', pendentes: 0, recusados: 0 });
    expect(s.linhas('ana')).toHaveLength(2);
  });

  it('um registro que o servidor não consegue ler (vazio/dados) é isolado: fica recusado e o resto sobe', async () => {
    const s = new ServidorFalso();
    const m = mundo();
    const A = m.aparelho('aaaaaaaa', s.transporte('ana'));
    const ideias = [];
    for (let k = 0; k < 7; k++) ideias.push(await A.escrita.criarIdeia({ titulo: `Ideia ${k}` }));
    const ruim = ideias[4]!.id;
    s.ilegivel = (r) => r.id === ruim;
    const e = await A.sinc.sincronizar();
    expect(e).toMatchObject({ situacao: 'erro', erro: 'recusado', pendentes: 0, recusados: 1 });
    expect(s.linhas('ana').map((l) => l.id).sort()).toEqual(ideias.map((i) => i.id).filter((id) => id !== ruim).sort());
    // continua guardado no aparelho; editar devolve à fila
    expect((await A.escrita.ideias()).map((i) => i.id)).toContain(ruim);
  });

  it('o servidor não lê NADA (vazio em todo pedido): ninguém é recusado, e tenta de novo depois', async () => {
    const s = new ServidorFalso();
    const m = mundo();
    const A = m.aparelho('aaaaaaaa', s.transporte('ana'));
    await A.escrita.criarIdeia({ titulo: 'Uma' });
    await A.escrita.criarIdeia({ titulo: 'Outra' });
    s.ilegivel = () => true;
    const e = await A.sinc.sincronizar();
    expect(e).toMatchObject({ situacao: 'erro', erro: 'vazio', pendentes: 2, recusados: 0 });
    expect(e.proximaTentativa).not.toBeNull();
    s.ilegivel = () => false;
    expect(await A.sinc.sincronizar()).toMatchObject({ situacao: 'em-dia', pendentes: 0 });
  });

  it('o armazém fechado no meio da sincronização não vira erro solto', async () => {
    const s = new ServidorFalso();
    const m = mundo();
    const A = m.aparelho('aaaaaaaa', s.transporte('ana'));
    await A.escrita.criarIdeia({ titulo: 'Uma' });
    A.armazem.pendentes = () => Promise.reject(new Error('The database connection is closing'));
    s.falha = 'rede';
    await expect(A.sinc.sincronizar()).resolves.toBeTruthy();
  });
});

describe('TransporteHttp e conferirServidor', () => {
  const registro: RegistroEnvio = { id: uuidv7(T0), colecao: 'ideias', versao: '1794480000000-0000-aaaaaaaa', apagado: false, dados: { titulo: 'x' }, base: null };

  it('fala com a ponte: rotas, cookie, CSRF em X-CSRF-Token', async () => {
    const { fetch: f, pedidos } = ponteFalsa((p) => {
      if (p.url.endsWith('conta/eu')) return { corpo: { ok: true, conta: null, csrf: 'token-1' } };
      if (p.url.includes('escrita/mudancas')) return { corpo: { ok: true, registros: [{ ...registro, base: undefined, seq: 3 }], cursor: 3, mais: false, csrf: 'token-1' } };
      return { corpo: { ok: true, resultados: [{ id: registro.id, estado: 'aceito', seq: 4 }], cursor: 4 } };
    });
    const t = new TransporteHttp({ fetch: f });
    expect(t.base).toBe('/api/v1/');
    const env = await t.enviar([registro]);
    expect(env).toEqual({ ok: true, resultados: [{ id: registro.id, estado: 'aceito', seq: 4 }], cursor: 4 });
    // sem token ainda: primeiro pede um (conta/eu), depois envia com ele
    expect(pedidos.map((p) => [p.metodo, p.url, p.csrf])).toEqual([
      ['GET', '/api/v1/conta/eu', null],
      ['POST', '/api/v1/escrita/enviar', 'token-1'],
    ]);
    expect(pedidos[1]!.corpo).toEqual({ registros: [registro] });
    expect(pedidos[1]!.credenciais).toBe('same-origin');
    const mud = await t.mudancas(2, 50);
    expect(mud).toMatchObject({ ok: true, cursor: 3, mais: false });
    expect(pedidos[2]!.url).toBe('/api/v1/escrita/mudancas?desde=2&limite=50');
    await t.mudancas(0);
    expect(pedidos[3]!.url).toBe('/api/v1/escrita/mudancas?desde=0&limite=500');
  });

  it('token vencido: tenta de novo com o token novo; erros viram códigos', async () => {
    let vez = 0;
    const { fetch: f, pedidos } = ponteFalsa((p) => {
      if (p.url.endsWith('conta/eu')) return { corpo: { ok: true, csrf: 'velho' } };
      if (p.csrf === 'velho') return { status: 403, corpo: { ok: false, erro: 'csrf', csrf: 'novo' } };
      vez += 1;
      return { corpo: { ok: true, resultados: [{ id: registro.id, estado: 'aceito', seq: vez }], cursor: vez } };
    });
    const t = new TransporteHttp({ fetch: f, base: 'https://outro.exemplo/api/v1/' });
    expect((await t.enviar([registro])).ok).toBe(true);
    expect(pedidos.map((p) => p.csrf)).toEqual([null, 'velho', 'novo']);
    expect(pedidos[1]!.url).toBe('https://outro.exemplo/api/v1/escrita/enviar');
    expect(pedidos[1]!.credenciais).toBe('include'); // outro servidor: o cookie só vai assim

    const erros: [ReturnType<Parameters<typeof ponteFalsa>[0]>, string][] = [
      ['cai', 'rede'],
      [{ status: 401, corpo: { ok: false, erro: 'login' } }, 'login'],
      [{ status: 413, corpo: '<html>grande</html>' }, 'grande'],
      [{ status: 500, corpo: '<html>erro</html>' }, 'servidor'],
      [{ corpo: { ok: false } }, 'servidor'],
      [{ corpo: { ok: true, registros: 'não é lista', cursor: 0, mais: false } }, 'servidor'],
      [{ corpo: { ok: true, registros: [{ id: 'x' }], cursor: 0, mais: false } }, 'servidor'],
    ];
    for (const [resposta, codigo] of erros) {
      const r = await new TransporteHttp({ fetch: ponteFalsa(() => resposta).fetch }).mudancas(0);
      expect(r, codigo).toEqual({ ok: false, erro: codigo });
    }
    const torto = await new TransporteHttp({ fetch: ponteFalsa((p) => (p.metodo === 'GET' ? { corpo: { ok: true, csrf: 't' } } : { corpo: { ok: true, resultados: [{ id: registro.id, estado: 'talvez' }], cursor: 1 } })).fetch }).enviar([registro]);
    expect(torto).toEqual({ ok: false, erro: 'servidor' });
  });

  it('baseDoServidor: do que a pessoa digita para a base da API', () => {
    expect(baseDoServidor('meusite.org')).toBe('https://meusite.org/api/v1/');
    expect(baseDoServidor('  https://meusite.org/  ')).toBe('https://meusite.org/api/v1/');
    expect(baseDoServidor('https://meusite.org/api/v1/')).toBe('https://meusite.org/api/v1/');
    expect(baseDoServidor('https://meusite.org/api/v1/escrita/servidor')).toBe('https://meusite.org/api/v1/');
    expect(baseDoServidor('http://localhost:8090')).toBe('http://localhost:8090/api/v1/');
    expect(baseDoServidor('https://escola.org/ekfrase')).toBe('https://escola.org/ekfrase/api/v1/');
    expect(baseDoServidor('')).toBeNull();
    expect(baseDoServidor('ftp://meusite.org')).toBeNull();
    expect(baseDoServidor('http://')).toBeNull();
  });

  it('conferirServidor: GET escrita/servidor, sem login', async () => {
    const boa = ponteFalsa(() => ({ corpo: { ok: true, nome: 'Servidor da escola', versaoProtocolo: 1, aceitaCadastro: true } }));
    expect(await conferirServidor('escola.org', boa.fetch)).toEqual({ ok: true, base: 'https://escola.org/api/v1/', servidor: { nome: 'Servidor da escola', versaoProtocolo: 1, aceitaCadastro: true } });
    expect(boa.pedidos).toMatchObject([{ url: 'https://escola.org/api/v1/escrita/servidor', metodo: 'GET', credenciais: 'omit' }]);
    expect(await conferirServidor('não é endereço!', boa.fetch)).toEqual({ ok: false, erro: 'endereco' });
    expect(await conferirServidor('escola.org', ponteFalsa(() => 'cai').fetch)).toEqual({ ok: false, erro: 'rede' });
    expect(await conferirServidor('escola.org', ponteFalsa(() => ({ corpo: '<html>um site qualquer</html>' })).fetch)).toEqual({ ok: false, erro: 'nao-e-ekfrase' });
    expect(await conferirServidor('escola.org', ponteFalsa(() => ({ status: 404, corpo: { ok: false, erro: 'rota' } })).fetch)).toEqual({ ok: false, erro: 'nao-e-ekfrase' });
    expect(await conferirServidor('escola.org', ponteFalsa(() => ({ corpo: { ok: true, nome: 'Do futuro', versaoProtocolo: 2, aceitaCadastro: false } })).fetch)).toEqual({ ok: false, erro: 'protocolo' });
  });
});
