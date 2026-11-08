// SPDX-License-Identifier: MPL-2.0

/**
 * O arquivo `.ekfr`: o formato comum de TODOS os apps da família Ekfrase (especificação completa em
 * `docs/formato-ekfr.md`). É um ZIP com:
 *
 *   mimetype      (1ª entrada, SEM compressão) `application/vnd.ekfrase.ekfr+zip`: dá para reconhecer
 *                 o arquivo lendo os primeiros bytes, como no EPUB e no ODF
 *   ekfr.json     (2ª entrada, sem compressão) o ENVELOPE: de que app é, que tipo de documento, a
 *                 versão do formato do app, quem gravou, título e datas
 *   preview.png   (opcional) a miniatura
 *   …             o resto é do app (o Maker põe manifest.json e doc.crdt)
 *
 * Quem abre um `.ekfr` lê só o envelope (`identificar`) e decide pelo REGISTRO (`registro.ts`) se
 * consegue abrir, se é de outro app (e de qual) ou se é de uma versão mais nova.
 */

import { strFromU8, strToU8, unzipSync, zipSync, type Zippable } from 'fflate';

export const EXTENSAO = '.ekfr';
/** Extensões antigas que ainda abrem (o Maker gravava `.ekfrase` até 11/2026). */
export const EXTENSOES_ANTIGAS: readonly string[] = ['.ekfrase'];
export const TIPO_MIDIA = 'application/vnd.ekfrase.ekfr+zip';
/** Para o `accept` de um <input type="file">. */
export const ACEITA = [EXTENSAO, ...EXTENSOES_ANTIGAS, TIPO_MIDIA].join(',');
/** A versão do ENVELOPE (o que todos os apps entendem). Muda só se o envelope mudar de um jeito incompatível. */
export const VERSAO_ENVELOPE = 1;
/** Limite descompactado por entrada (proteção contra "bombas" de ZIP). */
export const MAX_ENTRADA = 256 * 1024 * 1024;
/** Nomes que o envelope reserva; o app usa qualquer outro. */
export const RESERVADOS: readonly string[] = ['mimetype', 'ekfr.json', 'preview.png'];

/** O envelope (`ekfr.json`). */
export interface Envelope {
  /** Versão do envelope (hoje 1). */
  readonly ekfr: number;
  /** O app dono do documento: o id do registro (`maker`, `vernakula`, `persis`…). */
  readonly app: string;
  /** O tipo de documento dentro do app (`mundo` no Maker). */
  readonly tipo: string;
  /** A versão do formato desse tipo (semver): major novo = o app antigo não abre. */
  readonly formato: string;
  /** Quem gravou: `<app>-<plataforma>@<versão>` (ex.: `maker-web@0.1.0`). */
  readonly gravadoPor: string;
  readonly titulo?: string;
  /** Datas em ISO 8601 (UTC). */
  readonly criado?: string;
  readonly modificado?: string;
}

export type ErroEkfr =
  /** não é um ZIP (ou está estragado) */
  | 'nao-e-ekfr'
  /** é um ZIP, mas sem envelope e sem ser um formato antigo conhecido */
  | 'sem-envelope'
  /** o envelope existe, mas está incompleto ou estragado */
  | 'envelope-invalido'
  /** envelope de uma versão mais nova que esta (atualize o app) */
  | 'envelope-novo'
  /** uma entrada passa do limite descompactado */
  | 'grande';

export class ErroArquivo extends Error {
  readonly codigo: ErroEkfr;
  constructor(codigo: ErroEkfr) {
    super(codigo);
    this.name = 'ErroArquivo';
    this.codigo = codigo;
  }
}

export interface ArquivoEkfr {
  readonly envelope: Envelope;
  /** As entradas do app (sem `mimetype` e `ekfr.json`). */
  readonly arquivos: Readonly<Record<string, Uint8Array>>;
  /** Formato antigo (sem envelope), reconhecido pela forma: o envelope foi deduzido. */
  readonly legado: boolean;
}

const SEMVER = /^(\d+)\.(\d+)\.(\d+)$/;
const ID = /^[a-z][a-z0-9-]{0,39}$/;
/** Data fixa nas entradas do ZIP: mesmo conteúdo = mesmos bytes, em qualquer fuso. */
const DATA_ZIP = new Date(2026, 0, 1, 0, 0, 0);

/** A versão maior de um semver ("1.4.0" → 1). */
export const maior = (v: string): number => Number(SEMVER.exec(v)?.[1] ?? NaN);

