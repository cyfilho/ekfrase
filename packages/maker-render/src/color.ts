// SPDX-License-Identifier: MPL-2.0

/**
 * Paletas do estilo pixel (DEC-023): rampas longas, do quase preto ao realce, para luz e volume.
 * Inspiradas nas referências de `assets-organizado/` (só o clima de cor; nenhum pixel copiado).
 * Cor = inteiro 0xRRGGBB.
 */

export type Ramp = readonly number[];

export const hex = (s: string): number => parseInt(s.slice(1), 16);
const ramp = (...colors: string[]): Ramp => Object.freeze(colors.map(hex));

export const GRASS = ramp('#1f3a1e', '#2b4d24', '#38612b', '#477532', '#5a893a', '#709d43', '#8bb34f', '#a9c862');
export const FOREST_FLOOR = ramp('#122214', '#182d19', '#1f3a1f', '#274826', '#30562c', '#3a6533', '#46743a', '#538342');
export const SAND = ramp('#7d5b34', '#94703f', '#ab864d', '#c19b5c', '#d2ad6d', '#dfbd7f', '#e9cc93', '#f2dcab');
export const TUNDRA = ramp('#3e4741', '#4d564e', '#5e675c', '#71796c', '#858c7e', '#9a9f91', '#b0b4a6', '#c8cbbe');
export const SNOW = ramp('#6f819b', '#8798b0', '#9fafc4', '#b7c5d6', '#cdd8e4', '#dfe7ef', '#edf2f7', '#ffffff');
export const SWAMP = ramp('#18241e', '#1f2e26', '#283a2e', '#314636', '#3b533c', '#466042', '#536e49', '#627d51');
export const ROCK = ramp('#2a2624', '#3a3531', '#4b453f', '#5d554e', '#71675e', '#857a6f', '#9b8f82', '#b5aa9b');
export const WATER = ramp('#10284a', '#143057', '#193a65', '#1f4573', '#265281', '#2e608f', '#386f9c', '#4580a8');
/** Sombra fria da rocha (face leste dos picos). */
export const ROCK_SHADE = ramp('#1b1c26', '#252733', '#303341', '#3c4050', '#4a4f60');
export const LAGOON = ramp('#3f8599', '#4e98a6', '#60aab0', '#76bcb9', '#8fcdc3');
export const CANOPY = ramp(
  '#0b1512',
  '#112119',
  '#172f1f',
  '#1f4025',
  '#29542a',
  '#386a2e',
  '#4f8332',
  '#749e39',
  '#a8c552',
);
export const CONIFER = ramp('#0a1714', '#0f221b', '#153023', '#1b3f2a', '#235031', '#2d6239', '#3a7541', '#4f8b4c');
export const TRUNK = ramp('#25170e', '#3f2617', '#623c22', '#8a5a2d', '#b3793c', '#d39f55');
export const REED = ramp('#26331b', '#3e5126', '#5d7232', '#82963f', '#a9b355');
export const CACTUS = ramp('#1d3a24', '#2b5530', '#3d723b', '#5a9146');

/** Segunda família de folhagem (verde-oliva), para as florestas não ficarem de uma cor só. */
export const OLIVE = ramp(
  '#11140c',
  '#1b2212',
  '#263018',
  '#33401d',
  '#435222',
  '#566627',
  '#6d7c2f',
  '#8c973c',
  '#b4b65a',
);
export const ROOF_TERRACOTTA = ramp('#3c1a12', '#5e2a1b', '#843a22', '#a64e2a', '#c56a38', '#de8a4e');
export const ROOF_SLATE = ramp('#1c2129', '#2a313c', '#3a4351', '#4d5868', '#63707f', '#7f8b98');
export const ROOF_THATCH = ramp('#3a2a14', '#5a4220', '#7c5d2c', '#9c7a3a', '#bb9850', '#d6b46b');
export const WALL = ramp('#7d6c55', '#a39276', '#c5b597', '#ddd0b3', '#eee5cd');
export const TIMBER = hex('#3b2a1c');
export const WINDOW_LIT = hex('#f3d27a');
export const WINDOW_DARK = hex('#2c3a4a');

export const FOAM = hex('#eef6f1');
export const FOAM_SOFT = hex('#cbe4dc');
export const WET_RIM = hex('#4f3d2a');
export const BEACH = ramp('#c9ad78', '#d9c08b', '#e7d2a1');
export const BLOOMS: readonly number[] = Object.freeze([hex('#f2e6a6'), hex('#e9a3b6'), hex('#b9a6e8'), hex('#f4f4f0')]);

