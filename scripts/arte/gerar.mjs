// SPDX-License-Identifier: MPL-2.0
/**
 * Gera toda a arte da interface por código (DEC-P007) e grava os PNG:
 *   node scripts/arte/gerar.mjs
 *
 * - Ekfrase: o castelo de 5 torres (uma grande no centro, duas de cada lado),
 *   como o logo em aquarela, e um ícone simples com as mesmas 5 torres.
 * - Vernákula: o livro aberto em "V" com o castelo, o sol, o rio e o dragão,
 *   versão pixel art do logo do Vernákula.
 * - Maker: o mapa em pergaminho, enrolado dos dois lados, com a ilha (mata,
 *   serra nevada, rio), a rota tracejada até o X e a rosa dos ventos.
 * - Writer: a folha de papel marfim com o canto dobrado e a pena azul-noite.
 * - Cantoneiras de metal da "folha de papel" e o horizonte do fundo (máscaras).
 *
 * Luz vinda do alto à esquerda; contorno automático; fundo transparente.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Arte, mistura, ruido } from './pixel.mjs';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const NUCLEO = join(RAIZ, 'packages', 'nucleo', 'estilo', 'img');
const VK = join(RAIZ, 'apps', 'vernakula');
const MK = join(RAIZ, 'apps', 'maker');

function gravar(pasta, nome, dados) {
  mkdirSync(pasta, { recursive: true });
  writeFileSync(join(pasta, nome), dados);
  console.log(`  ${join(pasta, nome).slice(RAIZ.length + 1)}`);
}

/** Cone de telhado: metade da direita na sombra. */
function cone(arte, x0, x1, base, apice, claro, escuro) {
  const meio = (x0 + x1 + 1) / 2;
  arte.poligono(
    [
      [x0, base + 1],
      [x1 + 1, base + 1],
      [meio, apice],
    ],
    (x) => (x + 0.5 > meio ? escuro : claro),
  );
  return meio;
}

function bandeira(arte, xPoste, yTopo, cor, tinta) {
  for (let i = 0; i < 3; i++) arte.pinta(xPoste, yTopo - i, tinta);
  arte.ret(xPoste + 1, yTopo - 2, xPoste + 3, yTopo - 2, cor);
  arte.ret(xPoste + 1, yTopo - 1, xPoste + 2, yTopo - 1, cor);
}

// ---------------------------------------------------------------- Ekfrase
const E = {
  tinta: '#3b2416',
  janela: '#5a3a24',
  telha: '#c4592c',
  telhaS: '#8f3a1b',
  ardosia: '#4d5961',
  ardosiaS: '#323b41',
  bandeiraL: '#e8743b',
  bandeiraT: '#4f8a8b',
};
/** Parede do castelo: arenito à esquerda, pêssego no meio, verde-azulado à direita (como a aquarela). */
function parede(x, largura, sombra = false) {
  const t = x / (largura - 1);
  const c = t < 0.5 ? mistura('#f4dcaa', '#eab27a', t / 0.5) : mistura('#eab27a', '#86b5ae', (t - 0.5) / 0.5);
  return sombra ? mistura(c, '#5a3a24', 0.3) : c;
}

/** Torre com ameias, corpo sombreado à direita, telhado cônico e bandeira. */
function torre(arte, L, x0, x1, topo, base, apice, roof, flag, simples = false) {
  const corpo = (x) => parede(x, L, x >= x1 - (simples ? 0 : 1));
  arte.ret(x0, topo, x1, base, corpo);
  if (simples) {
    // ícone pequeno: sem capitel, telhado do tamanho do corpo (as torres não se encostam)
    cone(arte, x0, x1, topo - 1, apice, roof[0], roof[1]);
    return;
  }
  arte.ret(x0 - 1, topo - 2, x1 + 1, topo - 1, corpo); // capitel
  for (let x = x0 - 1; x <= x1 + 1; x += 2) arte.pinta(x, topo - 3, corpo); // ameias
  const meio = cone(arte, x0 - 1, x1 + 1, topo - 4, apice, roof[0], roof[1]);
  if (flag) bandeira(arte, Math.floor(meio - 0.5), apice - 1, flag, E.tinta);
}

