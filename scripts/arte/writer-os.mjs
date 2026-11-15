// SPDX-License-Identifier: MPL-2.0
/**
 * A arte do Writer OS e do Gravador, por código (DEC-P007/P038):
 *   node scripts/arte/writer-os.mjs
 *
 * - A tela do boot (Plymouth, tema "script" `raiz/usr/share/plymouth/themes/ekfrase/`): 16 quadros
 *   `tinta-N.png` da pena escrevendo uma linha na pauta embaixo da logo; no fim a linha esmaece e
 *   a pena começa de novo. Fundo transparente (o fundo azul-noite é do script).
 * - A tela de abertura do Gravador (`gravador/recursos/splash.bmp`, o `portable.splashImage` do
 *   electron-builder): a logo do Writer, a seta pontilhada e o pendrive, no azul-noite.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Arte, mistura, ruido } from './pixel.mjs';
import { W, logoWriter } from './gerar.mjs';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const TEMA = join(RAIZ, 'sistema', 'writer-os', 'imagem', 'raiz', 'usr', 'share', 'plymouth', 'themes', 'ekfrase');
const GRAVADOR = join(RAIZ, 'sistema', 'writer-os', 'gravador', 'recursos');

function gravar(pasta, nome, dados) {
  mkdirSync(pasta, { recursive: true });
  writeFileSync(join(pasta, nome), dados);
  console.log(`  ${join(pasta, nome).slice(RAIZ.length + 1)}`);
}

export const QUADROS = 16;
const ESCREVENDO = 12;
const BASE = 24;

/** A altura da letra em x (uma "letra cursiva" de mentira, sempre a mesma). */
const alturaEm = (x) => Math.round(BASE - 3 - 2.2 * Math.sin(x * 1.15) - (ruido(x, 1) > 0.8 ? 1 : 0));
const espaco = (x) => x % 17 >= 14;

/** A pena com a ponta em (tx, ty): o bico sépia, a haste e as barbas claras (no fundo escuro). */
function pena(a, tx, ty) {
  a.poligono([[tx + 4, ty - 4], [tx + 8, ty - 12], [tx + 13, ty - 19], [tx + 16, ty - 18], [tx + 13, ty - 11], [tx + 8, ty - 4]], (x, y) => (x + y > tx + ty + 3 ? W.penaS : W.pena));
  a.linha(tx + 2, ty - 2, tx + 15, ty - 20, W.papelE);
  a.pinta(tx, ty, W.sepiaE);
  a.pinta(tx + 1, ty - 1, W.sepia);
  a.pinta(tx + 2, ty - 1, W.sepia);
  a.pinta(tx + 1, ty - 2, W.sepia);
  a.pinta(tx + 2, ty - 2, W.sepiaE);
}

export function quadroDaTinta(k) {
  const a = new Arte(92, 28);
  const fim = k < ESCREVENDO ? 4 + Math.round((k + 1) * 5.5) : 70;
  const cor = k < ESCREVENDO ? W.papel : mistura(W.papel, W.noiteC, (k - ESCREVENDO + 1) / (QUADROS - ESCREVENDO + 1));
  let antes = null;
  for (let x = 4; x <= fim; x++) {
    if (espaco(x)) {
      antes = null;
      continue;
    }
    const y = alturaEm(x);
    if (antes === null) a.pinta(x, y, cor);
    else a.linha(x - 1, antes, x, y, cor);
    antes = y;
  }
  if (k < ESCREVENDO) pena(a, fim, alturaEm(fim));
  a.contorno(W.tinta);
  a.ret(2, BASE, 74, BASE, W.noiteC);
  return a;
}

/** O pendrive (deitado, o conector à esquerda). */
function pendrive() {
  const a = new Arte(34, 16);
  a.ret(0, 4, 7, 11, (x, y) => (y === 4 ? '#e6e9ef' : '#b9c0cc'));
  a.ret(2, 6, 3, 7, W.noite);
  a.ret(5, 6, 6, 7, W.noite);
  a.ret(8, 1, 33, 14, (x, y) => (y < 3 ? W.noiteC : y > 12 ? '#141a2e' : '#273258'));
  a.ret(14, 5, 27, 10, W.papel);
  a.ret(15, 7, 24, 7, W.linha);
  a.ret(15, 9, 21, 9, W.linha);
  a.contorno(W.tinta);
  return a;
}

function abertura() {
  const a = new Arte(126, 80);
  a.colar(logoWriter(), 6, 8);
  for (let x = 72; x <= 80; x += 3) a.ret(x, 40, x + 1, 41, W.papelS);
  a.poligono([[82, 36], [86, 40.5], [82, 45]], W.papelS);
  a.colar(pendrive(), 86, 33);
  return a;
}

console.log('Gravando a arte do Writer OS:');
for (let k = 0; k < QUADROS; k++) gravar(TEMA, `tinta-${k}.png`, quadroDaTinta(k).png(3));
gravar(GRAVADOR, 'splash.bmp', abertura().bmp(4, W.noite));
