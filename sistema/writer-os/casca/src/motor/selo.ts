// SPDX-License-Identifier: MPL-2.0

/**
 * O SELO (parte do Motor; Bloco F, 25/11/2026): cifrar SEM a senha à mão, abrir só COM ela.
 *
 * Para o que a casca tem de gravar no disco quando os textos estão trancados (o feedback guardado sem
 * internet, que leva o print da tela). Cada pasta tem um par de chaves X25519: a pública fica aberta
 * (`dados/selo.pub`), a privada fica no cofre (cifrada com a senha). Selar = uma chave de uso único
 * (ECDH com a pública) + HKDF-SHA256 + AES-256-GCM; abrir precisa da privada, então só com o cofre aberto.
 * Quem pega o pendrive lê a pública e o arquivo selado, e não abre nenhum dos dois.
 */
import { createCipheriv, createDecipheriv, createPrivateKey, createPublicKey, diffieHellman, generateKeyPairSync, hkdfSync, randomBytes, type KeyObject } from 'node:crypto';

const INFO = Buffer.from('ekfrase-selo-v1');

export interface ParDoSelo {
  /** A pública, SPKI em DER, base64 (fica aberta). */
  publica: string;
  /** A privada, PKCS#8 em DER, base64 (vai ao cofre). */
  privada: string;
}

export function novoPar(): ParDoSelo {
  const { publicKey, privateKey } = generateKeyPairSync('x25519');
  return {
    publica: publicKey.export({ type: 'spki', format: 'der' }).toString('base64'),
    privada: privateKey.export({ type: 'pkcs8', format: 'der' }).toString('base64'),
  };
}

/** A pública que acompanha esta privada (para refazer o `selo.pub` se ele sumiu ou foi trocado). */
export function publicaDaPrivada(privada: string): string {
  return createPublicKey(privadaDe(privada)).export({ type: 'spki', format: 'der' }).toString('base64');
}

const publicaDe =(b64: string): KeyObject => createPublicKey({ key: Buffer.from(b64, 'base64'), type: 'spki', format: 'der' });
const privadaDe = (b64: string): KeyObject => createPrivateKey({ key: Buffer.from(b64, 'base64'), type: 'pkcs8', format: 'der' });

function chaveDe(segredo: Buffer, efemera: Buffer): Buffer {
  return Buffer.from(hkdfSync('sha256', segredo, efemera, INFO, 32));
}

/** Sela `dados` para quem tem a privada do par desta `publica`. A saída é JSON (texto), sem nada legível. */
export function selar(publica: string, dados: Buffer): string {
  const destino = publicaDe(publica);
  const { publicKey, privateKey } = generateKeyPairSync('x25519');
  const efemera = publicKey.export({ type: 'spki', format: 'der' });
  const chave = chaveDe(diffieHellman({ privateKey, publicKey: destino }), efemera);
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', chave, iv);
  const cifrado = Buffer.concat([c.update(dados), c.final()]);
  return JSON.stringify({ v: 1, efemera: efemera.toString('base64'), iv: iv.toString('base64'), tag: c.getAuthTag().toString('base64'), dados: cifrado.toString('base64') });
}

/** Abre o que `selar` fez. Outra chave, arquivo mexido ou estragado: `null`. */
export function abrirSelado(privada: string, selado: string): Buffer | null {
  try {
    const j = JSON.parse(selado) as { v?: unknown; efemera?: unknown; iv?: unknown; tag?: unknown; dados?: unknown };
    if (j.v !== 1 || typeof j.efemera !== 'string' || typeof j.iv !== 'string' || typeof j.tag !== 'string' || typeof j.dados !== 'string') return null;
    const efemera = Buffer.from(j.efemera, 'base64');
    const chave = chaveDe(diffieHellman({ privateKey: privadaDe(privada), publicKey: publicaDe(j.efemera) }), efemera);
    const d = createDecipheriv('aes-256-gcm', chave, Buffer.from(j.iv, 'base64'));
    d.setAuthTag(Buffer.from(j.tag, 'base64'));
    return Buffer.concat([d.update(Buffer.from(j.dados, 'base64')), d.final()]);
  } catch {
    return null;
  }
}
