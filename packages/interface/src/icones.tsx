// SPDX-License-Identifier: MPL-2.0

/**
 * Ícones em pixel art feitos por código (DEC-P007): cada <rect> é um pixel (ou
 * uma faixa) de uma grade 12×12. `currentColor` faz o ícone seguir a cor do
 * texto do botão.
 */
type Px = readonly [x: number, y: number, l?: number, a?: number];

function Pixels({ px, titulo, tamanho = 20 }: { px: readonly Px[]; titulo?: string; tamanho?: number }) {
  return (
    <svg class="icone-px" viewBox="0 0 12 12" width={tamanho} height={tamanho} aria-hidden={titulo ? undefined : 'true'} shape-rendering="crispEdges">
      {titulo && <title>{titulo}</title>}
      {px.map(([x, y, l = 1, a = 1]) => (
        <rect key={`${x}-${y}-${l}-${a}`} x={x} y={y} width={l} height={a} fill="currentColor" />
      ))}
    </svg>
  );
}

// Sol: miolo 4×4 com cantos tirados e oito raios.
const SOL: readonly Px[] = [
  [5, 0, 2, 2], [5, 10, 2, 2], [0, 5, 2, 2], [10, 5, 2, 2],
  [1, 1, 2, 2], [9, 1, 2, 2], [1, 9, 2, 2], [9, 9, 2, 2],
  [5, 3, 2, 1], [4, 4, 4, 4], [3, 5, 1, 2], [8, 5, 1, 2], [5, 8, 2, 1],
];

// Lua crescente, aberta para a direita, com duas estrelinhas.
const LUA: readonly Px[] = [
  [4, 1, 3, 1], [3, 2, 2, 1], [2, 3, 2, 2], [1, 5, 2, 2], [2, 7, 2, 2],
  [3, 9, 2, 1], [4, 10, 4, 1], [7, 9, 2, 1], [9, 1, 1, 1], [10, 4, 1, 1],
];

// Passeio: duas pegadas, uma à frente da outra.
const PEGADAS: readonly Px[] = [
  [1, 4], [3, 4], [1, 6, 3, 3], [2, 9, 2, 2],
  [7, 0], [9, 0], [7, 2, 3, 3], [8, 5, 2, 2],
];

// Lugares: o alfinete de mapa.
const LUGAR: readonly Px[] = [
  [4, 0, 4, 1], [3, 1, 6, 1], [2, 2, 3, 3], [7, 2, 3, 3], [5, 2, 2, 1], [5, 4, 2, 1],
  [3, 5, 6, 1], [3, 6, 6, 1], [4, 7, 4, 1], [5, 8, 2, 3],
];

// Idioma: o globo (contorno, equador e meridiano).
const GLOBO: readonly Px[] = [
  [4, 0, 4, 1], [2, 1, 2, 1], [8, 1, 2, 1], [1, 2, 1, 2], [10, 2, 1, 2], [0, 4, 1, 4], [11, 4, 1, 4],
  [1, 8, 1, 2], [10, 8, 1, 2], [2, 10, 2, 1], [8, 10, 2, 1], [4, 11, 4, 1],
  [1, 5, 10, 1], [5, 1, 2, 10], [3, 2, 1, 1], [8, 2, 1, 1], [3, 9, 1, 1], [8, 9, 1, 1],
];

// Feedback: o balão de fala com um "!".
const BALAO: readonly Px[] = [
  [1, 1, 10, 1], [0, 2, 1, 6], [11, 2, 1, 6], [1, 8, 10, 1], [2, 9, 3, 1], [2, 10, 1, 1],
  [5, 3, 2, 3], [5, 6, 2, 1],
];

// Conta: a pessoa (cabeça e ombros).
const PESSOA: readonly Px[] = [[5, 0, 2, 1], [4, 1, 4, 3], [5, 4, 2, 1], [3, 6, 6, 1], [2, 7, 8, 4]];

