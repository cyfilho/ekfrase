// SPDX-License-Identifier: MPL-2.0

/**
 * As OPERAÇÕES do Writer sobre o armazém: é só isto que o app chama. Cada operação é uma gravação
 * atômica (apagar uma história apaga capítulos, cenas e personagens na mesma transação, com a
 * mesma versão). Apagar é sempre LÁPIDE: o registro fica guardado e pode voltar (`restaurar`).
 *
 * A árvore de uma história: primeiro as cenas SOLTAS (sem capítulo), depois os capítulos, cada um
 * com as suas cenas. Dentro de cada grupo a ordem é o índice fracionário (`ordem.ts`): mover muda
 * um registro só.
 */
import { MudouAntes, type Armazem, type Gravacao } from './armazem.ts';
import { versoesDe, paraEntidade, padroes, type Campos, type CamposCena, type Capitulo, type Cena, type Colecao, type Dados, type Entidade, type EscritaDia, type Historia, type Ideia, type Personagem, type StatusCena, type VersaoCena, type Virou, STATUS_CENA, TIPOS_IDEIA } from './modelo.ts';
import { ehOrdem, entre, logoDepois, porOrdem, variasEntre } from './ordem.ts';
import { contarPalavras } from './palavras.ts';
import { uuidv7 } from './uuid.ts';

/** De quanto em quanto tempo (com mudança) o texto de uma cena ganha uma versão no histórico. */
export const INTERVALO_DE_VERSAO = 5 * 60 * 1000;
/** Quantas versões o histórico guarda por cena (as mais antigas saem). */
export const MAX_VERSOES_POR_CENA = 50;

export type CodigoErroEscrita = 'nao-existe' | 'sem-historia' | 'invalido';

/** Erro de uso, com CÓDIGO (o texto vem dos idiomas do app). */
export class ErroEscrita extends Error {
  readonly codigo: CodigoErroEscrita;
  constructor(codigo: CodigoErroEscrita) {
    super(codigo);
    this.name = 'ErroEscrita';
    this.codigo = codigo;
  }
}

export interface OpcoesEscrita {
  /** O relógio em ms (padrão: `Date.now`). */
  agora?: () => number;
  /** O dia (`AAAA-MM-DD`) de um instante, no fuso do aparelho. */
  dia?: (ms: number) => string;
}

export interface Arvore {
  historia: Historia;
  /** As cenas sem capítulo, em ordem (aparecem antes dos capítulos). */
  soltas: Cena[];
  capitulos: { capitulo: Capitulo; cenas: Cena[] }[];
}

export interface Totais {
  palavras: number;
  cenas: number;
  capitulos: number;
  /** A meta de palavras da história (0 = sem meta). */
  meta: number;
  porStatus: Record<StatusCena, number>;
}

export interface DiaDeEscrita {
  data: string;
  /** Palavras do dia (nunca negativo). */
  palavras: number;
  /** A meta diária (0 = sem meta). */
  meta: number;
  cumprida: boolean;
}

/** Uma história com tudo o que é dela (para exportar). */
export interface HistoriaCompleta extends Arvore {
  personagens: Personagem[];
  /** As ideias ligadas a esta história. */
  ideias: Ideia[];
}

/** Uma história que vem de fora (importar): sem ids; quem importa cria registros novos. */
export interface HistoriaImportada {
  campos: Record<string, unknown>;
  soltas: Record<string, unknown>[];
  capitulos: { campos: Record<string, unknown>; cenas: Record<string, unknown>[] }[];
  personagens: Record<string, unknown>[];
  ideias: Record<string, unknown>[];
}

/** Os campos que NÃO vêm de fora: ligações, ordem, contagens e marcas que o núcleo calcula. */
const SO_DO_NUCLEO = new Set(['historia', 'capitulo', 'ordem', 'palavras', 'virou_tipo', 'virou_id', 'conflito_de', 'conflito_aparelho', 'conflito_em']);

