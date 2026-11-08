// SPDX-License-Identifier: MPL-2.0

/**
 * O acervo da Biblioteca do Ekfrase (DEC-P049), comum ao app da Biblioteca e ao castelo (as
 * estantes e a bibliotecária do modo jogo): o catálogo gerado por `scripts/biblioteca.ts`
 * (`/biblioteca/acervo/catalogo.json`), a busca (sem acento, sem maiúscula) e a capa de cada
 * livro, desenhada por código (DEC-P007): tecido, moldura dourada, o símbolo e o título.
 */

export const CATEGORIAS = ['literatura', 'poesia', 'filosofia', 'religiao', 'historia', 'ciencias'] as const;
export type Categoria = (typeof CATEGORIAS)[number];

export interface Livro {
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
  categoria: Categoria;
  generos: string[];
  licenca: string;
  descricao: string;
  capa: { fundo: string; detalhe: string; simbolo: string };
  /** Caminhos dentro de /biblioteca/acervo/ (epub, txt, docx, pdf). */
  arquivos: Partial<Record<'epub' | 'txt' | 'docx' | 'pdf', string>>;
  capitulos: number;
  palavras: number;
}

/** Onde o acervo mora no site (a Biblioteca e o castelo são do mesmo endereço). */
export const ACERVO = '/biblioteca/acervo/';

let catalogo: Promise<Livro[]> | null = null;

export function carregarCatalogo(): Promise<Livro[]> {
  catalogo ??= fetch(`${ACERVO}catalogo.json`)
    .then((r) => (r.ok ? (r.json() as Promise<{ livros: Livro[] }>) : { livros: [] }))
    .then((c) => c.livros)
    .catch(() => {
      catalogo = null;
      return [];
    });
  return catalogo;
}

