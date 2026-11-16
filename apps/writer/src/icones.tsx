// SPDX-License-Identifier: MPL-2.0

/**
 * Os ícones próprios do Writer, em pixel art feita por código (DEC-P007), do mesmo jeito dos ícones
 * comuns (`packages/interface/src/icones.tsx`): cada <rect> é um pixel ou uma faixa numa grade
 * 12×12, e `currentColor` faz o ícone seguir a cor do texto do botão.
 */
type Px = readonly [x: number, y: number, l?: number, a?: number];
type P = { tamanho?: number };

function Pixels({ px, tamanho = 20 }: { px: readonly Px[]; tamanho?: number }) {
  return (
    <svg class="icone-px" viewBox="0 0 12 12" width={tamanho} height={tamanho} aria-hidden="true" shape-rendering="crispEdges">
      {px.map(([x, y, l = 1, a = 1]) => (
        <rect key={`${x}-${y}-${l}-${a}`} x={x} y={y} width={l} height={a} fill="currentColor" />
      ))}
    </svg>
  );
}

// prettier-ignore
const MAIS: readonly Px[] = [[5, 2, 2, 8], [2, 5, 8, 2]];
// prettier-ignore
const MENU: readonly Px[] = [[5, 1, 2, 2], [5, 5, 2, 2], [5, 9, 2, 2]];
// A lupa (a paleta de comandos).
// prettier-ignore
const LUPA: readonly Px[] = [
  [3, 0, 4, 1], [2, 1, 1, 1], [7, 1, 1, 1], [1, 2, 1, 4], [8, 2, 1, 4], [2, 6, 1, 1], [7, 6, 1, 1], [3, 7, 4, 1],
  [8, 7, 1, 1], [9, 8, 1, 1], [10, 9, 1, 1], [11, 10, 1, 1], [9, 9, 1, 1], [10, 10, 1, 1],
];
// A engrenagem (ajustes): o aro e os oito dentes.
// prettier-ignore
const ENGRENAGEM: readonly Px[] = [
  [5, 0, 2, 3], [5, 9, 2, 3], [0, 5, 3, 2], [9, 5, 3, 2], [2, 2, 2, 2], [8, 2, 2, 2], [2, 8, 2, 2], [8, 8, 2, 2],
  [4, 3, 4, 1], [3, 4, 1, 4], [8, 4, 1, 4], [4, 8, 4, 1],
];
// O teclado (a lista de atalhos).
// prettier-ignore
const TECLADO: readonly Px[] = [
  [0, 2, 12, 1], [0, 9, 12, 1], [0, 3, 1, 6], [11, 3, 1, 6],
  [2, 4, 1, 1], [4, 4, 1, 1], [6, 4, 1, 1], [8, 4, 1, 1], [3, 6, 1, 1], [5, 6, 1, 1], [7, 6, 1, 1], [9, 5, 1, 2],
];
// A lâmpada (ideias).
// prettier-ignore
const LAMPADA: readonly Px[] = [[4, 0, 4, 1], [3, 1, 6, 1], [2, 2, 8, 4], [3, 6, 6, 1], [4, 7, 4, 1], [4, 9, 4, 1], [5, 11, 2, 1]];
// prettier-ignore
const LIXEIRA: readonly Px[] = [[4, 0, 4, 1], [1, 1, 10, 1], [2, 3, 1, 8], [9, 3, 1, 8], [3, 10, 6, 1], [4, 4, 1, 5], [7, 4, 1, 5]];
// O relógio (o histórico da cena).
// prettier-ignore
const RELOGIO: readonly Px[] = [
  [4, 0, 4, 1], [2, 1, 2, 1], [8, 1, 2, 1], [1, 2, 1, 2], [10, 2, 1, 2], [0, 4, 1, 4], [11, 4, 1, 4],
  [1, 8, 1, 2], [10, 8, 1, 2], [2, 10, 2, 1], [8, 10, 2, 1], [4, 11, 4, 1], [5, 3, 1, 4], [6, 6, 3, 1],
];
// prettier-ignore
const VOLTAR: readonly Px[] = [[1, 5, 10, 2], [2, 4, 1, 4], [3, 3, 1, 6], [4, 2, 1, 8]];
// A folha com linhas (as notas da cena, a ficha).
// prettier-ignore
const NOTAS: readonly Px[] = [[2, 0, 8, 1], [2, 11, 8, 1], [1, 0, 1, 12], [10, 0, 1, 12], [3, 3, 6, 1], [3, 5, 6, 1], [3, 7, 4, 1]];
// O aviso: a placa com o "!".
// prettier-ignore
const AVISO: readonly Px[] = [[0, 0, 12, 1], [0, 11, 12, 1], [0, 1, 1, 10], [11, 1, 1, 10], [5, 2, 2, 5], [5, 8, 2, 2]];
// A alça de arrastar: seis pontos.
// prettier-ignore
const ALCA: readonly Px[] = [[3, 1, 2, 2], [7, 1, 2, 2], [3, 5, 2, 2], [7, 5, 2, 2], [3, 9, 2, 2], [7, 9, 2, 2]];
// A seta que sobe (enviando para a nuvem).
// prettier-ignore
const SOBE: readonly Px[] = [[5, 1, 2, 10], [4, 2, 4, 1], [3, 3, 6, 1], [2, 4, 8, 1]];
// A pena (escrever).
// prettier-ignore
const PENA: readonly Px[] = [
  [8, 0, 3, 1], [7, 1, 4, 1], [6, 2, 5, 1], [5, 3, 5, 1], [4, 4, 5, 1], [4, 5, 4, 1], [3, 6, 4, 1], [3, 7, 3, 1],
  [2, 8, 2, 1], [1, 9, 2, 1], [0, 10, 2, 1], [0, 11, 1, 1],
];

