// SPDX-License-Identifier: MPL-2.0
/**
 * Monta o ACERVO da Biblioteca do Ekfrase (DEC-P049) a partir da pasta `biblioteca/`:
 * cada pasta com um .epub é um livro (pode ficar dentro da pasta do autor: `ARISTÓTELES/Poética`),
 * com a ficha `livro.json` e os arquivos (.epub, .txt, .docx, .pdf). A Administração da Biblioteca
 * (`apps/biblioteca-admin`) usa as mesmas funções daqui.
 *
 *   node scripts/biblioteca.ts          → gera apps/biblioteca/public/acervo/ (o build e o `dev` já rodam)
 *   node scripts/biblioteca.ts --pdf    → (Windows, com o Word) gera o .pdf de cada livro a partir do
 *                                         .docx, na própria pasta do livro (o PDF vai para o Git)
 *
 * Saída (fora do Git): `catalogo.json` (a lista para as estantes, a busca e a bibliotecária) e, por
 * livro, `<id>/livro.json` (ficha + sumário) e `<id>/NN.json` (um capítulo: título e HTML já limpo),
 * mais os arquivos para baixar com nomes simples (`<id>.epub`…). O HTML do EPUB passa por uma lista
 * FECHADA de marcas, classes e atributos: nada de script, estilo solto ou link para fora.
 */
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inflateRawSync } from 'node:zlib';
import { CDD_VALIDO, FORMATOS, SIMBOLOS_CAPA } from '../packages/interface/src/acervo.ts';
import { RAIZ } from './raiz.ts';

const ORIGEM = join(RAIZ, 'biblioteca');
const SAIDA = join(RAIZ, 'apps', 'biblioteca', 'public', 'acervo');
export const ORIGEM_ACERVO = ORIGEM;
export const SIMBOLOS = SIMBOLOS_CAPA;
export { FORMATOS };
export type Formato = (typeof FORMATOS)[number];

export interface Ficha {
  id: string;
  titulo: string;
  subtitulo?: string;
  autor: string;
  ano?: number;
  titulo_original?: string;
  traducao: string;
  editora?: string;
  ano_traducao?: number;
  idioma: string;
  idioma_original?: string;
  /** O número na Classificação Decimal de Dewey (DEC-P058), ex.: "808.2". */
  cdd: string;
  generos: string[];
  licenca: string;
  descricao: string;
  capa: { fundo: string; detalhe: string; simbolo: string };
}

// ---------- zip (só ler: o EPUB é um zip) ----------

/** Os arquivos de um zip: nome → conteúdo. Lê o diretório central (guardado ou deflate). */
export function lerZip(buf: Buffer): Map<string, Buffer> {
  let fim = buf.length - 22;
  while (fim >= 0 && buf.readUInt32LE(fim) !== 0x06054b50) fim--;
  if (fim < 0) throw new Error('não é um zip');
  const total = buf.readUInt16LE(fim + 10);
  let p = buf.readUInt32LE(fim + 16);
  const out = new Map<string, Buffer>();
  for (let i = 0; i < total; i++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error('zip estragado');
    const metodo = buf.readUInt16LE(p + 10);
    const tam = buf.readUInt32LE(p + 20);
    const nl = buf.readUInt16LE(p + 28);
    const el = buf.readUInt16LE(p + 30);
    const cl = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const nome = buf.subarray(p + 46, p + 46 + nl).toString('utf8');
    const ini = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    const dados = buf.subarray(ini, ini + tam);
    out.set(nome, metodo === 0 ? Buffer.from(dados) : inflateRawSync(dados));
    p += 46 + nl + el + cl;
  }
  return out;
}

// ---------- HTML limpo ----------

const MARCAS = new Set([
  'p', 'div', 'h1', 'h2', 'h3', 'h4', 'em', 'i', 'strong', 'b', 'sup', 'sub', 'a', 'hr', 'blockquote', 'br', 'span', 'ol', 'ul', 'li', 'small',
  'table', 'thead', 'tbody', 'tr', 'th', 'td',
]);
const SEM_CONTEUDO = new Set(['script', 'style', 'svg', 'head', 'title', 'img', 'image', 'object', 'iframe', 'math']);
const VAZIAS = new Set(['hr', 'br']);
const CLASSES = new Set([
  'prose', 'prose-first', 'prose-indent', 'quote-verse', 'sec-title', 'stanza', 'stanza-leland', 'stanza-v1', 'stanza-v2', 'stanza-it',
  'fn-ref', 'poem-card', 'poem-banner', 'notes-box', 'layer-heading', 'lh-v1', 'lh-v2', 'lh-notes', 'lh-leland', 'lh-it', 'ornament',
  'ch-title', 'ch-num', 'ch-sub', 'fn-sep', 'footnotes', 'epigraph', 'epi-attr', 'title-page',
  // versões lado a lado (a Poética): a tabela de duas colunas e o aparato crítico
  'parallel-table', 'col-left', 'col-right', 'apparatus-box',
]);

