// SPDX-License-Identifier: MPL-2.0

/**
 * Idiomas sem dependências (DEC-P010). Os textos vivem só em
 * `locales/<idioma>/<arquivo>.json`, com chaves planas e `{parametros}`.
 * Cada arquivo é um "espaço de nomes": a chave `entrar.titulo` de
 * `vernakula.json` vira `vernakula.entrar.titulo`. Assim dois apps nunca brigam
 * pela mesma chave, e o Editor de Textos sabe em que arquivo gravar.
 *
 * Plural por `Intl.PluralRules`: `chave.one`, `chave.other` (e `chave.zero`
 * opcional, que vale antes da regra do idioma).
 *
 * Um idioma novo aparece sozinho quando alguém cria a pasta dele: o nome que o
 * seletor mostra vem da chave `nucleo.idioma.nome` do próprio idioma.
 */

export type Mensagens = Readonly<Record<string, string>>;
/** idioma → (chave completa → texto) */
export type Catalogo = Readonly<Record<string, Mensagens>>;
export type Parametros = Readonly<Record<string, string | number>>;

export const IDIOMA_PADRAO = 'pt-BR';

/** Pedaço do caminho de um arquivo de idioma: `…/locales/<idioma>/<arquivo>.json`. */
const CAMINHO = /locales\/([A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*)\/([a-z0-9-]+)\.json$/;

/**
 * Monta o catálogo a partir dos arquivos carregados (no Vite:
 * `import.meta.glob('/locales/*\/*.json', { eager: true, import: 'default' })`).
 * Ignora o que não for objeto de textos; valores que não são texto viram erro,
 * porque um número ou objeto no meio quebraria a tela em silêncio.
 */
export function montarCatalogo(arquivos: Readonly<Record<string, unknown>>): Catalogo {
  const catalogo: Record<string, Record<string, string>> = {};
  for (const [caminho, conteudo] of Object.entries(arquivos)) {
    const m = CAMINHO.exec(caminho.replace(/\\/g, '/'));
    if (!m || typeof conteudo !== 'object' || conteudo === null) continue;
    const idioma = m[1]!;
    const espaco = m[2]!;
    const destino = (catalogo[idioma] ??= {});
    for (const [chave, texto] of Object.entries(conteudo as Record<string, unknown>)) {
      if (typeof texto !== 'string') {
        throw new Error(`Texto inválido em ${idioma}/${espaco}.json: "${chave}" não é texto`);
      }
      destino[`${espaco}.${chave}`] = texto;
    }
  }
  return catalogo;
}

export interface Tradutor {
  /** Idiomas disponíveis, com o nome de cada um no próprio idioma. */
  idiomas(): readonly { codigo: string; nome: string }[];
  idioma(): string;
  trocarIdioma(codigo: string): void;
  aoTrocar(f: () => void): () => void;
  t(chave: string, parametros?: Parametros): string;
  numero(valor: number, opcoes?: Intl.NumberFormatOptions): string;
  /** Idioma preferido da lista (ex.: navigator.languages) que exista no catálogo. */
  detectar(preferidos: readonly string[]): string;
  /**
   * Textos da escola: trocas feitas no site pela administração (idioma → chave → texto).
   * Valem por cima do padrão dos arquivos; chamar de novo substitui todas; {} limpa.
   */
  sobrepor(textos: Readonly<Record<string, Readonly<Record<string, string>>>>): void;
  /** O texto-padrão (dos arquivos de idioma), sem as trocas da escola. */
  padrao(chave: string, idioma?: string): string | undefined;
  /** Todas as chaves do português (a referência), em ordem. */
  chaves(): readonly string[];
}

export function criarTradutor(catalogo: Catalogo, inicial: string = IDIOMA_PADRAO): Tradutor {
  if (!catalogo[IDIOMA_PADRAO]) throw new Error(`O catálogo precisa do idioma ${IDIOMA_PADRAO}`);
  let atual = catalogo[inicial] ? inicial : IDIOMA_PADRAO;
  let plural = new Intl.PluralRules(atual);
  let numeros = new Intl.NumberFormat(atual);
  const ouvintes = new Set<() => void>();
  let trocas: Readonly<Record<string, Readonly<Record<string, string>>>> = {};
  const avisar = () => {
    for (const f of ouvintes) f();
  };

  const existe = (codigo: string) => Object.hasOwn(catalogo, codigo);

  function texto(chave: string, parametros: Parametros): string | undefined {
    // O idioma escolhido primeiro; se faltar a chave nele, o português (que é a referência).
    for (const idioma of atual === IDIOMA_PADRAO ? [atual] : [atual, IDIOMA_PADRAO]) {
      // A troca da escola vale antes do padrão, inclusive nas formas de plural.
      const doEscola = trocas[idioma];
      const padrao = catalogo[idioma]!;
      const ler = (k: string) => doEscola?.[k] ?? padrao[k];
      let msg = ler(chave);
      const n = parametros['count'];
      if (msg === undefined && typeof n === 'number') {
        const regras = idioma === atual ? plural : new Intl.PluralRules(idioma);
        msg = (n === 0 ? ler(`${chave}.zero`) : undefined) ?? ler(`${chave}.${regras.select(n)}`) ?? ler(`${chave}.other`);
      }
      if (msg !== undefined) return msg;
    }
    return undefined;
  }

  return {
    idiomas: () =>
      Object.keys(catalogo)
        .map((codigo) => ({ codigo, nome: catalogo[codigo]!['nucleo.idioma.nome'] ?? codigo }))
        .sort((a, b) => (a.codigo === IDIOMA_PADRAO ? -1 : b.codigo === IDIOMA_PADRAO ? 1 : a.nome.localeCompare(b.nome))),
    idioma: () => atual,
    trocarIdioma(codigo) {
      if (!existe(codigo) || codigo === atual) return;
      atual = codigo;
      plural = new Intl.PluralRules(codigo);
      numeros = new Intl.NumberFormat(codigo);
      avisar();
    },
    sobrepor(novas) {
      trocas = novas;
      avisar();
    },
    padrao: (chave, idioma = atual) => catalogo[idioma]?.[chave],
    chaves: () => Object.keys(catalogo[IDIOMA_PADRAO]!).sort(),
    aoTrocar(f) {
      ouvintes.add(f);
      return () => {
        ouvintes.delete(f);
      };
    },
    t(chave, parametros = {}) {
      const msg = texto(chave, parametros);
      // Chave inexistente aparece como ela mesma: feio de propósito, e os testes impedem.
      if (msg === undefined) return chave;
      return msg.replace(/\{(\w+)\}/g, (inteiro, nome: string) => {
        const v = parametros[nome];
        if (v === undefined) return inteiro;
        return typeof v === 'number' ? numeros.format(v) : v;
      });
    },
    numero: (valor, opcoes) => new Intl.NumberFormat(atual, opcoes).format(valor),
    detectar(preferidos) {
      // A ordem manda: "pt-PT, en" escolhe português, não inglês.
      for (const tag of preferidos) {
        if (existe(tag)) return tag;
        const base = tag.toLowerCase().split('-')[0];
        const parecido = Object.keys(catalogo).find((c) => c.toLowerCase().split('-')[0] === base);
        if (parecido) return parecido;
      }
      return IDIOMA_PADRAO;
    },
  };
}