/** Do que veio de um arquivo, só os campos conhecidos e com o tipo certo (o resto é ignorado). */
export function camposConfiaveis<C extends Colecao>(colecao: C, bruto: Record<string, unknown>): Partial<Campos[C]> {
  const modelo = padroes(colecao) as unknown as Record<string, unknown>;
  const saida: Record<string, unknown> = {};
  for (const [campo, padrao] of Object.entries(modelo)) {
    const v = bruto[campo];
    if (v === undefined || SO_DO_NUCLEO.has(campo)) continue;
    if (campo === 'status') {
      if ((STATUS_CENA as readonly unknown[]).includes(v)) saida[campo] = v;
    } else if (campo === 'tipo') {
      if ((TIPOS_IDEIA as readonly unknown[]).includes(v)) saida[campo] = v;
    } else if (campo === 'etiquetas') {
      if (Array.isArray(v)) saida[campo] = v.filter((e): e is string => typeof e === 'string');
    } else if (campo === 'capa') {
      if (v === null || (typeof v === 'object' && !Array.isArray(v))) saida[campo] = v;
    } else if (typeof padrao === 'number') {
      if (typeof v === 'number' && Number.isFinite(v) && v >= 0) saida[campo] = Math.floor(v);
    } else if (typeof v === typeof padrao) {
      saida[campo] = v;
    }
  }
  return saida as Partial<Campos[C]>;
}

export type Direcao = 'cima' | 'baixo';
export type DirecaoDaCena = Direcao | 'dentro' | 'fora';

/** Onde pôr uma cena: no fim do grupo, ou encostada em outra cena do mesmo grupo. */
export interface LugarDaCena {
  capitulo: string | null;
  antesDe?: string;
  depoisDe?: string;
}