const decodificar = (s: string) => s.replace(/&#x([0-9a-f]+);/gi, (_, h: string) => String.fromCodePoint(parseInt(h, 16))).replace(/&#(\d+);/g, (_, d: string) => String.fromCodePoint(Number(d)));

/** O miolo (<body>) de um capítulo, só com o que o leitor sabe mostrar. */
export function limparHtml(xhtml: string): string {
  const corpo = /<body[^>]*>([\s\S]*)<\/body>/i.exec(xhtml)?.[1] ?? '';
  let out = '';
  let pulando = 0;
  const pilha: string[] = [];
  const re = /<!--[\s\S]*?-->|<(\/?)([a-zA-Z][\w:-]*)([^>]*?)(\/?)>|([^<]+)/g;
  for (let m = re.exec(corpo); m; m = re.exec(corpo)) {
    const [, fecha, nomeBruto, attrs = '', auto, texto] = m;
    if (texto !== undefined) {
      if (!pulando) out += decodificar(texto).replace(/&(?!(amp|lt|gt|quot|#\d+|#x[0-9a-f]+);)/gi, '&amp;').replace(/</g, '&lt;');
      continue;
    }
    if (!nomeBruto) continue;
    const nome = nomeBruto.toLowerCase().replace(/^.*:/, '');
    if (SEM_CONTEUDO.has(nome)) {
      if (auto) continue;
      pulando += fecha ? -1 : 1;
      pulando = Math.max(0, pulando);
      continue;
    }
    if (pulando || !MARCAS.has(nome)) continue;
    if (fecha) {
      if (pilha.lastIndexOf(nome) >= 0) {
        while (pilha.length) {
          const t = pilha.pop()!;
          out += `</${t}>`;
          if (t === nome) break;
        }
      }
      continue;
    }
    const a: string[] = [];
    const cls = /\bclass\s*=\s*"([^"]*)"/.exec(attrs)?.[1]?.split(/\s+/).filter((c) => CLASSES.has(c)) ?? [];
    const estilo = /\bstyle\s*=\s*"([^"]*)"/.exec(attrs)?.[1] ?? '';
    if (/text-align\s*:\s*center/.test(estilo)) cls.push('centro');
    if (/font-style\s*:\s*italic/.test(estilo)) cls.push('italico');
    if (cls.length) a.push(`class="${cls.join(' ')}"`);
    const id = /\bid\s*=\s*"([A-Za-z][\w-]{0,60})"/.exec(attrs)?.[1];
    if (id) a.push(`id="${id}"`);
    if (nome === 'td' || nome === 'th') {
      const col = /\bcolspan\s*=\s*"([1-9])"/.exec(attrs)?.[1];
      if (col) a.push(`colspan="${col}"`);
    }
    const lang = /\b(?:xml:)?lang\s*=\s*"([a-zA-Z]{2,3}(?:-[a-zA-Z]{2,4})?)"/.exec(attrs)?.[1];
    if (lang) a.push(`lang="${lang}"`);
    if (nome === 'a') {
      const href = /\bhref\s*=\s*"([^"]*)"/.exec(attrs)?.[1] ?? '';
      const ancora = /#([A-Za-z][\w-]{0,60})$/.exec(href)?.[1];
      if (ancora) a.push(`href="#${ancora}"`);
    }
    out += `<${nome}${a.length ? ' ' + a.join(' ') : ''}>`;
    if (VAZIAS.has(nome)) continue;
    if (auto) out += `</${nome}>`;
    else pilha.push(nome);
  }
  while (pilha.length) out += `</${pilha.pop()}>`;
  return out.replace(/\n{3,}/g, '\n\n').trim();
}

const semMarcas = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/&[a-z#0-9]+;/gi, ' ');

// ---------- o EPUB ----------

/** O que o próprio EPUB diz de si (para preencher a ficha de um livro novo). */
export interface Metadados {
  titulo: string;
  autor: string;
  idioma: string;
  descricao: string;
  editora: string;
  licenca: string;
}

export function metadadosEpub(buf: Buffer): Metadados {
  const zip = lerZip(buf);
  const opfCaminho = /full-path="([^"]+)"/.exec(zip.get('META-INF/container.xml')?.toString('utf8') ?? '')?.[1] ?? '';
  const opf = zip.get(opfCaminho)?.toString('utf8') ?? '';
  const dc = (n: string) => {
    const bruto = opf.split(`<dc:${n}`)[1]?.split(`</dc:${n}>`)[0]?.replace(/^[^>]*>/, '') ?? '';
    return decodificar(semMarcas(bruto)).replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
  };
  const direitos = dc('rights');
  return {
    titulo: dc('title'),
    autor: dc('creator'),
    idioma: dc('language') || 'pt-BR',
    descricao: dc('description'),
    editora: dc('publisher'),
    licenca: /CC BY-SA 4\.0/i.test(direitos) ? 'CC BY-SA 4.0' : (direitos.split(' — ')[0] ?? ''),
  };
}

