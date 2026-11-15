// SPDX-License-Identifier: MPL-2.0

/**
 * UUID v7 (RFC 9562), sem dependência: 48 bits de tempo em ms + 74 bits ao acaso. Ordena por data
 * de criação e é o `id` de todo registro. `idDeterministico` monta um UUID v7 a partir de um tempo
 * e de um texto (SHA-256): é o que dá o MESMO id à cópia de conflito em todos os aparelhos.
 */
import { bytesAoAcaso } from './hlc.ts';

export const REGEX_UUID_V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export const ehUuidV7 = (v: unknown): v is string => typeof v === 'string' && REGEX_UUID_V7.test(v);

function montar(tempo: number, resto: Uint8Array): string {
  const b = new Uint8Array(16);
  const t = Math.max(0, Math.floor(tempo));
  // 48 bits de tempo, do byte mais alto para o mais baixo (sem passar de 2^53)
  const alto = Math.floor(t / 0x100000000) & 0xffff;
  const baixo = t >>> 0;
  b[0] = alto >>> 8;
  b[1] = alto & 0xff;
  b[2] = baixo >>> 24;
  b[3] = (baixo >>> 16) & 0xff;
  b[4] = (baixo >>> 8) & 0xff;
  b[5] = baixo & 0xff;
  for (let i = 0; i < 10; i++) b[6 + i] = resto[i] ?? 0;
  b[6] = (b[6]! & 0x0f) | 0x70; // versão 7
  b[8] = (b[8]! & 0x3f) | 0x80; // variante RFC
  const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

/** Um UUID v7 novo. `agora` (ms) e `aleatorio` podem ser trocados nos testes. */
export function uuidv7(agora: number = Date.now(), aleatorio: (n: number) => Uint8Array = bytesAoAcaso): string {
  return montar(agora, aleatorio(10));
}

/** O tempo (ms) guardado num UUID v7: quando o registro foi criado. */
export function tempoDoUuid(id: string): number {
  return parseInt(id.slice(0, 8) + id.slice(9, 13), 16);
}

/**
 * Um UUID v7 que depende só de `tempo` e de `semente`: os 6 primeiros bytes são o tempo; os outros
 * 10 são os 10 primeiros bytes do SHA-256 da semente (UTF-8), com os bits de versão e variante por cima.
 */
export function idDeterministico(tempo: number, semente: string): string {
  return montar(tempo, sha256(new TextEncoder().encode(semente)));
}

// ---------- SHA-256 (FIPS 180-4), síncrono ----------

const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe,
  0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7,
  0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b,
  0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070, 0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

const gira = (x: number, n: number): number => (x >>> n) | (x << (32 - n));

export function sha256(dados: Uint8Array): Uint8Array {
  const tamanho = dados.length;
  const total = (((tamanho + 9 + 63) >>> 6) << 6) >>> 0;
  const m = new Uint8Array(total);
  m.set(dados);
  m[tamanho] = 0x80;
  const vista = new DataView(m.buffer);
  vista.setUint32(total - 8, Math.floor((tamanho * 8) / 0x100000000));
  vista.setUint32(total - 4, (tamanho * 8) >>> 0);
  const h = new Uint32Array([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]);
  const w = new Uint32Array(64);
  for (let bloco = 0; bloco < total; bloco += 64) {
    for (let i = 0; i < 16; i++) w[i] = vista.getUint32(bloco + i * 4);
    for (let i = 16; i < 64; i++) {
      const a = w[i - 15]!;
      const b = w[i - 2]!;
      const s0 = gira(a, 7) ^ gira(a, 18) ^ (a >>> 3);
      const s1 = gira(b, 17) ^ gira(b, 19) ^ (b >>> 10);
      w[i] = (w[i - 16]! + s0 + w[i - 7]! + s1) >>> 0;
    }
    let [a, b, c, d, e, f, g, hh] = h as unknown as [number, number, number, number, number, number, number, number];
    for (let i = 0; i < 64; i++) {
      const s1 = gira(e, 6) ^ gira(e, 11) ^ gira(e, 25);
      const ch = (e & f) ^ (~e & g);
      const t1 = (hh + s1 + ch + K[i]! + w[i]!) >>> 0;
      const s0 = gira(a, 2) ^ gira(a, 13) ^ gira(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (s0 + maj) >>> 0;
      hh = g;
      g = f;
      f = e;
      e = (d + t1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (t1 + t2) >>> 0;
    }
    h[0] = (h[0]! + a) >>> 0;
    h[1] = (h[1]! + b) >>> 0;
    h[2] = (h[2]! + c) >>> 0;
    h[3] = (h[3]! + d) >>> 0;
    h[4] = (h[4]! + e) >>> 0;
    h[5] = (h[5]! + f) >>> 0;
    h[6] = (h[6]! + g) >>> 0;
    h[7] = (h[7]! + hh) >>> 0;
  }
  const saida = new Uint8Array(32);
  const vs = new DataView(saida.buffer);
  for (let i = 0; i < 8; i++) vs.setUint32(i * 4, h[i]!);
  return saida;
}