/** Escolhe o tom da rampa (índice fracionário já "pontilhado" fora daqui). */
export function pick(r: Ramp, index: number): number {
  const i = index < 0 ? 0 : index >= r.length ? r.length - 1 : Math.floor(index);
  return r[i]!;
}

/** Escurece uma cor (sombra projetada): f = 1 mantém, 0 = preto. */
export function shade(color: number, f: number): number {
  const r = ((color >> 16) & 255) * f;
  const g = ((color >> 8) & 255) * f;
  const b = (color & 255) * f;
  return ((r & 255) << 16) | ((g & 255) << 8) | (b & 255);
}

/** Mistura duas cores (t de 0 a 1). */
export function blend(a: number, b: number, t: number): number {
  const r = ((a >> 16) & 255) + ((((b >> 16) & 255) - ((a >> 16) & 255)) * t);
  const g = ((a >> 8) & 255) + ((((b >> 8) & 255) - ((a >> 8) & 255)) * t);
  const c = (a & 255) + (((b & 255) - (a & 255)) * t);
  return ((r & 255) << 16) | ((g & 255) << 8) | (c & 255);
}

/** Tom contínuo da rampa (mistura os dois tons vizinhos): degradê sem degraus de pixel art. */
export function rampAt(r: Ramp, t: number): number {
  if (t <= 0) return r[0]!;
  const n = r.length - 1;
  if (t >= n) return r[n]!;
  const i = Math.floor(t);
  return blend(r[i]!, r[i + 1]!, t - i);
}

/** Areia molhada na beira da água; poças do brejo; chão de rua; média de uma vila vista de longe. */
export const WET_SAND = hex('#8a7552');
export const PUDDLE = ramp('#16231f', '#1d302b', '#2a4641', '#3c5c57');
export const STREET = ramp('#5a5047', '#6f6457', '#857867', '#9b8d79');
export const TOWN_FAR = hex('#8a6d5a');

// ---------- estilo Mapa (mapa ilustrado pintado à mão: papel, aquarela colorida e tinta sépia) ----------
export const PAPER = hex('#eee3c6');
export const PAPER_LIGHT = hex('#f8f0dc');
export const PAPER_SHADE = hex('#c4ad86');
export const INK = hex('#3a271a');
export const INK_SOFT = hex('#6b4e35');
/** Sombra fria das encostas (a aquarela escurece puxando para o violeta, não para o marrom). */
export const SHADE_COOL = hex('#7f7591');
/** Aguadas por bioma: cores vivas de mapa pintado, sobre o papel. */
export const WASH_PLAIN = hex('#cfd889');
export const WASH_MEADOW = hex('#b7cf78');
export const WASH_FOREST = hex('#94b766');
export const WASH_DESERT = hex('#efcb88');
export const WASH_TUNDRA = hex('#c8ccb2');
export const WASH_SNOW = hex('#f9faf6');
export const WASH_SNOW_SHADE = hex('#c3d2e4');
export const WASH_SWAMP = hex('#9cb88c');
export const WASH_ROCK = hex('#c3ab8e');
export const WASH_HIGH = hex('#d9c38f');
export const WASH_TOWN = hex('#dca486');
/** Mar: do fundo (azul) ao raso (turquesa claro). */
export const WASH_SEA = ramp('#2c5a6e', '#3b6f84', '#55889a', '#80aeb7', '#b5d4d3');
/** Folhagem a tinta: do contorno à luz. */
export const INK_LEAF = ramp('#2c4419', '#3f6324', '#57852f', '#73a23e', '#97c05a', '#c0dc88');
export const INK_LEAF_AUTUMN = ramp('#4a3a17', '#6e5a22', '#93802f', '#b3a142', '#cdbd62', '#e1d690');
export const INK_PINE = ramp('#1b3420', '#28492b', '#3a6239', '#537f4a');
/** Pico pintado: face na luz, face na sombra e o fundo da ravina. */
export const PEAK_LIT = hex('#ecd6c1');
export const PEAK_MID = hex('#c79f86');
export const PEAK_SHADE = hex('#8a5f50');
export const PEAK_DEEP = hex('#5a3c35');
/** Copas vistas de cima, o fundo da mata (entre as árvores desenhadas não aparece papel). */
export const CANOPY_MAP = ramp('#2f4d22', '#3d6029', '#4d7532', '#5f8a3c');
/** Colina pintada: verde na luz, oliva na sombra. */
export const HILL_LIT = hex('#d3dc93');
export const HILL_SHADE = hex('#a3ac69');