function castelo(L, A, t) {
  const a = new Arte(L, A);
  const base = A - 3;
  // casas e muralhas entre as torres (desenhadas antes, ficam atrás)
  if (t.simples) a.ret(4, base - 8, L - 5, base, (x) => parede(x, L, false));
  for (const [x0, x1, topo] of t.casas) {
    a.ret(x0, topo, x1, base, (x) => parede(x, L, x === x1));
    cone(a, x0, x1, topo - 1, topo - 1 - Math.ceil((x1 - x0 + 1) / 2), E.telha, E.telhaS);
  }
  for (const tw of t.torres) torre(a, L, tw.x0, tw.x1, tw.topo, base, tw.apice, tw.roof ?? [E.telha, E.telhaS], tw.flag, t.simples);
  for (const [x, y] of t.janelas) {
    a.pinta(x, y, E.janela);
    a.pinta(x, y + 1, E.janela);
  }
  a.contorno(E.tinta);
  return a;
}

const logoEkfrase = castelo(64, 48, {
  casas: [
    [11, 13, 33],
    [21, 26, 29],
    [37, 42, 29],
    [50, 52, 33],
  ],
  torres: [
    { x0: 4, x1: 10, topo: 27, apice: 15, flag: E.bandeiraT },
    { x0: 14, x1: 20, topo: 19, apice: 5, flag: E.bandeiraL },
    { x0: 27, x1: 36, topo: 14, apice: 2, flag: E.bandeiraL },
    { x0: 43, x1: 49, topo: 19, apice: 5, flag: E.bandeiraL },
    { x0: 53, x1: 59, topo: 27, apice: 15, flag: E.bandeiraT, roof: [E.ardosia, E.ardosiaS] },
  ],
  janelas: [
    [7, 31], [7, 37], [17, 23], [17, 30], [17, 37], [31, 18], [32, 18], [31, 25], [32, 25],
    [31, 32], [32, 32], [46, 23], [46, 30], [46, 37], [56, 31], [56, 37], [23, 33], [40, 33],
  ],
});

const iconeEkfrase = castelo(32, 32, {
  simples: true,
  casas: [],
  torres: [
    { x0: 1, x1: 4, topo: 17, apice: 11 },
    { x0: 7, x1: 10, topo: 11, apice: 4 },
    { x0: 13, x1: 18, topo: 8, apice: 0 },
    { x0: 21, x1: 24, topo: 11, apice: 4 },
    { x0: 27, x1: 30, topo: 17, apice: 11, roof: [E.ardosia, E.ardosiaS] },
  ],
  janelas: [
    [15, 12], [16, 12], [15, 19], [16, 19], [8, 15], [23, 15], [2, 21], [29, 21],
  ],
});

// ---------------------------------------------------------------- Vernákula
const V = {
  tinta: '#0b1f26',
  petroleo: '#12333d',
  petroleoE: '#0d2730',
  petroleoM: '#1f4b57',
  petroleoC: '#2f6b78',
  ouro: '#d9a441',
  ouroC: '#f2c972',
  ouroE: '#a8772a',
  creme: '#f6ead0',
  cremeS: '#d9c49b',
  rio: '#b4e0e8',
  rioE: '#6fb2c1',
  verde: '#4f7d55',
  verdeE: '#335c45',
  rocha: '#c2a066',
  nuvem: '#f6dca4',
};
const mx = (pts) => pts.map(([x, y]) => [64 - x, y]); // espelho para formas contínuas

