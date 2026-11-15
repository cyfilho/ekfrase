// SPDX-License-Identifier: MPL-2.0

/**
 * O MODELO do Ekfrase Writer (docs/writer/PLANO.md §3), compatível com as Histórias do Persis.
 *
 * Cinco coleções vão à nuvem (`COLECOES`); `versoes_cena` e `escrita_dia` ficam só no aparelho.
 * Todo registro sincronizado tem os campos comuns: `id` (UUID v7), `versao` (HLC), `apagado`
 * (lápide: nada some sem rastro) e `dono`.
 *
 * Na rede e no armazém, um registro é `{ id, colecao, versao, apagado, dados }`, e as versões de
 * cada campo ficam em `dados._v` (especificação: docs/writer/protocolo/README.md). O app trabalha
 * com as ENTIDADES (`Historia`, `Cena`…): os campos comuns e os da coleção lado a lado, sem `_v`.
 */

export const COLECOES = ['historias', 'capitulos', 'cenas', 'ideias', 'personagens'] as const;
export type Colecao = (typeof COLECOES)[number];
export const ehColecao = (v: unknown): v is Colecao => typeof v === 'string' && (COLECOES as readonly string[]).includes(v);

/** Os status de uma cena (os mesmos do Persis), na ordem do trabalho. */
export const STATUS_CENA = ['ideia', 'planejada', 'rascunho', 'escrita', 'revisada', 'final'] as const;
export type StatusCena = (typeof STATUS_CENA)[number];

/** Os tipos de ideia (os mesmos do Persis). */
export const TIPOS_IDEIA = ['premissa', 'personagem', 'cena', 'dialogo', 'cenario', 'titulo', 'reviravolta', 'imagem', 'outro'] as const;
export type TipoIdeia = (typeof TIPOS_IDEIA)[number];

/** Em que uma ideia pode ser transformada. */
export const VIROU = ['historia', 'cena', 'personagem'] as const;
export type Virou = (typeof VIROU)[number];

/** Os campos que todo registro sincronizado tem. */
export interface Comum {
  /** UUID v7, minúsculo. */
  readonly id: string;
  /** HLC da última gravação (texto que se compara como texto). */
  readonly versao: string;
  /** Lápide: o registro foi apagado (os dados continuam guardados). */
  readonly apagado: boolean;
  /** De quem é: o `dono` do armazém (a conta, ou `local` para quem escreve sem conta). */
  readonly dono: string;
}

export interface CamposHistoria {
  titulo: string;
  subtitulo: string;
  genero: string;
  formato: string;
  logline: string;
  sinopse: string;
  tema: string;
  publico: string;
  ponto_vista: string;
  tempo_verbal: string;
  /** 0 = sem meta. */
  meta_palavras: number;
  /** Parâmetros da capa feita por código (o app decide o que vai dentro). */
  capa: Record<string, unknown> | null;
}

export interface CamposCapitulo {
  historia: string;
  titulo: string;
  resumo: string;
  /** Índice fracionário (`ordem.ts`). */
  ordem: string;
}

export interface CamposCena {
  historia: string;
  /** `null` = cena solta (fora de capítulo; aparece antes dos capítulos). */
  capitulo: string | null;
  titulo: string;
  resumo: string;
  objetivo: string;
  conflito: string;
  desfecho: string;
  /** Markdown. */
  texto: string;
  palavras: number;
  meta_palavras: number;
  status: StatusCena;
  ordem: string;
  /** Cópia de conflito (§4.3): o id da cena de onde este texto veio; `null` numa cena comum. */
  conflito_de: string | null;
  /** Cópia de conflito: o aparelho (8 hex do HLC) que escreveu o texto que perdeu. */
  conflito_aparelho: string | null;
  /** Cópia de conflito: quando o texto que perdeu foi escrito (ms desde 1970). */
  conflito_em: number | null;
}

export interface CamposIdeia {
  historia: string | null;
  tipo: TipoIdeia;
  titulo: string;
  texto: string;
  etiquetas: string[];
  fixada: boolean;
  virou_tipo: Virou | null;
  virou_id: string | null;
}

export interface CamposPersonagem {
  historia: string;
  nome: string;
  papel: string;
  desejo: string;
  necessidade: string;
  medo: string;
  notas: string;
}

export interface Campos {
  historias: CamposHistoria;
  capitulos: CamposCapitulo;
  cenas: CamposCena;
  ideias: CamposIdeia;
  personagens: CamposPersonagem;
}

export type Entidade<C extends Colecao> = Comum & Campos[C];
export type Historia = Entidade<'historias'>;
export type Capitulo = Entidade<'capitulos'>;
export type Cena = Entidade<'cenas'>;
export type Ideia = Entidade<'ideias'>;
export type Personagem = Entidade<'personagens'>;

