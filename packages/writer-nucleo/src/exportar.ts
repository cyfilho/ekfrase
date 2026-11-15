// SPDX-License-Identifier: MPL-2.0

/**
 * EXPORTAR em Markdown e em `.ekfr` (o `.docx` fica em `docx.ts`). Tudo função pura sobre uma
 * `HistoriaCompleta` (`Escrita.completa`): mesmos dados = mesmos bytes.
 *
 * Markdown, dois jeitos:
 *  - PASTA (entregue como .zip): `<História>/historia.md`, `personagens.md`, `ideias.md`,
 *    `NN - <Cena solta>.md` e `NN - <Capítulo>/capitulo.md` + `NN - <Cena>.md`. Cada arquivo abre
 *    em qualquer editor; os dados que não são texto vão num cabeçalho `---` no topo.
 *  - ARQUIVO ÚNICO: `# História`, `## Capítulo`, `### Cena` e o texto.
 * Nos dois, o que sai daqui volta igual por `importar.ts`. Nenhum texto de interface: os nomes de
 * arquivo e as chaves são os nomes dos campos do modelo.
 *
 * `.ekfr` (docs/formato-ekfr.md): app `writer`, tipos `historia` (entrada `historia.json`) e
 * `ideias` (entrada `ideias.json`).
 */
import { gravarEkfr } from '@ekfrase/arquivo/ekfr';
import { strToU8, zipSync, type Zippable } from 'fflate';
import type { HistoriaCompleta, HistoriaImportada } from './dominio.ts';
import { padroes, type Campos, type Cena, type Colecao, type Ideia } from './modelo.ts';

export const APP = 'writer';
export const TIPO_HISTORIA = 'historia';
export const TIPO_IDEIAS = 'ideias';
/** A versão do formato dos dois tipos de `.ekfr` do Writer. */
export const FORMATO_EKFR = '1.0.0';
export const GRAVADO_POR = 'writer-web@0.1.0';
/** A marca, no cabeçalho do arquivo único, de que ele saiu daqui (e volta sem perda). */
export const MARCA_MD = 'ekfrase_writer';

/** Data fixa nas entradas dos ZIP: mesmo conteúdo = mesmos bytes. */
const DATA_ZIP = new Date(2026, 0, 1, 0, 0, 0);

/** Os campos de cada coleção que vão para os arquivos (os outros o núcleo recalcula ao importar). */
const EXPORTA: { readonly [C in Colecao]: readonly (keyof Campos[C])[] } = {
  historias: ['titulo', 'subtitulo', 'genero', 'formato', 'logline', 'sinopse', 'tema', 'publico', 'ponto_vista', 'tempo_verbal', 'meta_palavras', 'capa'],
  capitulos: ['titulo', 'resumo'],
  cenas: ['titulo', 'status', 'resumo', 'objetivo', 'conflito', 'desfecho', 'meta_palavras', 'texto'],
  ideias: ['titulo', 'tipo', 'etiquetas', 'fixada', 'texto'],
  personagens: ['nome', 'papel', 'desejo', 'necessidade', 'medo', 'notas'],
};

const vazio = (v: unknown): boolean => v === '' || v === null || v === 0 || v === false || (Array.isArray(v) && v.length === 0);

/** Só os campos exportados de um registro, na ordem fixa. `enxuto` deixa de fora os vazios. */
export function camposExportados<C extends Colecao>(colecao: C, e: Campos[C], enxuto = false, menos: readonly string[] = []): Record<string, unknown> {
  const saida: Record<string, unknown> = {};
  for (const campo of EXPORTA[colecao]) {
    const v = e[campo] as unknown;
    if (menos.includes(campo as string) || (enxuto && (vazio(v) || (campo === 'status' && v === padroes('cenas').status)))) continue;
    saida[campo as string] = v;
  }
  return saida;
}

// ---------- pedaços de Markdown ----------

/** O cabeçalho `---` (cada valor em JSON, que também é YAML válido). Vazio se não houver campos. */
export function cabecalho(campos: Record<string, unknown>): string {
  const linhas = Object.entries(campos).map(([c, v]) => `${c}: ${JSON.stringify(v)}`);
  return linhas.length ? `---\n${linhas.join('\n')}\n---\n\n` : '';
}

