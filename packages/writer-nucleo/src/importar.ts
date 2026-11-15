// SPDX-License-Identifier: MPL-2.0

/**
 * IMPORTAR `.ekfr` (identificar + podeAbrir, como manda docs/formato-ekfr.md §4) e Markdown
 * (arquivo único ou .zip de pastas). Importar sempre CRIA registros novos, com UUID novo: nunca
 * escreve por cima do que a pessoa já tem. O que `exportar.ts` grava volta igual; Markdown de
 * outros programas entra do melhor jeito possível (`#` título, `##` capítulo, `###` cena).
 *
 * Erro é sempre CÓDIGO (o texto vem dos idiomas do app).
 */
import { ErroArquivo, identificar, lerEkfr, type ErroEkfr } from '@ekfrase/arquivo/ekfr';
import { podeAbrir } from '@ekfrase/arquivo/registro';
import { strFromU8, unzipSync } from 'fflate';
import type { Escrita, HistoriaImportada } from './dominio.ts';
import { APP, MARCA_MD, TIPO_HISTORIA, TIPO_IDEIAS } from './exportar.ts';

/**
 * Proteção contra "bombas" de zip (um .zip pequeno que descompactado não cabe na memória): o limite
 * por entrada, o do total descompactado e o do número de entradas. Conferidos pelo que o próprio
 * .zip declara, ANTES de descompactar qualquer coisa.
 */
export const LIMITES_ZIP = { entrada: 16 * 1024 * 1024, total: 64 * 1024 * 1024, entradas: 5000 } as const;
/**
 * O maior texto de cena que entra (em bytes UTF-8). O servidor não aceita registro de mais de 5 MB;
 * uma cena maior que isto ficaria para sempre só neste aparelho.
 */
export const MAX_TEXTO_CENA = 4 * 1024 * 1024;

/** O .zip passa dos `LIMITES_ZIP`? Só lê o índice do .zip (nada é descompactado). */
export function zipGrandeDemais(bytes: Uint8Array, so: (nome: string) => boolean = () => true): boolean {
  let total = 0;
  let n = 0;
  let grande = false;
  unzipSync(bytes, {
    filter: (f) => {
      if (!so(f.name)) return false;
      n += 1;
      total += f.originalSize;
      if (f.originalSize > LIMITES_ZIP.entrada || total > LIMITES_ZIP.total || n > LIMITES_ZIP.entradas) grande = true;
      return false;
    },
  });
  return grande;
}

const bytesUtf8 = (texto: string): number => new TextEncoder().encode(texto).length;

export type ErroImportar =
  | ErroEkfr
  /** o `.ekfr` é de outro app (`app` diz qual) */
  | 'outro-app'
  | 'versao-nova'
  | 'tipo-desconhecido'
  | 'app-desconhecido'
  /** o arquivo é do Writer, mas o conteúdo está estragado */
  | 'conteudo-invalido'
  /** não havia nada para importar */
  | 'vazio'
  /** uma cena passa de `MAX_TEXTO_CENA` (não subiria para a nuvem) */
  | 'cena-grande';

export type ResultadoImportar =
  /** `historias`: os ids das histórias criadas; `ideias`: quantas ideias soltas entraram. */
  { ok: true; historias: string[]; ideias: number } | { ok: false; erro: ErroImportar; app?: string };

type Bruto = Record<string, unknown>;