function logoVernakula() {
  const a = new Arte(64, 64);
  // sol e nuvens
  a.circulo(32, 23, 16, (x, y) => (x + y < 48 ? V.ouroC : V.ouro));
  for (const [x0, x1, y] of [[4, 14, 27], [7, 12, 26], [47, 59, 21], [50, 56, 20], [45, 55, 31]]) a.ret(x0, y, x1, y, V.nuvem);
  // morro com a encosta de pedra à direita
  a.poligono([[13, 40], [22, 31], [32, 27], [42, 31], [51, 40]], (x) => (x > 34 && x < 44 ? V.rocha : V.petroleoM));
  // castelo: muralha, duas torres de cada lado, a torre grande no centro
  const escuro = (x0, x1) => (x) => (x === x0 ? V.petroleoM : x >= x1 ? V.petroleoE : V.petroleo);
  a.ret(20, 28, 43, 33, V.petroleo);
  for (let x = 20; x <= 43; x += 2) a.pinta(x, 27, V.petroleo);
  const torreV = (x0, x1, topo, apice) => {
    a.ret(x0, topo, x1, 33, escuro(x0, x1));
    a.ret(x0 - 1, topo - 1, x1 + 1, topo - 1, V.petroleo);
    return cone(a, x0 - 1, x1 + 1, topo - 2, apice, V.petroleoM, V.petroleo);
  };
  torreV(18, 20, 23, 17);
  torreV(43, 45, 23, 17);
  torreV(24, 26, 17, 10);
  torreV(37, 39, 17, 10);
  const meio = torreV(30, 33, 10, 3);
  bandeira(a, Math.floor(meio - 0.5), 2, V.petroleoC, V.petroleo);
  for (const [x, y] of [[31, 14], [32, 14], [31, 20], [32, 20], [25, 21], [38, 21], [19, 27], [44, 27], [28, 30], [35, 30]]) a.pinta(x, y, V.ouroC);
  // vale dentro do livro, com o rio serpenteando
  a.poligono([[16, 38], [48, 38], [32, 57]], (x, y) =>
    y < 41 ? V.petroleoC : ruido(x, y) > 0.72 ? V.verdeE : V.verde,
  );
  const rio = [[32, 55], [30, 52], [34, 49], [29, 46], [33, 43], [30, 40], [32, 38]];
  for (let i = 0; i < rio.length - 1; i++) {
    a.linha(rio[i][0], rio[i][1], rio[i + 1][0], rio[i + 1][1], V.rio);
    a.linha(rio[i][0] + 1, rio[i][1], rio[i + 1][0] + 1, rio[i + 1][1], V.rioE);
  }
  // páginas (camadas de folhas em listras diagonais) e capas com filete dourado
  const paginaE = [[5, 33], [13, 30], [17, 36], [32, 55], [32, 60]];
  a.poligono(paginaE, (x, y) => (((x - y) % 3) + 3) % 3 === 0 ? V.cremeS : V.creme);
  a.poligono(mx(paginaE), (x, y) => ((x + y) % 3 === 0 ? V.cremeS : V.creme));
  const capaE = [[0, 36], [5, 33], [32, 60], [32, 64], [27, 64]];
  a.poligono(capaE, V.petroleo);
  a.poligono(mx(capaE), V.petroleo);
  a.linha(2, 37, 27, 62, V.ouro);
  a.linha(61, 37, 36, 62, V.ouro);
  // escudo com a estrela
  a.poligono([[27, 54], [37, 54], [37, 60], [32, 64], [27, 60]], V.ouro);
  a.poligono([[28, 55], [36, 55], [36, 59.5], [32, 63], [28, 59.5]], V.petroleo);
  for (const [x, y] of [[32, 56], [31, 58], [32, 58], [33, 58], [32, 60], [32, 57], [32, 59]]) a.pinta(x, y, V.ouroC);
  // o dragão
  a.poligono([[9, 15], [12, 9], [14, 14]], V.petroleoC);
  a.linha(5, 17, 15, 14, V.petroleoC);
  a.pinta(16, 13, V.petroleoC);
  a.contorno(V.tinta);
  return a;
}
const vernakula = logoVernakula();

// ---------------------------------------------------------------- Maker
const M = {
  papel: '#ecdcb2',
  papelC: '#f7ecd0',
  papelS: '#cdb47c',
  rolo: '#c49a5a',
  roloC: '#e2c084',
  roloE: '#8a6634',
  mar: '#8cc0cc',
  marE: '#6aa2b4',
  marC: '#b8dde0',
  terra: '#9cbc62',
  terraC: '#bcd47c',
  mata: '#4f7a3a',
  mataC: '#6a9a48',
  serra: '#8a6a4a',
  serraE: '#5e4630',
  neve: '#f6f2e6',
  rio: '#4f93b8',
  rota: '#b3362a',
  ouro: '#e9c46a',
  ouroE: '#b8913a',
  teal: '#17707a',
  tealC: '#3fa2a8',
  tinta: '#2b2224',
};