/** Dados numa linha de comentário (no arquivo único, em `personagens.md` e em `ideias.md`). */
export function comentario(campos: Record<string, unknown>): string {
  return Object.keys(campos).length ? `<!-- ${JSON.stringify(campos).replace(/>/g, '\\u003e')} -->\n` : '';
}

/** Uma linha do texto que começa com `#` ganha `\` na frente, para não virar título do arquivo. */
export const protegerTitulos = (texto: string): string => texto.replace(/^(\\*#)/gm, '\\$1');

const umaLinha = (titulo: string): string => titulo.replace(/\s+/g, ' ').trim();

/** Um nome de arquivo ou pasta seguro em qualquer sistema (pode sair vazio). */
export function nomeSeguro(titulo: string): string {
  return titulo
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    // por letra (código), não por unidade UTF-16: não corta um emoji ao meio
    .replace(/^(.{0,60}).*$/su, '$1')
    .replace(/[. ]+$/, '');
}

const numerado = (n: number, total: number, titulo: string): string => {
  const numero = String(n).padStart(Math.max(2, String(total).length), '0');
  const nome = nomeSeguro(titulo);
  return nome ? `${numero} - ${nome}` : numero;
};

/** O arquivo de uma cena: cabeçalho com os dados, `# Título` e o texto. */
export function cenaEmMd(cena: Campos['cenas']): string {
  return `${cabecalho(camposExportados('cenas', cena, true, ['titulo', 'texto']))}# ${umaLinha(cena.titulo)}\n\n${cena.texto}\n`;
}

/** `ideias.md`: uma ideia por `## Título`, com os dados numa linha de comentário. */
export function exportarIdeiasMd(ideias: readonly Campos['ideias'][]): string {
  return ideias.map((i) => `## ${umaLinha(i.titulo)}\n${comentario(camposExportados('ideias', i, true, ['titulo', 'texto']))}\n${protegerTitulos(i.texto)}\n\n`).join('');
}

function personagensEmMd(personagens: readonly Campos['personagens'][]): string {
  return personagens.map((p) => `## ${umaLinha(p.nome)}\n${comentario(camposExportados('personagens', p, true, ['nome', 'notas']))}\n${protegerTitulos(p.notas)}\n\n`).join('');
}

// ---------- a pasta (zip) ----------

/** A história como arquivos de texto: caminho (com a pasta da história na frente) → conteúdo. */
export function historiaEmArquivos(h: HistoriaCompleta, pasta: string = nomeSeguro(h.historia.titulo) || 'historia'): Record<string, string> {
  const saida: Record<string, string> = {};
  const hist = h.historia;
  saida[`${pasta}/historia.md`] = `${cabecalho(camposExportados('historias', hist, true, ['titulo', 'sinopse']))}# ${umaLinha(hist.titulo)}\n\n${hist.sinopse}\n`;
  if (h.personagens.length) saida[`${pasta}/personagens.md`] = personagensEmMd(h.personagens);
  if (h.ideias.length) saida[`${pasta}/ideias.md`] = exportarIdeiasMd(h.ideias);
  const total = h.soltas.length + h.capitulos.length;
  let n = 0;
  for (const cena of h.soltas) saida[`${pasta}/${numerado(++n, total, cena.titulo)}.md`] = cenaEmMd(cena);
  for (const { capitulo, cenas } of h.capitulos) {
    const dir = `${pasta}/${numerado(++n, total, capitulo.titulo)}`;
    saida[`${dir}/capitulo.md`] = `# ${umaLinha(capitulo.titulo)}\n\n${capitulo.resumo}\n`;
    cenas.forEach((cena, i) => (saida[`${dir}/${numerado(i + 1, cenas.length, cena.titulo)}.md`] = cenaEmMd(cena)));
  }
  return saida;
}

function zipar(arquivos: Record<string, string>): Uint8Array {
  const z: Zippable = {};
  for (const [caminho, texto] of Object.entries(arquivos)) z[caminho] = strToU8(texto);
  return zipSync(z, { level: 6, mtime: DATA_ZIP });
}

/** Uma história = uma pasta com capítulos e cenas numerados, num .zip. */
export function exportarHistoriaZip(h: HistoriaCompleta): Uint8Array {
  return zipar(historiaEmArquivos(h));
}

/** Várias histórias (cada uma na sua pasta) e as ideias soltas (`ideias.md` na raiz), num .zip. */
export function exportarTudoZip(historias: readonly HistoriaCompleta[], ideiasSoltas: readonly Ideia[] = []): Uint8Array {
  const arquivos: Record<string, string> = {};
  const usadas = new Set<string>();
  for (const h of historias) {
    const base = nomeSeguro(h.historia.titulo) || 'historia';
    let pasta = base;
    for (let n = 2; usadas.has(pasta.toLowerCase()); n++) pasta = `${base} (${n})`;
    usadas.add(pasta.toLowerCase());
    Object.assign(arquivos, historiaEmArquivos(h, pasta));
  }
  if (ideiasSoltas.length) arquivos['ideias.md'] = exportarIdeiasMd(ideiasSoltas);
  return zipar(arquivos);
}

// ---------- o arquivo único ----------

/** A história inteira num `.md` só: `# História`, `## Capítulo`, `### Cena`. */
export function exportarHistoriaMd(h: HistoriaCompleta): string {
  const cena = (c: Cena): string => `### ${umaLinha(c.titulo)}\n${comentario(camposExportados('cenas', c, true, ['titulo', 'texto']))}\n${protegerTitulos(c.texto)}\n\n`;
  let md = cabecalho({ [MARCA_MD]: 1, ...camposExportados('historias', h.historia, true, ['titulo']) });
  md += `# ${umaLinha(h.historia.titulo)}\n\n`;
  for (const c of h.soltas) md += cena(c);
  for (const { capitulo, cenas } of h.capitulos) {
    md += `## ${umaLinha(capitulo.titulo)}\n${comentario(camposExportados('capitulos', capitulo, true, ['titulo']))}\n`;
    for (const c of cenas) md += cena(c);
  }
  return md;
}

// ---------- .ekfr ----------

export interface OpcoesEkfr {
  /** Quem grava: `writer-<plataforma>@<versão>`. */
  gravadoPor?: string;
  /** Datas ISO 8601 (UTC) para o envelope. Sem elas, mesmos dados = mesmos bytes. */
  criado?: string;
  modificado?: string;
}

/** O conteúdo de `historia.json`: a história sem ids (quem importa cria registros novos). */
export function historiaParaArquivo(h: HistoriaCompleta): HistoriaImportada {
  return {
    campos: camposExportados('historias', h.historia),
    soltas: h.soltas.map((c) => camposExportados('cenas', c)),
    capitulos: h.capitulos.map(({ capitulo, cenas }) => ({ campos: camposExportados('capitulos', capitulo), cenas: cenas.map((c) => camposExportados('cenas', c)) })),
    personagens: h.personagens.map((p) => camposExportados('personagens', p)),
    ideias: h.ideias.map((i) => camposExportados('ideias', i)),
  };
}

const json = (v: unknown): Uint8Array => strToU8(`${JSON.stringify(v, null, 2)}\n`);

const envelope = (tipo: string, titulo: string | undefined, o: OpcoesEkfr) => ({
  app: APP,
  tipo,
  formato: FORMATO_EKFR,
  gravadoPor: o.gravadoPor ?? GRAVADO_POR,
  ...(titulo ? { titulo } : {}),
  ...(o.criado ? { criado: o.criado } : {}),
  ...(o.modificado ? { modificado: o.modificado } : {}),
});

/** Uma história num `.ekfr` (tipo `historia`). */
export function exportarEkfrHistoria(h: HistoriaCompleta, opcoes: OpcoesEkfr = {}): Uint8Array {
  return gravarEkfr(envelope(TIPO_HISTORIA, umaLinha(h.historia.titulo) || undefined, opcoes), { 'historia.json': json(historiaParaArquivo(h)) });
}

/** Um conjunto de ideias num `.ekfr` (tipo `ideias`). */
export function exportarEkfrIdeias(ideias: readonly Campos['ideias'][], opcoes: OpcoesEkfr = {}): Uint8Array {
  return gravarEkfr(envelope(TIPO_IDEIAS, undefined, opcoes), { 'ideias.json': json({ ideias: ideias.map((i) => camposExportados('ideias', i)) }) });
}