// O alfinete (fixar uma ideia): a cabeça redonda e a ponta.
// prettier-ignore
const ALFINETE: readonly Px[] = [[4, 0, 4, 1], [3, 1, 6, 3], [4, 4, 4, 1], [2, 5, 8, 1], [5, 6, 2, 3], [5, 9, 2, 1], [5, 10, 1, 2]];
// A bandeja com a seta para cima (importar: o arquivo sobe para o app).
// prettier-ignore
const ENTRA: readonly Px[] = [[5, 0, 2, 1], [4, 1, 4, 1], [3, 2, 6, 1], [5, 3, 2, 6], [0, 8, 1, 4], [11, 8, 1, 4], [0, 11, 12, 1]];

export const IconeAlfinete = (p: P) => <Pixels px={ALFINETE} {...p} />;
export const IconeEntra = (p: P) => <Pixels px={ENTRA} {...p} />;
export const IconeMais = (p: P) => <Pixels px={MAIS} {...p} />;
export const IconeMenu = (p: P) => <Pixels px={MENU} {...p} />;
export const IconeLupa = (p: P) => <Pixels px={LUPA} {...p} />;
export const IconeEngrenagem = (p: P) => <Pixels px={ENGRENAGEM} {...p} />;
export const IconeTeclado = (p: P) => <Pixels px={TECLADO} {...p} />;
export const IconeLampada = (p: P) => <Pixels px={LAMPADA} {...p} />;
export const IconeLixeira = (p: P) => <Pixels px={LIXEIRA} {...p} />;
export const IconeRelogio = (p: P) => <Pixels px={RELOGIO} {...p} />;
export const IconeVoltar = (p: P) => <Pixels px={VOLTAR} {...p} />;
export const IconeNotas = (p: P) => <Pixels px={NOTAS} {...p} />;
export const IconeAviso = (p: P) => <Pixels px={AVISO} {...p} />;
export const IconeAlca = (p: P) => <Pixels px={ALCA} {...p} />;
export const IconeSobe = (p: P) => <Pixels px={SOBE} {...p} />;
export const IconePena = (p: P) => <Pixels px={PENA} {...p} />;

// O botão de ligar (o painel do sistema do Writer OS): o aro aberto em cima e o traço do meio.
// prettier-ignore
const LIGAR: readonly Px[] = [
  [5, 0, 2, 6], [2, 2, 2, 1], [8, 2, 2, 1], [1, 3, 1, 2], [10, 3, 1, 2], [0, 5, 1, 3], [11, 5, 1, 3],
  [1, 8, 1, 1], [10, 8, 1, 1], [2, 9, 1, 1], [9, 9, 1, 1], [3, 10, 6, 1],
];
export const IconeLigar = (p: P) => <Pixels px={LIGAR} {...p} />;

// O painel do sistema do Writer OS: uma tela de computador (o botão de ligar é só do "Desligar").
// prettier-ignore
const SISTEMA: readonly Px[] = [[1, 1, 10, 1], [1, 2, 1, 6], [10, 2, 1, 6], [1, 8, 10, 1], [5, 9, 2, 1], [3, 10, 6, 1]];
export const IconeSistema = (p: P) => <Pixels px={SISTEMA} {...p} />;
