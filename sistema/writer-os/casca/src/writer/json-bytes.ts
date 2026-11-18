// SPDX-License-Identifier: MPL-2.0

/**
 * JSON que leva BYTES (`Uint8Array`, e o `Buffer` do Node) entre a página e o serviço do Writer OS: o IPC do
 * Electron levava os bytes sozinho; por HTTP eles vão como `{"$bytes":"<base64>"}`. Roda na página e no Node.
 */
const CHAVE = '$bytes';

function paraBase64(b: Uint8Array): string {
  const nativo = (b as Uint8Array & { toBase64?: () => string }).toBase64;
  if (typeof nativo === 'function') return nativo.call(b);
  if (typeof Buffer !== 'undefined') return Buffer.from(b.buffer, b.byteOffset, b.byteLength).toString('base64');
  let s = '';
  for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000));
  return btoa(s);
}

function deBase64(t: string): Uint8Array {
  const nativo = (Uint8Array as unknown as { fromBase64?: (t: string) => Uint8Array }).fromBase64;
  if (typeof nativo === 'function') return nativo(t);
  if (typeof Buffer !== 'undefined') return new Uint8Array(Buffer.from(t, 'base64'));
  const s = atob(t);
  const b = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) b[i] = s.charCodeAt(i);
  return b;
}

export function paraJson(v: unknown): string {
  return JSON.stringify(v, function (this: Record<string, unknown>, k: string, x: unknown) {
    // o `Buffer` tem toJSON: o original (antes dele) está em this[k]
    const original = k === '' ? v : this[k];
    return original instanceof Uint8Array ? { [CHAVE]: paraBase64(original) } : x;
  });
}

export function deJson<T = unknown>(t: string): T {
  return JSON.parse(t, (_k, x: unknown) => {
    if (x && typeof x === 'object' && !Array.isArray(x)) {
      const o = x as Record<string, unknown>;
      const ks = Object.keys(o);
      if (ks.length === 1 && ks[0] === CHAVE && typeof o[CHAVE] === 'string') return deBase64(o[CHAVE]);
    }
    return x;
  }) as T;
}
