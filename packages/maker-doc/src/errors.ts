// SPDX-License-Identifier: MPL-2.0

/**
 * Códigos de erro do documento e do arquivo. Sem texto de interface:
 * o app traduz cada código pela chave `error.doc.<código>`.
 */
export type DocErrorCode =
  | 'invalid-value'
  | 'invalid-property'
  | 'invalid-id'
  | 'duplicate-id'
  | 'unknown-entity'
  | 'unknown-feature'
  | 'unknown-annotation'
  | 'unknown-plugin'
  | 'invalid-command'
  | 'not-an-ekfrase-file'
  /** um .ekfr de outro app da família (o app mostra qual e oferece abrir lá) */
  | 'other-app'
  | 'file-too-large'
  | 'missing-manifest'
  | 'invalid-manifest'
  | 'unsupported-format-version'
  | 'missing-document'
  | 'corrupt-document';

export class DocError extends Error {
  readonly code: DocErrorCode;

  constructor(code: DocErrorCode) {
    super(code);
    this.name = 'DocError';
    this.code = code;
  }
}