interface Capitulo {
  titulo: string;
  html: string;
}

export function lerEpub(buf: Buffer): Capitulo[] {
  const zip = lerZip(buf);
  const txt = (n: string) => zip.get(n)?.toString('utf8') ?? '';
  const opfCaminho = /full-path="([^"]+)"/.exec(txt('META-INF/container.xml'))?.[1] ?? '';
  const opf = txt(opfCaminho);
  const pasta = opfCaminho.includes('/') ? opfCaminho.slice(0, opfCaminho.lastIndexOf('/') + 1) : '';
  const itens = new Map<string, string>();
  for (const m of opf.matchAll(/<item\b[^>]*>/g)) {
    const id = /\bid="([^"]+)"/.exec(m[0])?.[1];
    const href = /\bhref="([^"]+)"/.exec(m[0])?.[1];
    if (id && href) itens.set(id, href);
  }
  // títulos do sumário (nav.xhtml), por arquivo
  const navHref = [...opf.matchAll(/<item\b[^>]*properties="nav"[^>]*>/g)].map((m) => /\bhref="([^"]+)"/.exec(m[0])?.[1])[0];
  const titulos = new Map<string, string>();
  if (navHref) {
    const nav = txt(pasta + navHref);
    for (const m of nav.matchAll(/<a[^>]*href="([^"#]+)[^"]*"[^>]*>([\s\S]*?)<\/a>/g)) titulos.set(basename(m[1]!), decodificar(semMarcas(m[2]!)).replace(/\s+/g, ' ').trim());
  }
  const caps: Capitulo[] = [];
  for (const m of opf.matchAll(/<itemref\b[^>]*idref="([^"]+)"/g)) {
    const href = itens.get(m[1]!);
    if (!href) continue;
    const html = limparHtml(txt(pasta + href));
    if (semMarcas(html).trim().length < 20) continue; // a capa (só imagem) fica de fora: a Biblioteca desenha a dela
    caps.push({ titulo: titulos.get(basename(href)) ?? `${caps.length + 1}`, html });
  }
  return caps;
}

// ---------- PDF pelo Word (só no computador do Alcy) ----------

/** Gera o PDF a partir do .docx pelo Word (só no Windows, com o Word instalado). */
export function gerarPdf(docx: string, pdf: string): boolean {
  const esc = (s: string) => s.replace(/'/g, "''");
  const ps = [
    "$ErrorActionPreference = 'Stop'",
    '$w = New-Object -ComObject Word.Application',
    '$w.Visible = $false',
    '$w.DisplayAlerts = 0',
    'try {',
    `  $d = $w.Documents.Open('${esc(docx)}', $false, $true)`,
    `  $d.SaveAs([ref] '${esc(pdf)}', [ref] 17)`,
    '  $d.Close([ref] 0)',
    '} finally { $w.Quit() }',
  ].join('\n');
  // O Word às vezes cai no meio (RPC indisponível) em livros grandes: tenta até 3 vezes.
  for (let tentativa = 1; tentativa <= 3; tentativa++) {
    const r = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps], { encoding: 'utf8' });
    if (r.status === 0 && existsSync(pdf)) return true;
    console.error(`PDF: tentativa ${tentativa} falhou${tentativa < 3 ? ', tentando de novo' : ''}`);
  }
  return false;
}

// ---------- montar ----------

/** Os problemas da ficha (vazio = tudo certo). */
export function problemasDaFicha(f: Partial<Ficha>): string[] {
  const p: string[] = [];
  if (!f.id || !/^[a-z0-9][a-z0-9-]{0,79}$/.test(f.id)) p.push('id fora do formato (letras minúsculas, números e hífen)');
  if (!f.titulo || !f.autor || !f.traducao || !f.descricao || !f.licenca) p.push('faltam titulo, autor, traducao, descricao ou licenca');
  if (typeof f.cdd !== 'string' || !CDD_VALIDO.test(f.cdd)) p.push('cdd: o número da Classificação Decimal de Dewey (três algarismos e, se houver, o ponto: 808.2)');
  if (!Array.isArray(f.generos) || f.generos.some((g) => !/^[a-z0-9-]+$/.test(g))) p.push('generos: lista de ids (minúsculas e hífen)');
  if (!f.capa || !SIMBOLOS.includes(f.capa.simbolo) || !/^#[0-9a-f]{6}$/i.test(f.capa.fundo) || !/^#[0-9a-f]{6}$/i.test(f.capa.detalhe)) {
    p.push(`capa: fundo e detalhe em #rrggbb; simbolo: ${SIMBOLOS.join(', ')}`);
  }
  return p;
}

