// SPDX-License-Identifier: MPL-2.0

/**
 * PEDIR A PERMISSÃO DE ADMINISTRADOR, uma vez por gravação (PLANO §8b): a janela abre um canal local
 * com um token sorteado, escreve a tarefa num arquivo numa pasta só dela e roda o processo que grava:
 *
 * - Windows: o próprio executável do Gravador com `--ekfrase-trabalhador <tarefa>`, pelo
 *   `Start-Process -Verb RunAs` (a janela padrão do Windows, "Deseja permitir…?");
 * - Linux: `pkexec /usr/bin/env ELECTRON_RUN_AS_NODE=1 <AppImage ou electron> <trabalhador.cjs> <tarefa>`
 *   (o root não lê dentro do AppImage montado pelo usuário, então o trabalhador vai numa cópia).
 *
 * Simulado (testes): o trabalhador roda aqui mesmo, sem elevar.
 */
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createServer, type Socket } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Aviso } from './nucleo/gravar.ts';
import { rodarTrabalhador, type FimComputador, type Mensagem, type Pedido } from './nucleo/trabalhador.ts';

export type Resultado = { ok: true; dados: string | null; computador?: FimComputador } | { ok: false; erro: string; detalhe?: string };

export interface OpcoesElevar {
  pedido: Omit<Pedido, 'canal' | 'token'>;
  /** O executável a rodar elevado (Windows: o do Gravador; Linux: o AppImage ou o electron). */
  executavel: string;
  /** Linux: o `dist/trabalhador.cjs`. */
  trabalhador?: string;
  aviso: (a: Aviso | { fase: 'computador'; etapa: string }) => void;
  /** Roda aqui mesmo, sem pedir permissão (só os testes e o desenvolvimento). */
  semElevar?: boolean;
}

/** As pastas `ekfrase-gravador-*` que sobraram de uma gravação que travou ou foi morta (Bloco E): com mais de 1 hora, saem. */
export function limparTemporarios(raiz = tmpdir(), idadeMs = 3_600_000): void {
  try {
    for (const n of readdirSync(raiz)) {
      if (!n.startsWith('ekfrase-gravador-')) continue;
      const p = join(raiz, n);
      try {
        const st = statSync(p);
        if (st.isDirectory() && Date.now() - st.mtimeMs > idadeMs) rmSync(p, { recursive: true, force: true });
      } catch {
        /* em uso ou sem permissão: fica */
      }
    }
  } catch {
    /* sem temporário legível */
  }
}

export async function gravarElevado(o: OpcoesElevar): Promise<Resultado> {
  limparTemporarios();
  const pasta = mkdtempSync(join(tmpdir(), 'ekfrase-gravador-'));
  const token = randomBytes(24).toString('hex');
  const canal = process.platform === 'win32' ? `\\\\.\\pipe\\ekfrase-gravador-${randomBytes(12).toString('hex')}` : join(pasta, 'canal');
  let fim: Resultado | null = null;
  let ligou = false;
  const servidor = createServer((s: Socket) => {
    let resto = '';
    let conferido = false;
    s.setEncoding('utf8');
    s.on('data', (d: string) => {
      resto += d;
      let i: number;
      while ((i = resto.indexOf('\n')) >= 0) {
        const linha = resto.slice(0, i);
        resto = resto.slice(i + 1);
        let m: Mensagem;
        try {
          m = JSON.parse(linha) as Mensagem;
        } catch {
          s.destroy();
          return;
        }
        if (!conferido) {
          if (!('token' in m) || m.token !== token) {
            s.destroy();
            return;
          }
          conferido = true;
          ligou = true;
          continue;
        }
        if ('aviso' in m) o.aviso(m.aviso);
        else if ('fim' in m) fim = m.ok ? { ok: true, dados: m.dados, ...(m.computador ? { computador: m.computador } : {}) } : { ok: false, erro: m.erro, detalhe: m.detalhe };
      }
    });
    s.on('error', () => undefined);
  });
  await new Promise<void>((ok, nao) => {
    servidor.once('error', nao);
    servidor.listen(canal, () => ok());
  });
  const tarefa = join(pasta, 'tarefa.json');
  writeFileSync(tarefa, JSON.stringify({ ...o.pedido, canal, token } satisfies Pedido), { mode: 0o600 });
  try {
    let codigo: number;
    if (o.semElevar) codigo = await rodarTrabalhador(tarefa);
    else codigo = await rodarElevado(o, pasta, tarefa);
    // as últimas mensagens podem chegar logo depois de o processo sair (e, quando a tarefa é rápida, até o token:
    // o trabalhador já saiu e o canal ainda não leu nada; o "remover" simulado caía aqui no CI do Linux, 18/11)
    for (let i = 0; i < 20 && !fim && (ligou || codigo === 0); i++) await new Promise((r) => setTimeout(r, 100));
    if (fim) return fim;
    if (!ligou) return { ok: false, erro: codigo === -2 ? 'sem-pkexec' : 'permissao-recusada', detalhe: `saída ${codigo}` };
    return { ok: false, erro: 'escrita', detalhe: `o processo saiu (${codigo}) sem terminar` };
  } finally {
    servidor.close();
    rmSync(pasta, { recursive: true, force: true });
  }
}

function rodarElevado(o: OpcoesElevar, pasta: string, tarefa: string): Promise<number> {
  return new Promise((ok) => {
    let filho;
    if (process.platform === 'win32') {
      const q = (s: string) => `'${s.replace(/'/g, "''")}'`;
      // -ArgumentList recebe uma linha de comando: o caminho da tarefa vai entre aspas duplas
      const script = `try { $p = Start-Process -FilePath ${q(o.executavel)} -ArgumentList @('--ekfrase-trabalhador', ${q(`"${tarefa}"`)}) -Verb RunAs -WindowStyle Hidden -PassThru -Wait; exit $p.ExitCode } catch { exit 1223 }`;
      filho = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script], { windowsHide: true, stdio: 'ignore' });
    } else {
      if (!o.trabalhador) throw new Error('sem o trabalhador.cjs');
      const copia = join(pasta, 'trabalhador.cjs');
      // ler e escrever (não copyFile): o original pode estar dentro do app.asar
      writeFileSync(copia, readFileSync(o.trabalhador), { mode: 0o600 });
      filho = spawn('pkexec', ['/usr/bin/env', 'ELECTRON_RUN_AS_NODE=1', o.executavel, copia, tarefa], { stdio: 'ignore' });
    }
    filho.on('error', (e: NodeJS.ErrnoException) => ok(e.code === 'ENOENT' ? -2 : 127));
    filho.on('exit', (c) => ok(c ?? 1));
  });
}