export function diaLocal(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Uma chave entre duas, tolerando vizinhos com ordem repetida ou estragada (vinda de outro aparelho). */
function entreSeguro(a: string | null, b: string | null): string {
  const x = a !== null && ehOrdem(a) ? a : null;
  const y = b !== null && ehOrdem(b) ? b : null;
  if (x !== null && y !== null && x >= y) return logoDepois(x);
  return entre(x, y);
}

type Parcial<C extends Colecao> = Partial<Campos[C]>;

export class Escrita {
  readonly armazem: Armazem;
  private readonly agora: () => number;
  private readonly dia: (ms: number) => string;

  constructor(armazem: Armazem, opcoes: OpcoesEscrita = {}) {
    this.armazem = armazem;
    this.agora = opcoes.agora ?? Date.now;
    this.dia = opcoes.dia ?? diaLocal;
  }

  // ---------- o básico ----------

  private entidade<C extends Colecao>(colecao: C, r: { id: string; colecao: Colecao; versao: string; apagado: boolean; dados: Dados }): Entidade<C> {
    return paraEntidade(r, colecao, this.armazem.dono);
  }

  private async um<C extends Colecao>(colecao: C, id: string, comApagados = false): Promise<Entidade<C>> {
    const r = await this.armazem.ler(colecao, id);
    if (!r || (r.apagado && !comApagados)) throw new ErroEscrita('nao-existe');
    return this.entidade(colecao, r);
  }

  private async lista<C extends Colecao>(colecao: C, filtro: { historia?: string; capitulo?: string | null } = {}): Promise<Entidade<C>[]> {
    return (await this.armazem.listar(colecao, filtro)).map((r) => this.entidade(colecao, r));
  }

  private nova<C extends Colecao>(colecao: C, campos: Parcial<C>): Gravacao {
    return { colecao, id: uuidv7(this.agora()), dados: { ...padroes(colecao), ...campos } as Dados };
  }

  private async grava<C extends Colecao>(colecao: C, g: Gravacao): Promise<Entidade<C>> {
    return this.entidade(colecao, await this.armazem.gravar(g));
  }

  private async edita<C extends Colecao>(colecao: C, id: string, campos: Parcial<C>): Promise<Entidade<C>> {
    await this.um(colecao, id);
    return this.grava(colecao, { colecao, id, dados: campos as Dados });
  }

  /** Traz de volta um registro apagado. Uma história volta com tudo o que foi apagado junto com ela. */
  async restaurar(colecao: Colecao, id: string): Promise<void> {
    const r = await this.armazem.ler(colecao, id);
    if (!r) throw new ErroEscrita('nao-existe');
    if (!r.apagado) return;
    const quando = versoesDe(r.dados)['apagado'];
    const gs: Gravacao[] = [{ colecao, id, apagado: false }];
    const juntos = async (c: Colecao, filtro: { historia?: string; capitulo?: string }): Promise<void> => {
      for (const filho of await this.armazem.listar(c, { ...filtro, apagados: true })) {
        if (filho.apagado && versoesDe(filho.dados)['apagado'] === quando) gs.push({ colecao: c, id: filho.id, apagado: false });
      }
    };
    if (colecao === 'historias') for (const c of ['capitulos', 'cenas', 'personagens'] as const) await juntos(c, { historia: id });
    if (colecao === 'capitulos') await juntos('cenas', { capitulo: id });
    await this.armazem.gravarVarios(gs);
  }

  // ---------- histórias ----------

  /** As histórias, da mais nova para a mais antiga. */
  async historias(): Promise<Historia[]> {
    return (await this.lista('historias')).sort((a, b) => (a.id < b.id ? 1 : -1));
  }

  historia(id: string): Promise<Historia> {
    return this.um('historias', id);
  }

  criarHistoria(campos: Parcial<'historias'> = {}): Promise<Historia> {
    return this.grava('historias', this.nova('historias', campos));
  }

  editarHistoria(id: string, campos: Parcial<'historias'>): Promise<Historia> {
    return this.edita('historias', id, campos);
  }

  /** Apaga a história e, junto, os capítulos, as cenas e os personagens dela. As ideias ficam. */
  async apagarHistoria(id: string): Promise<void> {
    await this.um('historias', id);
    const gs: Gravacao[] = [{ colecao: 'historias', id, apagado: true }];
    for (const c of ['capitulos', 'cenas', 'personagens'] as const) {
      for (const r of await this.armazem.listar(c, { historia: id })) gs.push({ colecao: c, id: r.id, apagado: true });
    }
    await this.armazem.gravarVarios(gs);
  }

  // ---------- capítulos ----------

  async capitulos(historia: string): Promise<Capitulo[]> {
    return (await this.lista('capitulos', { historia })).sort(porOrdem);
  }

  /** Cria um capítulo no fim da história, ou logo depois de outro. */
  async criarCapitulo(historia: string, campos: Omit<Parcial<'capitulos'>, 'historia' | 'ordem'> = {}, onde: { depoisDe?: string } = {}): Promise<Capitulo> {
    await this.um('historias', historia);
    const ordem = lugar(await this.capitulos(historia), onde);
    return this.grava('capitulos', this.nova('capitulos', { ...campos, historia, ordem }));
  }

  editarCapitulo(id: string, campos: Omit<Parcial<'capitulos'>, 'historia'>): Promise<Capitulo> {
    return this.edita('capitulos', id, campos);
  }

  /** Apaga o capítulo e as cenas dele. */
  async apagarCapitulo(id: string): Promise<void> {
    await this.um('capitulos', id);
    const gs: Gravacao[] = [{ colecao: 'capitulos', id, apagado: true }];
    for (const r of await this.armazem.listar('cenas', { capitulo: id })) gs.push({ colecao: 'cenas', id: r.id, apagado: true });
    await this.armazem.gravarVarios(gs);
  }

  /** Sobe ou desce o capítulo uma posição (na ponta, não faz nada). */
  async moverCapitulo(id: string, direcao: Direcao): Promise<Capitulo> {
    const capitulo = await this.um('capitulos', id);
    const irmaos = await this.capitulos(capitulo.historia);
    const i = irmaos.findIndex((c) => c.id === id);
    if (direcao === 'cima') {
      if (i <= 0) return capitulo;
      return this.moverCapituloPara(id, { antesDe: irmaos[i - 1]!.id });
    }
    if (i < 0 || i >= irmaos.length - 1) return capitulo;
    return this.moverCapituloPara(id, { depoisDe: irmaos[i + 1]!.id });
  }

  /** Põe o capítulo encostado em outro (o arrastar). Sem lugar = no fim. */
  async moverCapituloPara(id: string, onde: { antesDe?: string; depoisDe?: string } = {}): Promise<Capitulo> {
    const capitulo = await this.um('capitulos', id);
    const irmaos = (await this.capitulos(capitulo.historia)).filter((c) => c.id !== id);
    const ordem = lugar(irmaos, onde);
    return this.grava('capitulos', { colecao: 'capitulos', id, dados: { ordem } });
  }

  // ---------- cenas ----------

  /** Todas as cenas da história (sem ordem entre grupos; para a ordem de leitura use `arvore`). */
  async cenas(historia: string): Promise<Cena[]> {
    return (await this.lista('cenas', { historia })).sort(porOrdem);
  }

  cena(id: string): Promise<Cena> {
    return this.um('cenas', id);
  }

  private async grupo(historia: string, capitulo: string | null, menos?: string): Promise<Cena[]> {
    return (await this.lista('cenas', { historia, capitulo })).filter((c) => c.id !== menos).sort(porOrdem);
  }

  private async novaCena(historia: string, campos: Omit<Parcial<'cenas'>, 'historia' | 'ordem' | 'palavras'>, onde: { depoisDe?: string }): Promise<Gravacao> {
    await this.um('historias', historia);
    let capitulo = campos.capitulo ?? null;
    let depois: string | undefined;
    if (onde.depoisDe) {
      const vizinha = await this.um('cenas', onde.depoisDe);
      capitulo = vizinha.capitulo;
      depois = vizinha.id;
    }
    if (capitulo !== null && (await this.um('capitulos', capitulo)).historia !== historia) throw new ErroEscrita('invalido');
    const ordem = lugar(await this.grupo(historia, capitulo), depois ? { depoisDe: depois } : {});
    const texto = campos.texto ?? '';
    return this.nova('cenas', { ...campos, historia, capitulo, ordem, texto, palavras: contarPalavras(texto) });
  }

  /** Cria uma cena no fim do capítulo dado (ou das soltas), ou logo depois de outra cena. */
  async criarCena(historia: string, campos: Omit<Parcial<'cenas'>, 'historia' | 'ordem' | 'palavras'> = {}, onde: { depoisDe?: string } = {}): Promise<Cena> {
    return this.grava('cenas', await this.novaCena(historia, campos, onde));
  }

  /** Edita os dados da cena (título, notas, status…). Para o texto, use `gravarTexto`. */
  editarCena(id: string, campos: Omit<Parcial<'cenas'>, 'historia' | 'capitulo' | 'ordem' | 'palavras' | 'texto'>): Promise<Cena> {
    return this.edita('cenas', id, campos);
  }

  async apagarCena(id: string): Promise<void> {
    await this.um('cenas', id);
    await this.armazem.gravar({ colecao: 'cenas', id, apagado: true });
  }

  /** A história inteira em ordem de leitura. */
  async arvore(historia: string): Promise<Arvore> {
    const h = await this.um('historias', historia);
    const todas = await this.cenas(historia);
    const capitulos = (await this.capitulos(historia)).map((capitulo) => ({ capitulo, cenas: todas.filter((c) => c.capitulo === capitulo.id) }));
    const conhecidos = new Set(capitulos.map((c) => c.capitulo.id));
    // cena cujo capítulo sumiu (apagado em outro aparelho) aparece entre as soltas: nunca fica invisível
    return { historia: h, soltas: todas.filter((c) => c.capitulo === null || !conhecidos.has(c.capitulo)), capitulos };
  }

  /** Põe a cena num grupo (capítulo ou soltas), no fim ou encostada em outra cena. */
  async moverCenaPara(id: string, onde: LugarDaCena): Promise<Cena> {
    const cena = await this.um('cenas', id);
    if (onde.capitulo !== null && (await this.um('capitulos', onde.capitulo)).historia !== cena.historia) throw new ErroEscrita('invalido');
    const ordem = lugar(await this.grupo(cena.historia, onde.capitulo, id), onde);
    return this.grava('cenas', { colecao: 'cenas', id, dados: { capitulo: onde.capitulo, ordem } });
  }

  /**
   * Move a cena pelo teclado. `cima`/`baixo`: uma posição; na ponta do grupo, passa para o grupo
   * vizinho (fim do anterior, começo do seguinte). `fora`: vira cena solta (no fim das soltas).
   * `dentro`: uma cena solta entra no começo do primeiro capítulo. Sem para onde ir, não faz nada.
   */
  async moverCena(id: string, direcao: DirecaoDaCena): Promise<Cena> {
    const cena = await this.um('cenas', id);
    const arvore = await this.arvore(cena.historia);
    const grupos: { capitulo: string | null; cenas: Cena[] }[] = [{ capitulo: null, cenas: arvore.soltas }, ...arvore.capitulos.map((c) => ({ capitulo: c.capitulo.id, cenas: c.cenas }))];
    const g = grupos.findIndex((x) => x.cenas.some((c) => c.id === id));
    const grupo = grupos[g];
    if (!grupo) return cena;
    const i = grupo.cenas.findIndex((c) => c.id === id);
    // (uma cena órfã aparece entre as soltas, mas ainda aponta para o capítulo que sumiu: `fora` conserta)
    if (direcao === 'fora') return cena.capitulo === null ? cena : this.moverCenaPara(id, { capitulo: null });
    if (direcao === 'dentro') {
      const primeiro = grupos[1];
      if (grupo.capitulo !== null || !primeiro) return cena;
      const cabeca = primeiro.cenas[0];
      return this.moverCenaPara(id, { capitulo: primeiro.capitulo, ...(cabeca ? { antesDe: cabeca.id } : {}) });
    }
    if (direcao === 'cima') {
      if (i > 0) return this.moverCenaPara(id, { capitulo: grupo.capitulo, antesDe: grupo.cenas[i - 1]!.id });
      const anterior = grupos[g - 1];
      return anterior ? this.moverCenaPara(id, { capitulo: anterior.capitulo }) : cena;
    }
    if (i < grupo.cenas.length - 1) return this.moverCenaPara(id, { capitulo: grupo.capitulo, depoisDe: grupo.cenas[i + 1]!.id });
    const seguinte = grupos[g + 1];
    if (!seguinte) return cena;
    const cabeca = seguinte.cenas[0];
    return this.moverCenaPara(id, { capitulo: seguinte.capitulo, ...(cabeca ? { antesDe: cabeca.id } : {}) });
  }

  // ---------- o texto e o histórico ----------

  private versao(cena: string, texto: string): VersaoCena {
    const agora = this.agora();
    return { id: uuidv7(agora), cena, texto, palavras: contarPalavras(texto), criado_em: agora };
  }

  /** As versões que passam do limite, contando as que vão entrar agora. */
  private sobras(existentes: readonly VersaoCena[], entram: number): string[] {
    const passa = existentes.length + entram - MAX_VERSOES_POR_CENA;
    return passa > 0 ? existentes.slice(-passa).map((v) => v.id) : [];
  }

  /**
   * Grava o texto da cena (o app chama a cada pausa na digitação). Atualiza `palavras`, soma no dia
   * e, se já passaram 5 minutos desde a última versão do histórico, guarda uma versão. Tudo numa
   * transação só.
   */
  async gravarTexto(id: string, texto: string): Promise<Cena> {
    return (await this.gravarTextoSobre(id, texto)).cena;
  }

  /**
   * `gravarTexto` para quem sabe que texto a cena tinha (`antes`: o que a folha carregou ou gravou
   * por último). Se outra aba mudou o texto nesse meio-tempo, o texto dela NÃO se perde: vira uma
   * versão do histórico na mesma transação, e `outro` volta `true` (a folha avisa). A conferência é
   * feita dentro da transação (`seAinda`): duas abas gravando juntas nunca apagam uma à outra.
   */
  async gravarTextoSobre(id: string, texto: string, antes?: string): Promise<{ cena: Cena; outro: boolean }> {
    for (let tentativa = 0; ; tentativa++) {
      const cena = await this.um('cenas', id);
      if (texto === cena.texto) return { cena, outro: false };
      const outro = antes !== undefined && cena.texto !== antes;
      const agora = this.agora();
      const historico = await this.armazem.versoesDaCena(id);
      const ultima = historico[0];
      // a versão mais nova que não está no futuro (o relógio do aparelho pode ter voltado)
      const referencia = historico.find((v) => v.criado_em <= agora);
      const versoes: VersaoCena[] = [];
      if (outro && cena.texto.trim() !== '' && ultima?.texto !== cena.texto) {
        // o texto que a outra aba escreveu fica no histórico
        versoes.push(this.versao(id, cena.texto));
      } else if (!ultima) {
        // primeira mudança: guarda como o texto estava antes
        if (cena.texto.trim() !== '') versoes.push(this.versao(id, cena.texto));
      } else if ((!referencia || agora - referencia.criado_em >= INTERVALO_DE_VERSAO) && (referencia ?? ultima).texto !== texto) {
        versoes.push(this.versao(id, texto));
      }
      const palavras = contarPalavras(texto);
      try {
        const [r] = await this.armazem.gravarVarios([{ colecao: 'cenas', id, dados: { texto, palavras }, seAinda: { texto: cena.texto } }], {
          somarDia: { data: this.dia(agora), palavras: palavras - contarPalavras(cena.texto) },
          versoes,
          apagarVersoes: this.sobras(historico, versoes.length),
        });
        return { cena: this.entidade('cenas', r!), outro };
      } catch (e) {
        // outra aba gravou entre a leitura e a gravação: lê de novo e tenta outra vez
        if (!(e instanceof MudouAntes) || tentativa >= 5) throw e;
        antes ??= cena.texto;
      }
    }
  }

  /** Ao sair da cena: guarda uma versão no histórico, se o texto mudou desde a última. */
  async sairDaCena(id: string): Promise<void> {
    const cena = await this.um('cenas', id, true);
    const historico = await this.armazem.versoesDaCena(id);
    if (cena.texto.trim() === '' || historico[0]?.texto === cena.texto) return;
    await this.armazem.gravarVarios([], { versoes: [this.versao(id, cena.texto)], apagarVersoes: this.sobras(historico, 1) });
  }

  /**
   * Guarda um texto no histórico da cena SEM mexer no texto dela (o rascunho que sobrou de uma aba
   * fechada às pressas, quando a cena já mudou por outro caminho). Texto vazio ou igual à última
   * versão não entra.
   */
  async guardarNoHistorico(id: string, texto: string): Promise<void> {
    await this.um('cenas', id, true);
    const historico = await this.armazem.versoesDaCena(id);
    if (texto.trim() === '' || historico[0]?.texto === texto) return;
    await this.armazem.gravarVarios([], { versoes: [this.versao(id, texto)], apagarVersoes: this.sobras(historico, 1) });
  }

  /** O histórico da cena, da versão mais nova para a mais antiga. */
  historicoDaCena(id: string): Promise<VersaoCena[]> {
    return this.armazem.versoesDaCena(id);
  }

  /** Volta o texto da cena a uma versão do histórico (o texto de agora vira versão: dá para desfazer). */
  async restaurarVersao(idDaVersao: string): Promise<Cena> {
    const v = await this.armazem.lerVersao(idDaVersao);
    if (!v) throw new ErroEscrita('nao-existe');
    const cena = await this.um('cenas', v.cena);
    if (cena.texto === v.texto) return cena;
    const historico = await this.armazem.versoesDaCena(v.cena);
    const versoes = cena.texto.trim() !== '' && historico[0]?.texto !== cena.texto ? [this.versao(v.cena, cena.texto)] : [];
    const [r] = await this.armazem.gravarVarios([{ colecao: 'cenas', id: v.cena, dados: { texto: v.texto, palavras: contarPalavras(v.texto) } }], {
      versoes,
      apagarVersoes: this.sobras(historico, versoes.length),
    });
    return this.entidade('cenas', r!);
  }

  // ---------- cópias de conflito ----------

  /** As cenas que são cópia de conflito (o aviso da estante). */
  async copiasDeConflito(historia?: string): Promise<Cena[]> {
    return (await this.lista('cenas', historia ? { historia } : {})).filter((c) => c.conflito_de !== null).sort(porOrdem);
  }

  /** A pessoa já viu a cópia e quer ficar com ela como cena comum: tira a marca de conflito. */
  dispensarConflito(id: string): Promise<Cena> {
    return this.edita('cenas', id, { conflito_de: null, conflito_aparelho: null, conflito_em: null });
  }

  // ---------- ideias ----------

  /** As ideias: fixadas primeiro, depois da mais nova para a mais antiga. `historia: null` = só as soltas. */
  async ideias(filtro: { historia?: string | null } = {}): Promise<Ideia[]> {
    const todas = await this.lista('ideias');
    return todas
      .filter((i) => filtro.historia === undefined || i.historia === filtro.historia)
      .sort((a, b) => Number(b.fixada) - Number(a.fixada) || (a.id < b.id ? 1 : -1));
  }

  criarIdeia(campos: Omit<Parcial<'ideias'>, 'virou_tipo' | 'virou_id'> = {}): Promise<Ideia> {
    return this.grava('ideias', this.nova('ideias', campos));
  }

  editarIdeia(id: string, campos: Omit<Parcial<'ideias'>, 'virou_tipo' | 'virou_id'>): Promise<Ideia> {
    return this.edita('ideias', id, campos);
  }

  async apagarIdeia(id: string): Promise<void> {
    await this.um('ideias', id);
    await this.armazem.gravar({ colecao: 'ideias', id, apagado: true });
  }

  /**
   * Transforma a ideia em história, cena ou personagem (a ideia continua e guarda em que virou).
   * Cena e personagem precisam de uma história: a de `onde`, ou a da própria ideia.
   */
  async transformarIdeia(id: string, em: Virou, onde: { historia?: string; capitulo?: string | null } = {}): Promise<{ ideia: Ideia; tipo: Virou; id: string }> {
    const ideia = await this.um('ideias', id);
    let criar: Gravacao;
    if (em === 'historia') {
      criar = this.nova('historias', { titulo: ideia.titulo, sinopse: ideia.texto });
    } else {
      const historia = onde.historia ?? ideia.historia;
      if (!historia) throw new ErroEscrita('sem-historia');
      if (em === 'cena') {
        const campos: Partial<CamposCena> = { titulo: ideia.titulo, resumo: ideia.texto, status: 'ideia', capitulo: onde.capitulo ?? null };
        criar = await this.novaCena(historia, campos, {});
      } else {
        await this.um('historias', historia);
        criar = this.nova('personagens', { historia, nome: ideia.titulo, notas: ideia.texto });
      }
    }
    const [, r] = await this.armazem.gravarVarios([criar, { colecao: 'ideias', id, dados: { virou_tipo: em, virou_id: criar.id } }]);
    return { ideia: this.entidade('ideias', r!), tipo: em, id: criar.id };
  }

  // ---------- personagens ----------

  /** Os personagens da história, por nome. */
  async personagens(historia: string): Promise<Personagem[]> {
    return (await this.lista('personagens', { historia })).sort((a, b) => a.nome.localeCompare(b.nome) || (a.id < b.id ? -1 : 1));
  }

  async criarPersonagem(historia: string, campos: Omit<Parcial<'personagens'>, 'historia'> = {}): Promise<Personagem> {
    await this.um('historias', historia);
    return this.grava('personagens', this.nova('personagens', { ...campos, historia }));
  }

  editarPersonagem(id: string, campos: Omit<Parcial<'personagens'>, 'historia'>): Promise<Personagem> {
    return this.edita('personagens', id, campos);
  }

  async apagarPersonagem(id: string): Promise<void> {
    await this.um('personagens', id);
    await this.armazem.gravar({ colecao: 'personagens', id, apagado: true });
  }

  // ---------- exportar e importar ----------

  /** A história com tudo o que é dela, em ordem (a entrada dos exportadores). */
  async completa(historia: string): Promise<HistoriaCompleta> {
    return { ...(await this.arvore(historia)), personagens: await this.personagens(historia), ideias: await this.ideias({ historia }) };
  }

  /** Cria uma história a partir do que veio de um arquivo: registros NOVOS, numa transação só. Devolve o id. */
  async importar(h: HistoriaImportada): Promise<string> {
    const historia = this.nova('historias', camposConfiaveis('historias', h.campos));
    const gs: Gravacao[] = [historia];
    const cenas = (lista: readonly Record<string, unknown>[], capitulo: string | null): void => {
      const ordens = variasEntre(null, null, lista.length);
      lista.forEach((bruto, i) => {
        const campos = camposConfiaveis('cenas', bruto);
        gs.push(this.nova('cenas', { ...campos, historia: historia.id, capitulo, ordem: ordens[i]!, palavras: contarPalavras(campos.texto ?? '') }));
      });
    };
    cenas(h.soltas, null);
    const ordens = variasEntre(null, null, h.capitulos.length);
    h.capitulos.forEach((c, i) => {
      const capitulo = this.nova('capitulos', { ...camposConfiaveis('capitulos', c.campos), historia: historia.id, ordem: ordens[i]! });
      gs.push(capitulo);
      cenas(c.cenas, capitulo.id);
    });
    for (const p of h.personagens) gs.push(this.nova('personagens', { ...camposConfiaveis('personagens', p), historia: historia.id }));
    for (const i of h.ideias) gs.push(this.nova('ideias', { ...camposConfiaveis('ideias', i), historia: historia.id }));
    await this.armazem.gravarVarios(gs);
    return historia.id;
  }

  /** Cria ideias a partir do que veio de um arquivo (soltas, ou de uma história). Devolve quantas. */
  async importarIdeias(ideias: readonly Record<string, unknown>[], historia: string | null = null): Promise<number> {
    if (historia !== null) await this.um('historias', historia);
    await this.armazem.gravarVarios(ideias.map((i) => this.nova('ideias', { ...camposConfiaveis('ideias', i), historia })));
    return ideias.length;
  }

  // ---------- palavras e metas ----------

  /** Os totais de uma história. */
  async totais(historia: string): Promise<Totais> {
    const h = await this.um('historias', historia);
    const cenas = await this.cenas(historia);
    const porStatus = Object.fromEntries(STATUS_CENA.map((s) => [s, 0])) as Record<StatusCena, number>;
    for (const c of cenas) if (c.status in porStatus) porStatus[c.status] += 1;
    return { palavras: cenas.reduce((n, c) => n + c.palavras, 0), cenas: cenas.length, capitulos: (await this.capitulos(historia)).length, meta: h.meta_palavras, porStatus };
  }

  /** As palavras de cada história (para a estante) e o total geral. */
  async palavrasPorHistoria(): Promise<{ total: number; porHistoria: Record<string, number> }> {
    const vivas = new Set((await this.armazem.listar('historias')).map((h) => h.id));
    const porHistoria: Record<string, number> = {};
    for (const id of vivas) porHistoria[id] = 0;
    let total = 0;
    for (const c of await this.lista('cenas')) {
      if (!vivas.has(c.historia)) continue;
      porHistoria[c.historia] = (porHistoria[c.historia] ?? 0) + c.palavras;
      total += c.palavras;
    }
    return { total, porHistoria };
  }

  /** A meta de palavras por dia (0 = sem meta). Fica só neste aparelho. */
  async metaDoDia(): Promise<number> {
    const m = await this.armazem.lerConfig('meta_dia');
    return typeof m === 'number' && m > 0 ? m : 0;
  }

  async definirMetaDoDia(palavras: number): Promise<void> {
    await this.armazem.gravarConfig('meta_dia', Math.max(0, Math.floor(palavras)));
  }

  private comMeta(d: EscritaDia, meta: number): DiaDeEscrita {
    const palavras = Math.max(0, d.palavras);
    return { data: d.data, palavras, meta, cumprida: meta > 0 && palavras >= meta };
  }

  /** Quanto se escreveu num dia (padrão: hoje) e se a meta foi cumprida. */
  async escritaDoDia(data: string = this.dia(this.agora())): Promise<DiaDeEscrita> {
    return this.comMeta((await this.armazem.lerDia(data)) ?? { data, palavras: 0 }, await this.metaDoDia());
  }

  /** Todos os dias em que se escreveu, do mais antigo para o mais novo. */
  async diasDeEscrita(): Promise<DiaDeEscrita[]> {
    const meta = await this.metaDoDia();
    return (await this.armazem.dias()).map((d) => this.comMeta(d, meta));
  }
}

/** A ordem de quem entra numa lista já ordenada (sem ele): antes de um, depois de outro, ou no fim. */
function lugar(irmaos: readonly { id: string; ordem: string }[], onde: { antesDe?: string; depoisDe?: string }): string {
  if (onde.antesDe) {
    const i = irmaos.findIndex((x) => x.id === onde.antesDe);
    if (i >= 0) return entreSeguro(irmaos[i - 1]?.ordem ?? null, irmaos[i]!.ordem);
  }
  if (onde.depoisDe) {
    const i = irmaos.findIndex((x) => x.id === onde.depoisDe);
    if (i >= 0) return entreSeguro(irmaos[i]!.ordem, irmaos[i + 1]?.ordem ?? null);
  }
  return entreSeguro(irmaos.at(-1)?.ordem ?? null, null);
}
