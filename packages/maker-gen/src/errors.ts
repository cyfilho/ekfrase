// SPDX-License-Identifier: MPL-2.0

/** Códigos de erro dos geradores; o app traduz por `error.gen.<código>`. */
export type GenErrorCode = 'unknown-generator' | 'invalid-parameter' | 'invalid-world';

export class GenError extends Error {
  readonly code: GenErrorCode;

  constructor(code: GenErrorCode) {
    super(code);
    this.name = 'GenError';
    this.code = code;
  }
}