function conferirFicha(f: Ficha, pasta: string): void {
  const p = problemasDaFicha(f);
  if (p.length) throw new Error(`biblioteca/${pasta}/livro.json: ${p.join('; ')}`);
}

/**
 * As pastas de livros (caminho relativo a `biblioteca/`, com "/"): toda pasta que tem um .epub ou
 * um livro.json. Pasta sem nenhum dos dois (a do autor) é procurada por dentro.
 */
export function pastasDeLivros(origem = ORIGEM): string[] {
  const out: string[] = [];
  const andar = (rel: string) => {
    const dir = join(origem, rel);
    const nomes = readdirSync(dir);
    if (rel && nomes.some((n) => n === 'livro.json' || n.toLowerCase().endsWith('.epub'))) {
      out.push(rel);
      return;
    }
    for (const n of nomes.sort()) if (!n.startsWith('.') && statSync(join(dir, n)).isDirectory()) andar(rel ? `${rel}/${n}` : n);
  };
  if (existsSync(origem)) andar('');
  return out;
}

/** O arquivo de cada formato numa pasta de livro (o primeiro com a extensão). */
export function arquivosDoLivro(dir: string): Partial<Record<Formato, string>> {
  const nomes = readdirSync(dir);
  const out: Partial<Record<Formato, string>> = {};
  for (const f of FORMATOS) {
    const n = nomes.find((x) => x.toLowerCase().endsWith(`.${f}`));
    if (n) out[f] = n;
  }
  return out;
}

export function montar(opcoes: { pdf?: boolean } = {}): { livros: number } {
  rmSync(SAIDA, { recursive: true, force: true });
  mkdirSync(SAIDA, { recursive: true });
  const catalogo: object[] = [];
  const ids = new Set<string>();
  for (const pasta of pastasDeLivros()) {
    const dir = join(ORIGEM, pasta);
    if (!existsSync(join(dir, 'livro.json'))) {
      console.warn(`biblioteca/${pasta}: sem livro.json (pulado)`);
      continue;
    }
    const ficha = JSON.parse(readFileSync(join(dir, 'livro.json'), 'utf8')) as Ficha & { comentario?: string };
    delete ficha.comentario;
    conferirFicha(ficha, pasta);
    if (ids.has(ficha.id)) throw new Error(`biblioteca/${pasta}/livro.json: o id "${ficha.id}" já é de outro livro`);
    ids.add(ficha.id);
    const achar = (ext: string) => readdirSync(dir).find((n) => n.toLowerCase().endsWith(ext));
    const epub = achar('.epub');
    if (!epub) throw new Error(`biblioteca/${pasta}: falta o .epub`);
    const docx = achar('.docx');
    let pdf = achar('.pdf');
    if (opcoes.pdf && docx && !pdf) {
      const destino = join(dir, docx.replace(/\.docx$/i, '.pdf'));
      console.log(`PDF de ${docx}…`);
      if (gerarPdf(join(dir, docx), destino)) pdf = basename(destino);
    }
    const caps = lerEpub(readFileSync(join(dir, epub)));
    const saida = join(SAIDA, ficha.id);
    mkdirSync(saida, { recursive: true });
    let palavras = 0;
    caps.forEach((c, i) => {
      palavras += semMarcas(c.html).split(/\s+/).filter(Boolean).length;
      writeFileSync(join(saida, `${String(i + 1).padStart(2, '0')}.json`), JSON.stringify(c));
    });
    const arquivos: Record<string, string> = {};
    for (const [ext, nome] of [['epub', epub], ['txt', achar('.txt')], ['docx', docx], ['pdf', pdf]] as const) {
      if (!nome) continue;
      copyFileSync(join(dir, nome), join(saida, `${ficha.id}.${ext}`));
      arquivos[ext] = `${ficha.id}/${ficha.id}.${ext}`;
    }
    const entrada = { ...ficha, arquivos, capitulos: caps.length, palavras };
    writeFileSync(join(saida, 'livro.json'), JSON.stringify({ ...entrada, sumario: caps.map((c) => c.titulo) }));
    catalogo.push(entrada);
  }
  writeFileSync(join(SAIDA, 'catalogo.json'), JSON.stringify({ livros: catalogo }));
  return { livros: catalogo.length };
}

// rodado direto (não importado por um teste)
if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const r = montar({ pdf: process.argv.includes('--pdf') });
  console.log(`acervo: ${r.livros} livro(s) em apps/biblioteca/public/acervo/`);
}
