// SPDX-License-Identifier: MPL-2.0

/**
 * O Argon2id da senha fora da página (X2): a página não trava enquanto ele trabalha (~0,5 s no PC, alguns segundos
 * num celular fraco) e a barra "Protegendo a sua senha" anda. Recebe `{senha, kdf}` e responde `{progresso}` várias
 * vezes e, no fim, `{entrar, cofre}` (as duas chaves) ou `{erro}`. Quem chama é o `derivar` do `chaves.ts`, que faz a
 * mesma conta na página quando não há Worker.
 */
import { derivarDaSenha, type ParametrosDaSenha } from '@ekfrase/identidade';

type Escopo = {
  onmessage: ((e: MessageEvent<{ senha: string; kdf: ParametrosDaSenha }>) => void) | null;
  postMessage(m: unknown): void;
};
const escopo = self as unknown as Escopo;

escopo.onmessage = (e) => {
  const { senha, kdf } = e.data;
  derivarDaSenha(senha, kdf, { aoProgredir: (f) => escopo.postMessage({ progresso: f }) }).then(
    (k) => escopo.postMessage({ entrar: k.entrar, cofre: k.cofre }),
    () => escopo.postMessage({ erro: 'kdf' }),
  );
};