/** Texto para comparar: sem acento, minúsculo, espaços simples. */
export function normalizar(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Busca no acervo por título, autor, título original, gêneros e descrição (`nomeGenero` dá o nome
 * do gênero no idioma de quem busca). Todas as palavras precisam aparecer; o título pesa mais.
 */
export function buscar(livros: readonly Livro[], termo: string, nomeGenero: (id: string) => string = (g) => g): Livro[] {
  const palavras = normalizar(termo).split(' ').filter(Boolean);
  if (!palavras.length) return [...livros];
  const pontos = (l: Livro) => {
    const titulo = normalizar(`${l.titulo} ${l.subtitulo ?? ''} ${l.titulo_original ?? ''}`);
    const resto = normalizar(`${l.autor} ${l.generos.map(nomeGenero).join(' ')} ${l.generos.join(' ')} ${l.descricao}`);
    let p = 0;
    for (const w of palavras) {
      if (titulo.includes(w)) p += 3;
      else if (resto.includes(w)) p += 1;
      else return 0;
    }
    return p;
  };
  return livros
    .map((l) => [l, pontos(l)] as const)
    .filter(([, p]) => p > 0)
    .sort((a, b) => b[1] - a[1])
    .map(([l]) => l);
}

// ---------- a capa, desenhada por código ----------

type Rgb = [number, number, number];
const rgb = (h: string): Rgb => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
const luz = (c: Rgb, f: number): Rgb => c.map((v) => Math.round(f >= 0 ? v + (255 - v) * f : v * (1 + f))) as Rgb;
const css = (c: Rgb) => `rgb(${c[0]},${c[1]},${c[2]})`;

/** O símbolo da capa, em pixels (grade 15×15): 1 = cor, 2 = sombra. */
const SIMBOLOS: Readonly<Record<string, readonly string[]>> = {
  lua: ['.....1111......', '...111.........', '..111..........', '.111...........', '.11............', '111............', '111............', '111............', '111............', '1111...........', '.1111.......1..', '.111111...111..', '..11111111111..', '....1111111....', '...............'],
  sol: ['.......1.......', '..1....1....1..', '...1.......1...', '.....11111.....', '....1111111....', '...111111111...', '11.111111111.11', '...111111111...', '...111111111...', '....1111111....', '.....11111.....', '...1.......1...', '..1....1....1..', '.......1.......', '...............'],
  estrela: ['.......1.......', '.......1.......', '......111......', '......111......', '111111111111111', '.1111111111111.', '...111111111...', '....1111111....', '....111.111....', '...111...111...', '...11.....11...', '..11.......11..', '...............', '...............', '...............'],
  folha: ['..........1111.', '.......1111111.', '.....111111111.', '....1111111111.', '...11111111.11.', '..1111111.111..', '..111111.1111..', '.111111.11111..', '.11111.11111...', '.1111.1111.....', '.111.111.......', '..1.1..........', '.1.............', '1..............', '...............'],
  pena: ['............111', '..........11111', '........1111111', '.......1111111.', '.....111111.1..', '....11111.11...', '...1111.111....', '...111.11......', '..111.1........', '..11.1.........', '..1.1..........', '.1.1...........', '.11............', '1..............', '...............'],
  olho: ['...............', '...............', '.....11111.....', '...111...111...', '..11..111..11..', '.11..11111..11.', '11..1111111..11', '.11..11111..11.', '..11..111..11..', '...111...111...', '.....11111.....', '...............', '...............', '...............', '...............'],
  chave: ['...111.........', '..11.11........', '..1...1........', '..11.11........', '...111.........', '....1..........', '....1..........', '....1..........', '....111........', '....1..........', '....11.........', '....1..........', '....111........', '...............', '...............'],
  coroa: ['...............', '1.....1.....1..', '11...111...11..', '111.11111.111..', '1111111111111..', '1111111111111..', '1111111111111..', '.11111111111...', '.11111111111...', '...............', '.11111111111...', '...............', '...............', '...............', '...............'],
};

/** Os símbolos que a capa sabe desenhar e os formatos para baixar (a Administração usa os dois). */
export const SIMBOLOS_CAPA = Object.keys(SIMBOLOS);
export const FORMATOS = ['epub', 'pdf', 'docx', 'txt'] as const;

/**
 * Desenha a capa num canvas (`largura` em pixels de tela; a altura é 1,5 × a largura). Pixel art:
 * tecido com trama, lombada à esquerda, moldura dourada dupla, o símbolo e, embaixo, o título e o
 * autor em letra de verdade.
 */
export function desenharCapa(tela: HTMLCanvasElement, l: Pick<Livro, 'titulo' | 'autor' | 'capa'>, largura: number): void {
  const dpr = typeof devicePixelRatio === 'number' ? devicePixelRatio : 1;
  const W = 60;
  const H = 90;
  const px = Math.max(1, Math.round((largura * dpr) / W));
  tela.width = W * px;
  tela.height = H * px;
  tela.style.width = `${largura}px`;
  tela.style.height = `${Math.round(largura * 1.5)}px`;
  const c = tela.getContext('2d')!;
  c.imageSmoothingEnabled = false;
  const fundo = rgb(l.capa.fundo);
  const ouro = rgb(l.capa.detalhe);
  const p = (x: number, y: number, w: number, h: number, cor: Rgb) => {
    c.fillStyle = css(cor);
    c.fillRect(x * px, y * px, w * px, h * px);
  };
  // tecido: trama leve
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) p(x, y, 1, 1, luz(fundo, (x + y * 3) % 7 === 0 ? 0.06 : (x * 5 + y) % 11 === 0 ? -0.08 : 0));
  // lombada e a borda de baixo na sombra; luz em cima
  p(0, 0, 5, H, luz(fundo, -0.35));
  p(5, 0, 1, H, luz(fundo, 0.15));
  p(0, 0, W, 1, luz(fundo, 0.2));
  p(0, H - 2, W, 2, luz(fundo, -0.3));
  // moldura dourada dupla
  const moldura = (m: number, cor: Rgb) => {
    p(8 + m, 4 + m, W - 12 - m * 2, 1, cor);
    p(8 + m, H - 5 - m, W - 12 - m * 2, 1, cor);
    p(8 + m, 4 + m, 1, H - 8 - m * 2, cor);
    p(W - 5 - m, 4 + m, 1, H - 8 - m * 2, cor);
  };
  moldura(0, ouro);
  moldura(2, luz(ouro, -0.25));
  // o símbolo, no alto do meio
  const s = SIMBOLOS[l.capa.simbolo] ?? SIMBOLOS['estrela']!;
  const sx = Math.round((W + 3) / 2 - 7.5);
  s.forEach((linha, y) => [...linha].forEach((ch, x) => ch === '1' && p(sx + x, 16 + y, 1, 1, x < 7 ? ouro : luz(ouro, -0.18))));
  // o título e o autor (letra de verdade, na resolução da tela)
  const meio = ((W + 3) / 2) * px;
  c.fillStyle = css(ouro);
  c.textAlign = 'center';
  c.textBaseline = 'middle';
  const caber = (texto: string, tam: number, y: number, peso: string, max: number) => {
    let t = tam;
    c.font = `${peso} ${t}px 'Cormorant Garamond', Georgia, serif`;
    while (c.measureText(texto).width > max && t > 6) {
      t -= 1;
      c.font = `${peso} ${t}px 'Cormorant Garamond', Georgia, serif`;
    }
    c.fillText(texto, meio, y);
  };
  const max = (W - 20) * px;
  const palavras = l.titulo.split(' ');
  const linhas: string[] = [];
  for (const w of palavras) {
    const ult = linhas[linhas.length - 1];
    c.font = `700 ${9 * px}px 'Cormorant Garamond', Georgia, serif`;
    if (ult && c.measureText(`${ult} ${w}`).width <= max) linhas[linhas.length - 1] = `${ult} ${w}`;
    else linhas.push(w);
  }
  linhas.slice(0, 3).forEach((ln, i) => caber(ln, 9 * px, (48 + i * 9) * px, '700', max));
  p(22, 75, W - 41, 1, luz(ouro, -0.25));
  caber(l.autor, 5 * px, 80 * px, '600', max);
}
