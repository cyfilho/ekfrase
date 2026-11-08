// SPDX-License-Identifier: MPL-2.0
/**
 * Pixel art por código (DEC-P007: nada de IA). Uma grade de cores; formas
 * simples (retângulo, polígono, círculo, linha); contorno automático; e um
 * gravador de PNG sem dependências. Cada desenho do Ekfrase sai daqui.
 *
 * Cores em "#rrggbb". `null` = transparente.
 */
import { crc32, deflateSync } from 'node:zlib';

export class Arte {
  /** @param {number} largura @param {number} altura */
  constructor(largura, altura) {
    this.l = largura;
    this.a = altura;
    /** @type {(string|null)[]} */
    this.px = new Array(largura * altura).fill(null);
  }

  /** Cor fixa ou função (x, y) => cor. */
  #cor(c, x, y) {
    return typeof c === 'function' ? c(x, y) : c;
  }

  pinta(x, y, c) {
    x = Math.floor(x);
    y = Math.floor(y);
    if (x < 0 || y < 0 || x >= this.l || y >= this.a) return;
    const v = this.#cor(c, x, y);
    if (v !== undefined) this.px[y * this.l + x] = v;
  }

  ler(x, y) {
    return x < 0 || y < 0 || x >= this.l || y >= this.a ? null : this.px[y * this.l + x];
  }

  ret(x0, y0, x1, y1, c) {
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) this.pinta(x, y, c);
  }

  /** Polígono pelos centros dos pixels (par-ímpar): bordas limpas, sem "serrilhado duplo". */
  poligono(pts, c) {
    const xs = pts.map((p) => p[0]);
    const ys = pts.map((p) => p[1]);
    for (let y = Math.floor(Math.min(...ys)); y <= Math.ceil(Math.max(...ys)); y++) {
      for (let x = Math.floor(Math.min(...xs)); x <= Math.ceil(Math.max(...xs)); x++) {
        const px = x + 0.5;
        const py = y + 0.5;
        let dentro = false;
        for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
          const [xi, yi] = pts[i];
          const [xj, yj] = pts[j];
          if (yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) dentro = !dentro;
        }
        if (dentro) this.pinta(x, y, c);
      }
    }
  }

  circulo(cx, cy, r, c) {
    for (let y = Math.floor(cy - r); y <= Math.ceil(cy + r); y++)
      for (let x = Math.floor(cx - r); x <= Math.ceil(cx + r); x++) {
        const dx = x + 0.5 - cx;
        const dy = y + 0.5 - cy;
        if (dx * dx + dy * dy <= r * r) this.pinta(x, y, c);
      }
  }

  linha(x0, y0, x1, y1, c) {
    x0 = Math.round(x0);
    y0 = Math.round(y0);
    x1 = Math.round(x1);
    y1 = Math.round(y1);
    const dx = Math.abs(x1 - x0);
    const dy = -Math.abs(y1 - y0);
    const sx = x0 < x1 ? 1 : -1;
    const sy = y0 < y1 ? 1 : -1;
    let e = dx + dy;
    for (;;) {
      this.pinta(x0, y0, c);
      if (x0 === x1 && y0 === y1) break;
      const e2 = 2 * e;
      if (e2 >= dy) {
        e += dy;
        x0 += sx;
      }
      if (e2 <= dx) {
        e += dx;
        y0 += sy;
      }
    }
  }

  /** Todo vazio encostado (4 vizinhos) em algo pintado vira `cor`. */
  contorno(cor) {
    const marcar = [];
    for (let y = 0; y < this.a; y++)
      for (let x = 0; x < this.l; x++) {
        if (this.ler(x, y) !== null) continue;
        const v = [this.ler(x - 1, y), this.ler(x + 1, y), this.ler(x, y - 1), this.ler(x, y + 1)];
        if (v.some((c) => c !== null && c !== cor)) marcar.push([x, y]);
      }
    for (const [x, y] of marcar) this.px[y * this.l + x] = cor;
  }

  espelhada() {
    const n = new Arte(this.l, this.a);
    for (let y = 0; y < this.a; y++) for (let x = 0; x < this.l; x++) n.px[y * n.l + x] = this.ler(this.l - 1 - x, y);
    return n;
  }

  virada() {
    const n = new Arte(this.l, this.a);
    for (let y = 0; y < this.a; y++) for (let x = 0; x < this.l; x++) n.px[y * n.l + x] = this.ler(x, this.a - 1 - y);
    return n;
  }

  /** PNG ampliado sem suavizar; `fundo` pinta o transparente; `margem` em pixels de arte. */
  png(escala, { fundo = null, margem = 0, lado = null } = {}) {
    const lg = (lado ?? this.l + margem * 2) * escala;
    const al = (lado ?? this.a + margem * 2) * escala;
    const ox = lado ? Math.floor((lado - this.l) / 2) : margem;
    const oy = lado ? Math.floor((lado - this.a) / 2) : margem;
    const rgba = Buffer.alloc(lg * al * 4);
    for (let py = 0; py < al; py++)
      for (let px = 0; px < lg; px++) {
        const c = this.ler(Math.floor(px / escala) - ox, Math.floor(py / escala) - oy) ?? fundo;
        if (c === null) continue;
        const i = (py * lg + px) * 4;
        rgba[i] = parseInt(c.slice(1, 3), 16);
        rgba[i + 1] = parseInt(c.slice(3, 5), 16);
        rgba[i + 2] = parseInt(c.slice(5, 7), 16);
        rgba[i + 3] = 255;
      }
    return codificarPng(lg, al, rgba);
  }
}

/** Mistura duas cores "#rrggbb" (t = 0 → a, 1 → b). */
export function mistura(a, b, t) {
  const h = (c, i) => parseInt(c.slice(1 + i * 2, 3 + i * 2), 16);
  const v = [0, 1, 2].map((i) => Math.round(h(a, i) + (h(b, i) - h(a, i)) * t));
  return `#${v.map((n) => n.toString(16).padStart(2, '0')).join('')}`;
}

/** Ruído determinístico (hash de inteiros): textura sem Math.random. */
export function ruido(x, y, semente = 7) {
  let h = (x * 374761393 + y * 668265263 + semente * 2147483647) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}

function codificarPng(largura, altura, rgba) {
  const linhas = Buffer.alloc((largura * 4 + 1) * altura);
  for (let y = 0; y < altura; y++) {
    linhas[y * (largura * 4 + 1)] = 0;
    rgba.copy(linhas, y * (largura * 4 + 1) + 1, y * largura * 4, (y + 1) * largura * 4);
  }
  const bloco = (tipo, dados) => {
    const tam = Buffer.alloc(4);
    tam.writeUInt32BE(dados.length);
    const corpo = Buffer.concat([Buffer.from(tipo, 'ascii'), dados]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(corpo) >>> 0);
    return Buffer.concat([tam, corpo, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(largura, 0);
  ihdr.writeUInt32BE(altura, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    bloco('IHDR', ihdr),
    bloco('IDAT', deflateSync(linhas, { level: 9 })),
    bloco('IEND', Buffer.alloc(0)),
  ]);
}