const objeto = (v: unknown): v is Bruto => !!v && typeof v === 'object' && !Array.isArray(v);
const normalizar = (texto: string): string => texto.replace(/^﻿/, '').replace(/\r\n?/g, '\n');
const desproteger = (texto: string): string => texto.replace(/^\\(\\*#)/gm, '$1');
const ordemNatural = (a: string, b: string): number => a.localeCompare(b, 'en', { numeric: true, sensitivity: 'base' }) || (a < b ? -1 : a > b ? 1 : 0);

/** As linhas de um texto (sem a linha vazia que sobra depois da última quebra). */
function linhasDe(texto: string): string[] {
  const l = texto.split('\n');
  if (l.at(-1) === '') l.pop();
  return l;
}

/** O título que um nome de arquivo ou pasta dá: sem a extensão e sem o número da frente. */
export function tituloDoNome(nome: string): string {
  const base = (nome.split('/').pop() ?? '').replace(/\.(md|markdown|txt)$/i, '');
  return base.replace(/^\d+(\s*-\s*|\s*$)/, '').trim();
}

/** Separa o cabeçalho `---` do resto. */
export function lerCabecalho(md: string): { campos: Bruto; resto: string } {
  if (!md.startsWith('---\n')) return { campos: {}, resto: md };
  const fim = md.indexOf('\n---\n', 3);
  if (fim < 0) return { campos: {}, resto: md };
  const campos: Bruto = {};
  for (const linha of md.slice(4, fim).split('\n')) {
    const i = linha.indexOf(':');
    if (i <= 0) continue;
    const valor = linha.slice(i + 1).trim();
    try {
      campos[linha.slice(0, i).trim()] = JSON.parse(valor) as unknown;
    } catch {
      campos[linha.slice(0, i).trim()] = valor;
    }
  }
  return { campos, resto: md.slice(fim + 5).replace(/^\n/, '') };
}

const COMENTARIO = /^<!-- (\{.*\}) -->$/;

function lerComentario(linha: string): Bruto | null {
  const m = COMENTARIO.exec(linha);
  if (!m) return null;
  try {
    const o = JSON.parse(m[1]!) as unknown;
    return objeto(o) ? o : null;
  } catch {
    return null;
  }
}

/** O texto de um bloco. No nosso formato tira só a linha vazia de cada ponta; no dos outros, todas. */
function corpo(linhas: readonly string[], nosso: boolean): string {
  const l = [...linhas];
  if (nosso) {
    if (l[0] === '') l.shift();
    if (l.at(-1) === '') l.pop();
    return desproteger(l.join('\n'));
  }
  while (l.length && l[0]!.trim() === '') l.shift();
  while (l.length && l.at(-1)!.trim() === '') l.pop();
  return l.join('\n');
}

/** Um arquivo de um registro só: `# Título` na primeira linha (ou o nome do arquivo) e o resto. */
function lerTituloECorpo(md: string, nome: string): { campos: Bruto; titulo: string; corpo: string } {
  const { campos, resto } = lerCabecalho(normalizar(md));
  const l = linhasDe(resto);
  const m = /^#(?: +(.*))?$/.exec(l[0] ?? '');
  if (!m) return { campos, titulo: tituloDoNome(nome), corpo: l.join('\n') };
  l.shift();
  if (l[0] === '') l.shift();
  return { campos, titulo: (m[1] ?? '').trim(), corpo: l.join('\n') };
}

/** Um arquivo de cena (da pasta exportada, ou um `.md` qualquer). */
export function lerCenaMd(md: string, nome = ''): Bruto {
  const { campos, titulo, corpo: texto } = lerTituloECorpo(md, nome);
  return { ...campos, titulo, texto };
}

/** Os blocos `## Título` de `ideias.md` e `personagens.md`. */
function lerBlocos(md: string): { titulo: string; dados: Bruto; texto: string }[] {
  const saida: { titulo: string; dados: Bruto; linhas: string[]; esperaDados: boolean }[] = [];
  for (const linha of linhasDe(normalizar(md))) {
    const m = /^##(?!#)(?: +(.*))?$/.exec(linha);
    if (m) {
      saida.push({ titulo: (m[1] ?? '').trim(), dados: {}, linhas: [], esperaDados: true });
      continue;
    }
    const bloco = saida.at(-1);
    if (!bloco) continue;
    const dados = bloco.esperaDados ? lerComentario(linha) : null;
    bloco.esperaDados = false;
    if (dados) bloco.dados = dados;
    else bloco.linhas.push(linha);
  }
  return saida.map((b) => ({ titulo: b.titulo, dados: b.dados, texto: corpo(b.linhas, true) }));
}

/** As ideias de um `ideias.md`. */
export function lerIdeiasMd(md: string): Bruto[] {
  return lerBlocos(md).map((b) => ({ ...b.dados, titulo: b.titulo, texto: b.texto }));
}

function lerPersonagensMd(md: string): Bruto[] {
  return lerBlocos(md).map((b) => ({ ...b.dados, nome: b.titulo, notas: b.texto }));
}

/** Uma história num arquivo `.md` só. `nome` (do arquivo) vira o título se não houver `# Título`. */
export function lerHistoriaMd(md: string, nome = ''): HistoriaImportada {
  const { campos, resto } = lerCabecalho(normalizar(md));
  const nosso = campos[MARCA_MD] === 1;
  delete campos[MARCA_MD];
  const h: HistoriaImportada = { campos: { ...campos }, soltas: [], capitulos: [], personagens: [], ideias: [] };
  let temTitulo = false;
  let capitulo: HistoriaImportada['capitulos'][number] | null = null;
  let cena: { campos: Bruto; linhas: string[] } | null = null;
  let esperaDados: Bruto | null = null;
  const fecharCena = (): void => {
    if (!cena) return;
    const texto = corpo(cena.linhas, nosso);
    // texto antes da primeira cena vira uma cena sem título; se for só espaço, não vira nada
    if (cena.campos['titulo'] !== undefined || texto.trim() !== '') (capitulo ? capitulo.cenas : h.soltas).push({ titulo: '', ...cena.campos, texto });
    cena = null;
  };
  for (const linha of linhasDe(resto)) {
    const m = /^(#{1,3})(?: +(.*))?$/.exec(linha);
    // um `#` sozinho num arquivo de fora é a marca de troca de cena dos manuscritos, não um título
    if (m && (nosso || m[2] !== undefined)) {
      const titulo = (m[2] ?? '').trim();
      const nivel = m[1]!.length === 1 && temTitulo ? 2 : m[1]!.length;
      fecharCena();
      if (nivel === 1) {
        h.campos['titulo'] = titulo;
        temTitulo = true;
        esperaDados = null;
      } else if (nivel === 2) {
        capitulo = { campos: { titulo }, cenas: [] };
        h.capitulos.push(capitulo);
        esperaDados = capitulo.campos;
      } else {
        cena = { campos: { titulo }, linhas: [] };
        esperaDados = cena.campos;
      }
      continue;
    }
    if (esperaDados) {
      const dados = lerComentario(linha);
      const destino: Bruto = esperaDados;
      esperaDados = null;
      if (dados) {
        const titulo = destino['titulo'];
        Object.assign(destino, dados, { titulo });
        continue;
      }
    }
    if (!cena) {
      if (linha.trim() === '') continue;
      cena = { campos: {}, linhas: [] };
    }
    cena.linhas.push(linha);
  }
  fecharCena();
  if (!temTitulo && h.campos['titulo'] === undefined) h.campos['titulo'] = tituloDoNome(nome);
  return h;
}

/** Uma pasta exportada (caminho → texto): as histórias que há nela e as ideias soltas. */
export function lerPasta(arquivos: Readonly<Record<string, string>>): { historias: HistoriaImportada[]; ideias: Bruto[] } {
  const entradas = Object.entries(arquivos)
    .map(([caminho, texto]) => [caminho.replace(/\\/g, '/').replace(/^\/+/, ''), texto] as const)
    .filter(([caminho]) => /\.(md|markdown)$/i.test(caminho) && !caminho.split('/').some((p) => p.startsWith('.') || p === '__MACOSX'))
    .sort((a, b) => ordemNatural(a[0], b[0]));

  type Pasta = { arquivos: (readonly [string, string])[]; pastas: Map<string, (readonly [string, string])[]> };
  const abrir = (lista: readonly (readonly [string, string])[]): Pasta => {
    const p: Pasta = { arquivos: [], pastas: new Map() };
    for (const [caminho, texto] of lista) {
      const i = caminho.indexOf('/');
      if (i < 0) p.arquivos.push([caminho, texto]);
      else {
        const nome = caminho.slice(0, i);
        p.pastas.set(nome, [...(p.pastas.get(nome) ?? []), [caminho.slice(i + 1), texto]]);
      }
    }
    return p;
  };
  const acha = (p: Pasta, nome: string): string | undefined => p.arquivos.find(([n]) => n.toLowerCase() === nome)?.[1];
  const ESPECIAIS = ['historia.md', 'personagens.md', 'ideias.md', 'capitulo.md'];
  const cenasDe = (lista: readonly (readonly [string, string])[]): Bruto[] => lista.filter(([n]) => !ESPECIAIS.includes((n.split('/').pop() ?? '').toLowerCase())).map(([n, t]) => lerCenaMd(t, n));

  const historia = (p: Pasta, nome: string): HistoriaImportada => {
    const ficha = acha(p, 'historia.md');
    const lida = ficha === undefined ? null : lerTituloECorpo(ficha, nome);
    const h: HistoriaImportada = {
      campos: lida ? { ...lida.campos, titulo: lida.titulo, sinopse: lida.corpo } : { titulo: tituloDoNome(nome) },
      soltas: cenasDe(p.arquivos),
      capitulos: [],
      personagens: lerPersonagensMd(acha(p, 'personagens.md') ?? ''),
      ideias: lerIdeiasMd(acha(p, 'ideias.md') ?? ''),
    };
    for (const [dir, lista] of p.pastas) {
      const ficha = lista.find(([n]) => n.toLowerCase() === 'capitulo.md')?.[1];
      const lido = ficha === undefined ? null : lerTituloECorpo(ficha, dir);
      h.capitulos.push({ campos: lido ? { titulo: lido.titulo, resumo: lido.corpo } : { titulo: tituloDoNome(dir) }, cenas: cenasDe(lista) });
    }
    return h;
  };

  let raiz = abrir(entradas);
  let nome = '';
  for (;;) {
    if (acha(raiz, 'historia.md') !== undefined) return { historias: [historia(raiz, nome)], ideias: [] };
    const comFicha = [...raiz.pastas].filter(([, lista]) => lista.some(([n]) => n.toLowerCase() === 'historia.md'));
    if (comFicha.length) return { historias: comFicha.map(([dir, lista]) => historia(abrir(lista), dir)), ideias: lerIdeiasMd(acha(raiz, 'ideias.md') ?? '') };
    // uma pasta só, sem nada ao lado: é só o embrulho; olha dentro
    const unica = raiz.pastas.size === 1 && raiz.arquivos.length === 0 ? [...raiz.pastas][0] : undefined;
    if (!unica) break;
    nome = unica[0];
    raiz = abrir(unica[1]);
  }
  if (!raiz.arquivos.length && !raiz.pastas.size) return { historias: [], ideias: [] };
  // só ideias.md: são ideias soltas, não uma história
  if (raiz.pastas.size === 0 && raiz.arquivos.length === 1 && raiz.arquivos[0]![0].toLowerCase() === 'ideias.md') return { historias: [], ideias: lerIdeiasMd(raiz.arquivos[0]![1]) };
  return { historias: [historia(raiz, nome)], ideias: [] };
}

async function gravar(escrita: Escrita, historias: readonly HistoriaImportada[], ideias: readonly Bruto[]): Promise<ResultadoImportar> {
  if (!historias.length && !ideias.length) return { ok: false, erro: 'vazio' };
  const cenas = historias.flatMap((h) => [...h.soltas, ...h.capitulos.flatMap((c) => c.cenas)]);
  if (cenas.some((c) => typeof c['texto'] === 'string' && bytesUtf8(c['texto']) > MAX_TEXTO_CENA)) return { ok: false, erro: 'cena-grande' };
  const ids: string[] = [];
  for (const h of historias) ids.push(await escrita.importar(h));
  return { ok: true, historias: ids, ideias: ideias.length ? await escrita.importarIdeias(ideias) : 0 };
}

/** Importa uma história de um `.md` único. */
export function importarMd(escrita: Escrita, md: string, nome = ''): Promise<ResultadoImportar> {
  if (md.trim() === '') return Promise.resolve({ ok: false, erro: 'vazio' });
  return gravar(escrita, [lerHistoriaMd(md, nome)], []);
}

/** Importa ideias soltas de um `ideias.md`. */
export function importarIdeiasMd(escrita: Escrita, md: string): Promise<ResultadoImportar> {
  return gravar(escrita, [], lerIdeiasMd(md));
}

/** Importa um .zip de Markdown (uma história por pasta, como `exportarHistoriaZip` e `exportarTudoZip` gravam). */
export function importarZip(escrita: Escrita, bytes: Uint8Array): Promise<ResultadoImportar> {
  const ehMd = (nome: string): boolean => /\.(md|markdown)$/i.test(nome);
  let entradas: Record<string, Uint8Array>;
  try {
    if (zipGrandeDemais(bytes, ehMd)) return Promise.resolve({ ok: false, erro: 'grande' });
    entradas = unzipSync(bytes, { filter: (f) => ehMd(f.name) });
  } catch {
    return Promise.resolve({ ok: false, erro: 'nao-e-ekfr' });
  }
  const textos: Record<string, string> = {};
  for (const [caminho, dados] of Object.entries(entradas)) textos[caminho] = strFromU8(dados);
  const { historias, ideias } = lerPasta(textos);
  return gravar(escrita, historias, ideias);
}

function historiaDoArquivo(o: unknown): HistoriaImportada | null {
  if (!objeto(o) || !objeto(o['campos'])) return null;
  const lista = (v: unknown): Bruto[] | null => (v === undefined ? [] : Array.isArray(v) && v.every(objeto) ? (v as Bruto[]) : null);
  const soltas = lista(o['soltas']);
  const personagens = lista(o['personagens']);
  const ideias = lista(o['ideias']);
  const brutos = lista(o['capitulos']);
  if (!soltas || !personagens || !ideias || !brutos) return null;
  const capitulos: HistoriaImportada['capitulos'] = [];
  for (const c of brutos) {
    const cenas = lista(c['cenas']);
    if (!objeto(c['campos']) || !cenas) return null;
    capitulos.push({ campos: c['campos'], cenas });
  }
  return { campos: o['campos'], soltas, capitulos, personagens, ideias };
}

/** Importa um `.ekfr` do Writer (tipo `historia` ou `ideias`). De outro app: diz de qual. */
export async function importarEkfr(escrita: Escrita, bytes: Uint8Array): Promise<ResultadoImportar> {
  const id = identificar(bytes);
  if (!id.ok) return { ok: false, erro: id.erro };
  const v = podeAbrir(APP, id.envelope);
  if (!v.abre) return v.motivo === 'outro-app' ? { ok: false, erro: 'outro-app', app: v.app.id } : { ok: false, erro: v.motivo };
  let arquivos: Readonly<Record<string, Uint8Array>>;
  try {
    if (zipGrandeDemais(bytes)) return { ok: false, erro: 'grande' };
    arquivos = lerEkfr(bytes).arquivos;
  } catch (e) {
    return { ok: false, erro: e instanceof ErroArquivo ? e.codigo : 'nao-e-ekfr' };
  }
  const ler = (nome: string): unknown => {
    try {
      return JSON.parse(strFromU8(arquivos[nome] ?? new Uint8Array())) as unknown;
    } catch {
      return null;
    }
  };
  if (id.envelope.tipo === TIPO_HISTORIA) {
    const h = historiaDoArquivo(ler('historia.json'));
    return h ? gravar(escrita, [h], []) : { ok: false, erro: 'conteudo-invalido' };
  }
  if (id.envelope.tipo === TIPO_IDEIAS) {
    const o = ler('ideias.json');
    const ideias = objeto(o) ? o['ideias'] : null;
    if (!Array.isArray(ideias) || !ideias.every(objeto)) return { ok: false, erro: 'conteudo-invalido' };
    return gravar(escrita, [], ideias as Bruto[]);
  }
  return { ok: false, erro: 'tipo-desconhecido' };
}

/** Importa qualquer arquivo que o Writer aceita, olhando o conteúdo: `.ekfr`, `.zip` de Markdown ou `.md`. */
export async function importarArquivo(escrita: Escrita, nome: string, bytes: Uint8Array): Promise<ResultadoImportar> {
  const ehZip = bytes[0] === 0x50 && bytes[1] === 0x4b;
  if (ehZip) {
    const id = identificar(bytes);
    if (id.ok) return importarEkfr(escrita, bytes);
    return id.erro === 'sem-envelope' ? importarZip(escrita, bytes) : { ok: false, erro: id.erro };
  }
  if (/\.ekfr(ase)?$/i.test(nome)) return { ok: false, erro: 'nao-e-ekfr' };
  const md = strFromU8(bytes);
  return (nome.split(/[\\/]/).pop() ?? '').toLowerCase() === 'ideias.md' ? importarIdeiasMd(escrita, md) : importarMd(escrita, md, nome);
}