/** Uma versão guardada do texto de uma cena (o histórico). Só no aparelho. */
export interface VersaoCena {
  /** UUID v7. */
  id: string;
  cena: string;
  texto: string;
  palavras: number;
  /** ms desde 1970. */
  criado_em: number;
}

/** Quantas palavras entraram num dia (para a meta diária). Só no aparelho. */
export interface EscritaDia {
  /** `AAAA-MM-DD`, no fuso do aparelho. */
  data: string;
  /** Saldo do dia (pode ficar negativo quando se corta mais do que se escreve). */
  palavras: number;
}

const PADROES: { readonly [K in Colecao]: () => Campos[K] } = {
  historias: () => ({ titulo: '', subtitulo: '', genero: '', formato: '', logline: '', sinopse: '', tema: '', publico: '', ponto_vista: '', tempo_verbal: '', meta_palavras: 0, capa: null }),
  capitulos: () => ({ historia: '', titulo: '', resumo: '', ordem: '' }),
  cenas: () => ({
    historia: '',
    capitulo: null,
    titulo: '',
    resumo: '',
    objetivo: '',
    conflito: '',
    desfecho: '',
    texto: '',
    palavras: 0,
    meta_palavras: 0,
    status: 'rascunho',
    ordem: '',
    conflito_de: null,
    conflito_aparelho: null,
    conflito_em: null,
  }),
  ideias: () => ({ historia: null, tipo: 'outro', titulo: '', texto: '', etiquetas: [], fixada: false, virou_tipo: null, virou_id: null }),
  personagens: () => ({ historia: '', nome: '', papel: '', desejo: '', necessidade: '', medo: '', notas: '' }),
};

/** O valor de cada campo num registro novo (o que falta em `dados` vale isto). */
export function padroes<C extends Colecao>(colecao: C): Campos[C] {
  return PADROES[colecao]() as Campos[C];
}

// ---------- o registro, como vai na rede e fica no armazém ----------

/** As versões de cada campo (`dados._v`): campo → HLC. `apagado` também tem a sua. */
export type VersoesDeCampo = Record<string, string>;

/** O objeto livre que o servidor guarda sem ler. As versões de campo ficam em `_v`. */
export type Dados = Record<string, unknown>;

export interface Registro {
  id: string;
  colecao: Colecao;
  versao: string;
  apagado: boolean;
  dados: Dados;
}

/** Como o servidor devolve: com o número de ordem dele. */
export interface RegistroServidor extends Registro {
  seq: number;
}

/** Como o aparelho envia: com a versão do servidor que ele conhecia (`null` = registro novo). */
export interface RegistroEnvio extends Registro {
  base: string | null;
}

/** As versões de campo de um registro (objeto vazio se não houver). */
export function versoesDe(dados: Dados): VersoesDeCampo {
  const v = dados['_v'];
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as VersoesDeCampo) : {};
}

/** O registro do armazém como entidade do app: campos lado a lado, padrões no que faltar, sem `_v`. */
export function paraEntidade<C extends Colecao>(r: Registro, colecao: C, dono: string): Entidade<C> {
  const campos: Dados = { ...r.dados };
  delete campos['_v'];
  return { ...padroes(colecao), ...(campos as Partial<Campos[C]>), id: r.id, versao: r.versao, apagado: r.apagado, dono };
}

/** Igualdade de valores JSON (a ordem das chaves não conta). */
export function iguais(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  if (Array.isArray(a) || Array.isArray(b)) {
    return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((v, i) => iguais(v, b[i]));
  }
  const oa = a as Record<string, unknown>;
  const ob = b as Record<string, unknown>;
  const ka = Object.keys(oa).filter((k) => oa[k] !== undefined);
  const kb = Object.keys(ob).filter((k) => ob[k] !== undefined);
  return ka.length === kb.length && ka.every((k) => ob[k] !== undefined && iguais(oa[k], ob[k]));
}

/** Metade de um emoji (ou outro caractere de fora do plano básico) sem a outra metade. */
const SURROGATE_SOLTO = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;

/**
 * O valor sem "surrogates" soltos (meio emoji, de um corte por unidade UTF-16): cada metade solta
 * vira U+FFFD. Texto assim não é Unicode válido; o JSON do servidor recusaria o pedido inteiro.
 * Vale para textos dentro de objetos e listas também. O que já está bem formado volta igual.
 */
export function bemFormado<T>(v: T): T {
  if (typeof v === 'string') return v.replace(SURROGATE_SOLTO, '\uFFFD') as T;
  if (Array.isArray(v)) return v.map((x: unknown) => bemFormado(x)) as T;
  if (v && typeof v === 'object') {
    const saida: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v as Record<string, unknown>)) saida[bemFormado(k)] = bemFormado(x);
    return saida as T;
  }
  return v;
}
