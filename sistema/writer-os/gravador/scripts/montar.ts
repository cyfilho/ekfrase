// SPDX-License-Identifier: MPL-2.0
/**
 * Monta o Gravador do Writer OS. Da raiz do repositório:
 *
 *   npm run gravador                  monta e abre (o Electron desta pasta: `npm ci` aqui antes)
 *   npm run gravador -- --sem-abrir   só monta (dist/)
 *   npm run gravador:pacote           monta e gera o pacote deste sistema (Windows: .exe portátil; Linux: AppImage)
 *
 * O que vai para `dist/`:
 *   pagina/          a tela (Vite + Preact), servida em `app://gravador/`
 *   main.cjs         o processo principal (src/main.ts + o núcleo + a janela travada do Motor)
 *   preload.cjs      a ponte para a página
 *   trabalhador.cjs  o processo que grava, no Linux (Node puro: roda com ELECTRON_RUN_AS_NODE=1)
 */
import { spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, rmSync } from 'node:fs';
import { builtinModules, createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';

export const GRAVADOR = join(dirname(fileURLToPath(import.meta.url)), '..');
export const RAIZ = join(GRAVADOR, '..', '..', '..');
const DIST = join(GRAVADOR, 'dist');
const externos = ['electron', ...builtinModules, ...builtinModules.map((m) => `node:${m}`)];

async function empacotar(entrada: string, nome: string): Promise<void> {
  await build({
    configFile: false,
    root: GRAVADOR,
    logLevel: 'warn',
    resolve: { conditions: ['node'] },
    ssr: { noExternal: true, target: 'node' },
    build: {
      ssr: entrada,
      outDir: DIST,
      emptyOutDir: false,
      target: 'node22',
      minify: false,
      sourcemap: false,
      copyPublicDir: false,
      rollupOptions: { external: externos, output: { format: 'cjs', entryFileNames: `${nome}.cjs`, codeSplitting: false } },
    },
  });
}

export async function montar(): Promise<void> {
  rmSync(DIST, { recursive: true, force: true });
  mkdirSync(DIST, { recursive: true });
  console.log('A tela do Gravador…');
  await build({
    configFile: false,
    root: join(GRAVADOR, 'pagina'),
    base: './',
    logLevel: 'warn',
    resolve: { dedupe: ['preact'] },
    oxc: { jsx: { runtime: 'automatic', importSource: 'preact' } },
    build: { outDir: join(DIST, 'pagina'), emptyOutDir: true, target: 'es2022', sourcemap: false, assetsInlineLimit: 0 },
  });
  cpSync(join(RAIZ, 'apps', 'writer', 'public', 'icones', 'icone-512.png'), join(DIST, 'icone.png'));
  console.log('Processo principal, preload e o trabalhador…');
  await empacotar('src/main.ts', 'main');
  await empacotar('src/preload.ts', 'preload');
  await empacotar('src/trabalhador.ts', 'trabalhador');
  console.log(`Gravador montado em ${DIST}`);
}

/** O executável do Electron desta pasta (`npm ci` em sistema/writer-os/gravador). */
export function electron(): string {
  try {
    return createRequire(join(GRAVADOR, 'package.json'))('electron') as unknown as string;
  } catch {
    throw new Error('O Electron do Gravador não está instalado: rode "npm ci" em sistema/writer-os/gravador.');
  }
}

function pacote(): number {
  const alvo = process.platform === 'win32' ? ['--win', 'portable'] : process.platform === 'linux' ? ['--linux', 'AppImage'] : [];
  if (!alvo.length) throw new Error(`pacote só para Windows e Linux (aqui: ${process.platform})`);
  const bin = join(GRAVADOR, 'node_modules', 'electron-builder', 'cli.js');
  const r = spawnSync(process.execPath, [bin, ...alvo, '--x64', '--publish', 'never', '--config', 'electron-builder.yml'], { cwd: GRAVADOR, stdio: 'inherit', env: { ...process.env, CSC_IDENTITY_AUTO_DISCOVERY: 'false' } });
  return r.status ?? 1;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const args = process.argv.slice(2);
  await montar();
  if (args.includes('--pacote')) process.exit(pacote());
  if (!args.includes('--sem-abrir')) {
    const { ELECTRON_RUN_AS_NODE: _comoNode, ...env } = process.env;
    const r = spawnSync(electron(), [GRAVADOR], { stdio: 'inherit', env });
    process.exit(r.status ?? 0);
  }
}