function conferirEnvelope(o: unknown): Envelope {
  const e = o as Partial<Envelope> | null;
  if (
    !e ||
    typeof e !== 'object' ||
    !Number.isInteger(e.ekfr) ||
    typeof e.app !== 'string' ||
    !ID.test(e.app) ||
    typeof e.tipo !== 'string' ||
    !ID.test(e.tipo) ||
    typeof e.formato !== 'string' ||
    !SEMVER.test(e.formato) ||
    typeof e.gravadoPor !== 'string'
  ) {
    throw new ErroArquivo('envelope-invalido');
  }
  if (e.ekfr! > VERSAO_ENVELOPE) throw new ErroArquivo('envelope-novo');
  return e as Envelope;
}

/** Grava um `.ekfr`. Mesmos dados = mesmos bytes. */
export function gravarEkfr(envelope: Omit<Envelope, 'ekfr'>, arquivos: Readonly<Record<string, Uint8Array>>, opcoes: { preview?: Uint8Array } = {}): Uint8Array {
  const env = conferirEnvelope({ ekfr: VERSAO_ENVELOPE, ...envelope });
  for (const nome of Object.keys(arquivos)) if (RESERVADOS.includes(nome)) throw new Error(`nome reservado pelo .ekfr: ${nome}`);
  // a ordem das chaves é a ordem no ZIP: mimetype primeiro, depois o envelope
  const z: Zippable = {
    mimetype: [strToU8(TIPO_MIDIA), { level: 0 }],
    'ekfr.json': [strToU8(`${JSON.stringify(env, null, 2)}\n`), { level: 0 }],
  };
  if (opcoes.preview) z['preview.png'] = [opcoes.preview, { level: 0 }];
  for (const [nome, dados] of Object.entries(arquivos)) z[nome] = dados;
  return zipSync(z, { level: 6, mtime: DATA_ZIP });
}

function abrirZip(bytes: Uint8Array): Record<string, Uint8Array> {
  let grande = false;
  let entradas: Record<string, Uint8Array>;
  try {
    entradas = unzipSync(bytes, {
      filter: (f) => {
        if (f.originalSize > MAX_ENTRADA) grande = true;
        return !grande;
      },
    });
  } catch {
    throw new ErroArquivo('nao-e-ekfr');
  }
  if (grande) throw new ErroArquivo('grande');
  return entradas;
}

/**
 * Formatos de ANTES do envelope, reconhecidos pela forma. Hoje só o mundo do Maker (`.ekfrase`:
 * manifest.json com formatVersion/generator/app + doc.crdt). Formato antigo novo = uma entrada aqui.
 */
function envelopeLegado(e: Record<string, Uint8Array>): Envelope | null {
  // basta uma das duas entradas: o Maker confere o resto e diz o que falta (sem manifesto, sem documento…)
  if (!e['manifest.json'] && !e['doc.crdt']) return null;
  let formato = '1.0.0';
  let gravadoPor = 'maker';
  try {
    const m = JSON.parse(strFromU8(e['manifest.json'] ?? new Uint8Array())) as { formatVersion?: unknown; app?: unknown };
    if (typeof m.formatVersion === 'string' && SEMVER.test(m.formatVersion)) formato = m.formatVersion;
    if (typeof m.app === 'string') gravadoPor = m.app;
  } catch {
    // manifesto estragado: o Maker avisa
  }
  return { ekfr: VERSAO_ENVELOPE, app: 'maker', tipo: 'mundo', formato, gravadoPor };
}

/** Abre um `.ekfr` (ou um formato antigo conhecido). Lança `ErroArquivo` com o código. */
export function lerEkfr(bytes: Uint8Array): ArquivoEkfr {
  const e = abrirZip(bytes);
  const bruto = e['ekfr.json'];
  let envelope: Envelope;
  let legado = false;
  if (bruto) {
    let o: unknown;
    try {
      o = JSON.parse(strFromU8(bruto));
    } catch {
      throw new ErroArquivo('envelope-invalido');
    }
    envelope = conferirEnvelope(o);
  } else {
    const l = envelopeLegado(e);
    if (!l) throw new ErroArquivo('sem-envelope');
    envelope = l;
    legado = true;
  }
  const arquivos: Record<string, Uint8Array> = {};
  for (const [nome, dados] of Object.entries(e)) if (nome !== 'mimetype' && nome !== 'ekfr.json') arquivos[nome] = dados;
  return { envelope, arquivos, legado };
}

/** Só o envelope (para decidir quem abre); erro vira código, nunca exceção. */
export function identificar(bytes: Uint8Array): { ok: true; envelope: Envelope; legado: boolean } | { ok: false; erro: ErroEkfr } {
  try {
    const { envelope, legado } = lerEkfr(bytes);
    return { ok: true, envelope, legado };
  } catch (e) {
    if (e instanceof ErroArquivo) return { ok: false, erro: e.codigo };
    throw e;
  }
}

/** O nome de arquivo para baixar: o título limpo + `.ekfr`. */
export function nomeDeArquivo(titulo: string, padrao = 'ekfrase'): string {
  const limpo = titulo
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80);
  return (limpo || padrao) + EXTENSAO;
}