function logoMaker() {
  const a = new Arte(64, 64);
  // o pergaminho: a folha, com a borda de baixo e da direita na sombra
  a.ret(10, 13, 53, 51, (x, y) => (y >= 50 || x >= 52 ? M.papelS : y <= 14 ? M.papelC : M.papel));
  // o mar dentro da moldura, com ondinhas
  a.ret(13, 16, 50, 48, (x, y) => (x === 13 || y === 16 ? M.marE : (x * 3 + y * 5) % 11 === 0 && y % 4 === 0 ? M.marC : M.mar));
  // a ilha (luz de cima à esquerda) com a praia clara na borda
  const ilha = [[16, 31], [19, 23], [27, 19], [36, 21], [43, 26], [46, 33], [42, 41], [32, 46], [22, 44], [17, 38]];
  a.poligono(ilha, M.terraC);
  a.poligono(ilha.map(([x, y]) => [x + (x < 31 ? 1 : -1), y + (y < 32 ? 1 : -1)]), (x, y) => (x + y > 66 ? M.terra : ruido(x, y, 3) > 0.8 ? M.terraC : M.terra));
  // mata em tufos
  for (const [x, y, r] of [[23, 37, 3], [28, 40, 2.5], [20, 33, 2], [38, 37, 2.5]]) a.circulo(x, y, r, (px, py) => (px + py < x + y - 1 ? M.mataC : M.mata));
  // a serra nevada
  for (const [x0, xm, x1, base, topo] of [[25, 29, 33, 31, 23], [31, 35, 40, 31, 21]]) {
    a.poligono([[x0, base], [xm, topo], [x1, base]], (x) => (x > xm ? M.serraE : M.serra));
    a.poligono([[xm - 2, topo + 3], [xm, topo], [xm + 2, topo + 3]], M.neve);
  }
  // o rio, da serra ao mar
  a.linha(35, 31, 37, 36, M.rio);
  a.linha(37, 36, 41, 42, M.rio);
  // a rota tracejada até o X
  const rota = [[18, 41], [21, 40], [24, 43], [28, 44], [31, 42]];
  for (const [x, y] of rota) a.pinta(x, y, M.rota);
  a.linha(32, 42, 34, 44, M.rota);
  a.linha(34, 42, 32, 44, M.rota);
  // os rolos dos dois lados (cilindros com luz à esquerda)
  for (const x0 of [5, 52]) {
    a.ret(x0, 11, x0 + 6, 53, (x) => (x === x0 ? M.roloC : x >= x0 + 5 ? M.roloE : M.rolo));
    a.ret(x0 + 1, 10, x0 + 5, 10, M.roloC);
    a.ret(x0 + 1, 54, x0 + 5, 54, M.roloE);
    a.ret(x0 + 2, 8, x0 + 4, 9, M.ouroE);
    a.ret(x0 + 2, 55, x0 + 4, 56, M.ouroE);
  }
  // a rosa dos ventos no canto de cima, por cima do mapa
  const cx = 48;
  const cy = 15;
  a.circulo(cx, cy, 8, M.teal);
  a.circulo(cx, cy, 6.5, M.papelC);
  a.poligono([[cx, cy - 10], [cx + 2, cy], [cx - 2, cy]], (x) => (x < cx ? M.ouro : M.ouroE)); // norte
  a.poligono([[cx, cy + 10], [cx + 2, cy], [cx - 2, cy]], (x) => (x < cx ? M.tealC : M.teal));
  a.poligono([[cx - 10, cy], [cx, cy - 2], [cx, cy + 2]], (x, y) => (y < cy ? M.tealC : M.teal));
  a.poligono([[cx + 10, cy], [cx, cy - 2], [cx, cy + 2]], (x, y) => (y < cy ? M.tealC : M.teal));
  a.pinta(cx, cy, M.rota);
  a.pinta(cx, cy - 9, M.rota);
  a.contorno(M.tinta);
  return a;
}
const maker = logoMaker();

// ---------------------------------------------------------------- Biblioteca
const B = {
  capa: '#2f5d50',
  capaC: '#4a8270',
  capaE: '#1d3d33',
  pagina: '#f4ead2',
  paginaS: '#ddcba2',
  paginaE: '#bfa978',
  linha: '#a8956a',
  fita: '#9b3442',
  fitaE: '#6e2230',
  ouro: '#e0c172',
  ouroE: '#b8913a',
  tinta: '#1b1a1f',
};

