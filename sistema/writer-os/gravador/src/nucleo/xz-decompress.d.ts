// SPDX-License-Identifier: MPL-2.0
// O xz em WebAssembly (xz-decompress, MIT; o xz-embedded por dentro) não traz os tipos.
declare module 'xz-decompress' {
  export class XzReadableStream extends ReadableStream<Uint8Array> {
    constructor(comprimido: ReadableStream<Uint8Array>);
  }
  const padrao: { XzReadableStream: typeof XzReadableStream };
  export default padrao;
}