// Baixar: a seta para dentro da bandeja.
const BAIXAR: readonly Px[] = [[5, 0, 2, 5], [3, 5, 6, 1], [4, 6, 4, 1], [5, 7, 2, 1], [0, 8, 1, 3], [11, 8, 1, 3], [0, 10, 12, 1]];

// Nuvem.
const NUVEM: readonly Px[] = [[4, 2, 3, 1], [3, 3, 5, 1], [8, 3, 2, 1], [1, 4, 10, 1], [0, 5, 12, 3], [1, 8, 10, 1]];

// Arquivos: exportar e importar (uma seta sobe, outra desce).
const TROCA: readonly Px[] = [
  [2, 0, 2, 1], [1, 1, 4, 1], [0, 2, 6, 1], [2, 3, 2, 8],
  [8, 1, 2, 8], [6, 9, 6, 1], [7, 10, 4, 1], [8, 11, 2, 1],
];

// Fechar: o X.
const FECHAR: readonly Px[] = [[1, 1, 2, 2], [3, 3, 2, 2], [5, 5, 2, 2], [7, 7, 2, 2], [9, 9, 2, 2], [9, 1, 2, 2], [7, 3, 2, 2], [3, 7, 2, 2], [1, 9, 2, 2]];

// Câmera (o print da tela).
const CAMERA: readonly Px[] = [[4, 2, 4, 1], [0, 3, 12, 1], [0, 4, 1, 6], [11, 4, 1, 6], [0, 10, 12, 1], [4, 5, 4, 1], [3, 6, 1, 2], [8, 6, 1, 2], [4, 8, 4, 1]];

// Inventário: a bolsa de couro com a aba e a fivela.
const BOLSA: readonly Px[] = [
  [4, 0, 4, 1], [3, 1, 1, 2], [8, 1, 1, 2], [1, 3, 10, 1], [0, 4, 1, 7], [11, 4, 1, 7], [1, 11, 10, 1],
  [1, 4, 10, 2], [5, 6, 2, 2],
];

// Livro: aberto, com as duas páginas e a lombada.
const LIVRO: readonly Px[] = [
  [0, 2, 1, 8], [11, 2, 1, 8], [1, 1, 4, 1], [7, 1, 4, 1], [5, 2, 2, 9], [1, 10, 4, 1], [7, 10, 4, 1],
  [2, 4, 2, 1], [8, 4, 2, 1], [2, 6, 2, 1], [8, 6, 2, 1],
];

// Casa: a página inicial.
const CASA: readonly Px[] = [
  [5, 0, 2, 1], [4, 1, 4, 1], [3, 2, 6, 1], [2, 3, 8, 1], [1, 4, 10, 1], [2, 5, 1, 6], [9, 5, 1, 6], [2, 11, 8, 1], [5, 7, 2, 4],
];

type P = { titulo?: string; tamanho?: number };
export const IconeSol = (p: P) => <Pixels px={SOL} {...p} />;
export const IconeLua = (p: P) => <Pixels px={LUA} {...p} />;
export const IconePasseio = (p: P) => <Pixels px={PEGADAS} {...p} />;
export const IconeLugar = (p: P) => <Pixels px={LUGAR} {...p} />;
export const IconeGlobo = (p: P) => <Pixels px={GLOBO} {...p} />;
export const IconeBalao = (p: P) => <Pixels px={BALAO} {...p} />;
export const IconePessoa = (p: P) => <Pixels px={PESSOA} {...p} />;
export const IconeBaixar = (p: P) => <Pixels px={BAIXAR} {...p} />;
export const IconeNuvem = (p: P) => <Pixels px={NUVEM} {...p} />;
export const IconeTroca = (p: P) => <Pixels px={TROCA} {...p} />;
export const IconeFechar = (p: P) => <Pixels px={FECHAR} {...p} />;
export const IconeCamera = (p: P) => <Pixels px={CAMERA} {...p} />;
export const IconeBolsa = (p: P) => <Pixels px={BOLSA} {...p} />;
export const IconeLivro = (p: P) => <Pixels px={LIVRO} {...p} />;
export const IconeCasa = (p: P) => <Pixels px={CASA} {...p} />;
