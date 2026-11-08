// SPDX-License-Identifier: MPL-2.0

/**
 * Códigos de erro do núcleo. O núcleo não tem texto de interface:
 * o app traduz cada código pela chave `error.core.<código>` dos arquivos de idioma.
 */
export type CoreErrorCode =
  | 'not-an-integer'
  | 'level-out-of-range'
  | 'coordinate-out-of-range'
  | 'digit-out-of-range'
  | 'no-children-below-level-0'
  | 'no-parent-above-max-level'
  | 'level-mismatch'
  | 'invalid-cell-key'
  | 'invalid-spacing';

export class CoreError extends Error {
  readonly code: CoreErrorCode;

  constructor(code: CoreErrorCode) {
    super(code);
    this.name = 'CoreError';
    this.code = code;
  }
}