/** O livro aberto (capa verde, páginas em leque, o marcador vermelho) com a lua e as estrelas em cima. */
function logoBiblioteca() {
  const a = new Arte(64, 64);
  // a capa por baixo, um pouco maior que as páginas
  a.poligono([[3, 30], [31, 36], [33, 36], [61, 30], [61, 55], [33, 61], [31, 61], [3, 55]], (x, y) => (y > 56 ? B.capaE : x < 8 ? B.capaC : B.capa));
  // as duas páginas, curvas no meio (luz à esquerda; a da direita mais sombreada)
  for (let x = 6; x <= 58; x++) {
    const meio = Math.abs(x - 32);
    const topo = 29 + Math.round(5 - (meio / 26) * 6 + Math.sin((meio / 26) * Math.PI) * 1.5);
    const base = 54 + Math.round(4 - (meio / 26) * 4);
    for (let y = topo; y <= base; y++) {
      let c = x < 32 ? B.pagina : B.paginaS;
      if (meio < 2) c = B.paginaE;
      else if (y >= base - 1) c = B.paginaE;
      a.pinta(x, y, c);
    }
    // linhas de texto
    if (meio > 3 && meio < 23) for (let y = topo + 4; y < base - 3; y += 3) if ((x + y) % 9 !== 0) a.pinta(x, y, B.linha);
  }
  // as folhas soltas da beira (o leque)
  a.linha(6, 33, 6, 54, B.paginaE);
  a.linha(58, 33, 58, 54, B.paginaE);
  // o marcador saindo por baixo
  a.ret(40, 55, 42, 62, B.fita);
  a.ret(42, 55, 42, 62, B.fitaE);
  a.pinta(40, 63, B.fita);
  a.pinta(42, 63, B.fitaE);
  // a lua crescente e as estrelas
  a.circulo(32, 14, 10, (x) => (x < 30 ? B.ouro : B.ouroE));
  a.circulo(37, 11, 9, null);
  for (const [x, y] of [[15, 9], [50, 6], [53, 18], [12, 21]]) {
    a.pinta(x, y, B.ouro);
    a.pinta(x - 1, y, B.ouroE);
    a.pinta(x + 1, y, B.ouroE);
    a.pinta(x, y - 1, B.ouroE);
    a.pinta(x, y + 1, B.ouroE);
  }
  a.contorno(B.tinta);
  return a;
}

// ---------------------------------------------------------------- Writer
export const W = {
  papel: '#f6efdc',
  papelS: '#e2d4b0',
  papelE: '#c9b78a',
  linha: '#8a7a5c',
  noite: '#1b2440',
  noiteC: '#33406b',
  pena: '#fbf6e9',
  penaS: '#cdbd95',
  sepia: '#a4703a',
  sepiaE: '#7a4a21',
  tinta: '#11162a',
};

/** A folha de papel marfim com o canto dobrado, as linhas já escritas e a pena azul-noite por cima. */
export function logoWriter() {
  const a = new Arte(64, 64);
  // a folha (luz do alto à esquerda: sombra na direita e embaixo)
  a.ret(7, 9, 45, 60, (x, y) => (y > 57 ? W.papelE : x > 42 ? W.papelS : W.papel));
  // o canto dobrado
  a.poligono([[36, 8], [47, 8], [47, 20]], null);
  a.poligono([[36, 9], [36, 20], [46, 20]], W.papelE);
  // as linhas escritas (a última ainda pela metade)
  for (let y = 17; y <= 47; y += 5) a.ret(12, y, y === 17 ? 30 : y % 2 ? 38 : 34, y, W.linha);
  a.ret(12, 52, 20, 52, W.noite);
  // a pena: as barbas azul-noite, a haste clara e o bico sépia com a gota de tinta
  a.poligono([[31, 45], [37, 26], [47, 11], [58, 3], [61, 6], [56, 19], [46, 33], [36, 47]], (x, y) => (x + y > 62 ? W.noite : W.noiteC));
  for (const [x, y] of [[41, 27], [46, 21], [51, 15], [45, 30], [50, 24], [55, 17]]) a.pinta(x, y, W.tinta);
  a.linha(25, 52, 58, 6, W.pena);
  a.linha(26, 52, 59, 6, W.penaS);
  a.poligono([[22, 57], [26, 49], [30, 53]], W.sepia);
  a.linha(23, 56, 28, 52, W.sepiaE);
  a.ret(21, 58, 22, 59, W.noite);
  a.contorno(W.tinta);
  return a;
}

// ---------------------------------------------------------------- cantoneiras e horizonte
function cantoneira() {
  const c = { lat: '#b8954f', latC: '#ecd08f', latE: '#6e5426', rebite: '#3d2f17' };
  const a = new Arte(14, 14);
  a.poligono([[0, 0], [14, 0], [12, 3], [3, 3], [3, 12], [0, 14]], (x, y) => (y === 0 || x === 0 ? c.latC : c.lat));
  a.linha(3, 9, 9, 3, c.lat);
  a.linha(4, 9, 9, 4, c.latE);
  a.linha(3, 3, 11, 3, c.latE);
  a.linha(3, 4, 3, 11, c.latE);
  for (const [x, y] of [[1, 1], [10, 1], [1, 10]]) a.pinta(x, y, c.rebite);
  a.contorno('#2e2210');
  return a;
}

