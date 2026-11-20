// SPDX-License-Identifier: MPL-2.0
/**
 * Monta a casca do Ekfrase Writer (o app do computador). Da raiz do repositório:
 *
 *   npm run casca                  monta e abre (o Electron desta pasta: `npm ci` aqui antes)
 *   npm run casca -- --sem-abrir   só monta (dist/)
 *   npm run casca:instalador       monta e gera o instalador deste sistema (Windows: NSIS; Linux: AppImage)
 *   node …/montar.ts --os          a pasta da casca para o Writer OS (`electron-builder --linux dir`:
 *                                  `instalador/linux-unpacked/`, que a imagem põe em `/opt/ekfrase-writer`; só no Linux)
 *
 * Opções: `--sem-writer` usa o `apps/writer/dist` que já existe (não faz o build do app de novo).
 *
 * O que vai para `dist/` (é o que o instalador leva):
 *   app/           o build do MESMO `apps/writer` do site (servido em `app://writer/`)
 *   main.cjs       o processo principal (src/writer/main.ts + src/motor + o núcleo do Writer)
 *   preload.cjs    a ponte para a página (sozinho, num arquivo: o preload com sandbox não importa nada)
 *   nativo/        o binário do SQLite cifrado deste sistema (N-API: o mesmo do Node serve no Electron)
 */
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { builtinModules, createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';

export const CASCA = join(dirname(fileURLToPath(import.meta.url)), '..');
export const RAIZ = join(CASCA, '..', '..', '..');
const WRITER = join(RAIZ, 'apps', 'writer');
const DIST = join(CASCA, 'dist');

const externos = ['electron', ...builtinModules, ...builtinModules.map((m) => `node:${m}`)];

/** Um arquivo CommonJS só, sem pedaços (o preload com sandbox não consegue importar outro arquivo). */
async function empacotar(entrada: string, nome: string): Promise<void> {
  await build({
    configFile: false,
    root: CASCA,
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
      rollupOptions: {
        external: externos,
        output: { format: 'cjs', entryFileNames: `${nome}.cjs`, codeSplitting: false },
      },
    },
  });
}

/** O binário do SQLite cifrado da plataforma (`win32-x64`, `linux-x64`…). */
export function binarioNativo(plataforma = `${process.platform}-${process.arch}`): string {
  const pacote = dirname(createRequire(join(RAIZ, 'package.json')).resolve('better-sqlite3-multiple-ciphers/package.json'));
  const f = join(pacote, 'prebuilds', `${plataforma}.node`);
  if (!existsSync(f)) throw new Error(`sem o binário do SQLite para ${plataforma} (${f})`);
  return f;
}

export async function montar(opcoes: { semWriter?: boolean } = {}): Promise<void> {
  if (!opcoes.semWriter || !existsSync(join(WRITER, 'dist', 'index.html'))) {
    console.log('Build do Writer…');
    await build({ root: WRITER, logLevel: 'warn' });
  }
  rmSync(DIST, { recursive: true, force: true });
  mkdirSync(DIST, { recursive: true });
  cpSync(join(WRITER, 'dist'), join(DIST, 'app'), { recursive: true });
  console.log('Processo principal e preload…');
  await empacotar('src/writer/main.ts', 'main');
  await empacotar('src/writer/preload.ts', 'preload');
  // o processo filho que baixa as atualizações (packages/atualizacoes/src/baixador-filho.ts)
  await empacotar('../../../packages/atualizacoes/src/baixador-filho.ts', 'baixador');
  mkdirSync(join(DIST, 'nativo'), { recursive: true });
  cpSync(binarioNativo(), join(DIST, 'nativo', 'better_sqlite3.node'));
  console.log(`Casca montada em ${DIST}`);
}

/** O executável do Electron desta pasta (`npm ci` em sistema/writer-os/casca). */
export function electron(): string {
  try {
    return createRequire(join(CASCA, 'package.json'))('electron') as unknown as string;
  } catch {
    throw new Error('O Electron da casca não está instalado: rode "npm ci" em sistema/writer-os/casca.');
  }
}

function instalador(os = false): number {
  if (os && process.platform !== 'linux') throw new Error('a casca do Writer OS só se monta no Linux (o binário do SQLite é o do Linux)');
  const alvo = os ? ['--linux', 'dir'] : process.platform === 'win32' ? ['--win', 'nsis'] : process.platform === 'linux' ? ['--linux', 'AppImage'] : [];
  if (!alvo.length) throw new Error(`instalador só para Windows e Linux (aqui: ${process.platform})`);
  const bin = join(CASCA, 'node_modules', 'electron-builder', 'cli.js');
  const r = spawnSync(process.execPath, [bin, ...alvo, '--x64', '--publish', 'never', ...configComVersao(process.env['EKFRASE_CASCA_VERSAO'])], { cwd: CASCA, stdio: 'inherit', env: { ...process.env, CSC_IDENTITY_AUTO_DISCOVERY: 'false' } });
  return r.status ?? 1;
}

/**
 * A versão do instalador (U2): o CI do público passa a da tag (`writer-vX.Y.Z[-teste.N]`) em `EKFRASE_CASCA_VERSAO`, e é
 * ela que o `app.getVersion()` devolve (é com ela que a atualização compara). Com a versão, o `-c.extraMetadata` vai no
 * lugar do `--config` (o electron-builder lê o `electron-builder.yml` desta pasta sozinho e põe isto por cima).
 */
export function configComVersao(versao: string | undefined): string[] {
  if (versao === undefined || versao === '') return ['--config', 'electron-builder.yml'];
  if (!/^\d{1,6}\.\d{1,6}\.\d{1,6}(-teste\.\d{1,6})?$/.test(versao)) throw new Error(`versão inválida: ${versao}`);
  return [`-c.extraMetadata.version=${versao}`];
}

// rodado direto
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const args = process.argv.slice(2);
  await montar({ semWriter: args.includes('--sem-writer') });
  if (args.includes('--os')) process.exit(instalador(true));
  if (args.includes('--instalador')) process.exit(instalador());
  if (!args.includes('--sem-abrir')) {
    // sem ELECTRON_RUN_AS_NODE (o VS Code passa =1): com ela, o Electron vira um Node sem a API
    const { ELECTRON_RUN_AS_NODE: _comoNode, ...env } = process.env;
    const r = spawnSync(electron(), [CASCA], { stdio: 'inherit', env });
    process.exit(r.status ?? 0);
  }
}
