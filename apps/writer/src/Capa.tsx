// SPDX-License-Identifier: MPL-2.0

/**
 * A CAPA de uma história, feita por código (DEC-P007): um livro em pixel art numa grade 18×26, com a
 * cor de fundo (`--capa-1` a `--capa-6`, da paleta) e um de quatro desenhos na frente. A escolha
 * fica em `historia.capa` (`{ cor, desenho }`); sem ela, sai do id da história (sempre a mesma).
 */
import type { Historia } from '@ekfrase/writer-nucleo';

export const CORES_DE_CAPA = 6;
export const DESENHOS_DE_CAPA = 4;

export interface ParametrosCapa {
  cor: number;
  desenho: number;
}

function deId(id: string): ParametrosCapa {
  let h = 0;
  for (const c of id) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return { cor: h % CORES_DE_CAPA, desenho: (h >>> 8) % DESENHOS_DE_CAPA };
}

export function capaDe(h: Pick<Historia, 'id' | 'capa'>): ParametrosCapa {
  const p = h.capa;
  const base = deId(h.id);
  const cor = typeof p?.['cor'] === 'number' ? Math.abs(Math.floor(p['cor'])) % CORES_DE_CAPA : base.cor;
  const desenho = typeof p?.['desenho'] === 'number' ? Math.abs(Math.floor(p['desenho'])) % DESENHOS_DE_CAPA : base.desenho;
  return { cor, desenho };
}

/** A capa seguinte (o botão "trocar a capa" passa por todas as combinações). */
export function proximaCapa(p: ParametrosCapa): ParametrosCapa {
  const desenho = (p.desenho + 1) % DESENHOS_DE_CAPA;
  return { desenho, cor: desenho === 0 ? (p.cor + 1) % CORES_DE_CAPA : p.cor };
}

type R = readonly [x: number, y: number, l: number, a: number];

// os desenhos da frente (na grade 18×26; o livro ocupa x 2..17)
// prettier-ignore
const DESENHOS: readonly (readonly R[])[] = [
  // a pena
  [[12, 5, 2, 1], [11, 6, 3, 1], [10, 7, 3, 1], [9, 8, 3, 1], [8, 9, 3, 1], [8, 10, 2, 1], [7, 11, 2, 1], [7, 12, 1, 2]],
  // a estrela
  [[9, 5, 1, 2], [8, 7, 3, 1], [5, 8, 9, 1], [7, 9, 5, 1], [7, 10, 2, 1], [10, 10, 2, 1], [6, 11, 2, 1], [11, 11, 2, 1]],
  // a lua
  [[8, 5, 3, 1], [7, 6, 2, 1], [6, 7, 2, 3], [7, 10, 2, 1], [8, 11, 4, 1], [11, 10, 2, 1]],
  // o losango
  [[9, 5, 1, 1], [8, 6, 3, 1], [7, 7, 5, 1], [6, 8, 7, 1], [7, 9, 5, 1], [8, 10, 3, 1], [9, 11, 1, 1]],
];

export function Capa({ historia, largura = 72 }: { historia: Pick<Historia, 'id' | 'capa'>; largura?: number }) {
  const { cor, desenho } = capaDe(historia);
  const fundo = { fill: `var(--capa-${cor + 1})` };
  const detalhe = { fill: 'var(--capa-detalhe)' };
  const borda = { fill: 'var(--borda)' };
  const papel = { fill: 'var(--papel)' };
  return (
    <svg class="capa" viewBox="0 0 18 26" width={largura} height={Math.round((largura * 26) / 18)} aria-hidden="true" shape-rendering="crispEdges">
      {/* as folhas, aparecendo do lado */}
      <rect x="15" y="2" width="2" height="23" style={papel} />
      {/* o livro */}
      <rect x="1" y="1" width="15" height="24" style={borda} />
      <rect x="2" y="2" width="13" height="22" style={fundo} />
      {/* a lombada */}
      <rect x="2" y="2" width="2" height="22" style={borda} opacity="0.35" />
      {/* a moldura e as faixas */}
      <rect x="5" y="3" width="9" height="1" style={detalhe} />
      <rect x="5" y="15" width="9" height="1" style={detalhe} />
      <rect x="6" y="18" width="7" height="1" style={detalhe} opacity="0.7" />
      <rect x="6" y="20" width="5" height="1" style={detalhe} opacity="0.7" />
      {(DESENHOS[desenho] ?? []).map(([x, y, l, a]) => (
        <rect key={`${x}-${y}`} x={x} y={y} width={l} height={a} style={detalhe} />
      ))}
    </svg>
  );
}