/** Colinas com árvores, que se repetem lado a lado sem emenda (período = largura). */
function colinas() {
  const L = 200;
  const a = new Arte(L, 30);
  for (let x = 0; x < L; x++) {
    const f = (k, fase) => Math.sin((2 * Math.PI * k * x) / L + fase);
    const h = Math.round(16 + 4 * f(2, 0.3) + 2.5 * f(5, 1.7) + 1.2 * f(11, 2.1));
    a.ret(x, h, x, 29, '#000000');
    if (ruido(x, 3) > 0.86) for (let i = 0; i < 4; i++) a.ret(x - i + 1, h - 4 + i, x + i - 1, h - 4 + i, '#000000');
  }
  return a;
}

function silhuetaCastelo() {
  const s = castelo(64, 48, {
    casas: [[11, 13, 33], [21, 26, 29], [37, 42, 29], [50, 52, 33]],
    torres: [
      { x0: 4, x1: 10, topo: 27, apice: 15 },
      { x0: 14, x1: 20, topo: 19, apice: 5 },
      { x0: 27, x1: 36, topo: 14, apice: 2 },
      { x0: 43, x1: 49, topo: 19, apice: 5 },
      { x0: 53, x1: 59, topo: 27, apice: 15 },
    ],
    janelas: [],
  });
  const a = new Arte(80, 56);
  for (let y = 0; y < 48; y++) for (let x = 0; x < 64; x++) if (s.ler(x, y)) a.pinta(x + 8, y, '#000000');
  a.poligono([[0, 56], [6, 47], [40, 42], [74, 47], [80, 56]], '#000000');
  return a;
}

// rodado direto (node scripts/arte/gerar.mjs) grava tudo; importado (scripts/arte/writer-os.mjs), só empresta os desenhos
if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
console.log('Gravando a arte:');
gravar(NUCLEO, 'ekfrase-logo.png', logoEkfrase.png(4));
gravar(NUCLEO, 'ekfrase-icone.png', iconeEkfrase.png(4));
const canto = cantoneira();
gravar(NUCLEO, 'canto-se.png', canto.png(4));
gravar(NUCLEO, 'canto-sd.png', canto.espelhada().png(4));
gravar(NUCLEO, 'canto-ie.png', canto.virada().png(4));
gravar(NUCLEO, 'canto-id.png', canto.espelhada().virada().png(4));
gravar(NUCLEO, 'horizonte-colinas.png', colinas().png(3));
gravar(NUCLEO, 'horizonte-castelo.png', silhuetaCastelo().png(3));
gravar(join(VK, 'src', 'img'), 'logo-vernakula.png', vernakula.png(4));
gravar(join(VK, 'public', 'icones'), 'icone-64.png', vernakula.png(1, { margem: 0 }));
gravar(join(MK, 'src', 'img'), 'logo-maker.png', maker.png(4));
gravar(join(MK, 'public'), 'icone-64.png', maker.png(1, { margem: 0 }));
const biblioteca = logoBiblioteca();
const BI = join(RAIZ, 'apps', 'biblioteca');
gravar(join(BI, 'src', 'img'), 'logo-biblioteca.png', biblioteca.png(4));
gravar(join(BI, 'public'), 'icone-64.png', biblioteca.png(1, { margem: 0 }));
const writer = logoWriter();
const WR = join(RAIZ, 'apps', 'writer');
gravar(join(WR, 'src', 'img'), 'logo-writer.png', writer.png(4));
gravar(join(WR, 'public'), 'icone-64.png', writer.png(1, { margem: 0 }));
for (const t of [192, 512]) {
  // Ícone de instalar no celular: precisa de fundo (o Android recorta as bordas), com folga.
  gravar(join(VK, 'public', 'icones'), `icone-${t}.png`, vernakula.png(t / 96, { fundo: V.petroleoE, lado: 96 }));
  gravar(join(WR, 'public', 'icones'), `icone-${t}.png`, writer.png(t / 96, { fundo: W.noite, lado: 96 }));
}
}
