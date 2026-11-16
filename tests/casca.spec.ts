// SPDX-License-Identifier: MPL-2.0
/**
 * A CASCA DO COMPUTADOR (sistema/writer-os/casca) de ponta a ponta, só pelo teclado (PLANO §2.4) e
 * sem internet: a casca abre com um servidor que não responde.
 *
 * Primeira vez: a pasta sugerida → a senha (curta é recusada) → o espelho .md ("sempre nesta pasta")
 * → "escrever sem conta" → história, capítulo, cena → escrever. Depois as travas do §7 (janela nova,
 * navegar, Node na página, rede para fora, F12, Ctrl+Shift+I, Ctrl+R), o texto que NÃO aparece no
 * banco (cifrado) e o .md do espelho em dia. Fecha a janela.
 *
 * Segunda vez: pede a senha (a errada é recusada), abre e o texto está lá.
 *
 * Não é teste do Vitest: roda por `npm run teclado` (scripts/teclado.ts), depois do roteiro da web,
 * quando o Electron da casca está instalado (`npm ci` em sistema/writer-os/casca).
 */
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ElectronApplication, Page } from 'playwright';
import { Roteiro, type Resultado } from './teclado.spec.ts';

const SENHA = 'senha dos testes';
const TEXTO = 'Escrito no computador sem internet.';

/** Todos os arquivos de uma pasta (recursivo). */
function arquivos(pasta: string): string[] {
  if (!existsSync(pasta)) return [];
  return readdirSync(pasta).flatMap((n) => {
    const c = join(pasta, n);
    return statSync(c).isDirectory() ? arquivos(c) : [c];
  });
}

type Abrir = (env: Record<string, string>) => Promise<ElectronApplication>;

async function janela(app: ElectronApplication): Promise<Page> {
  const p = await app.firstWindow();
  await p.waitForLoadState('domcontentloaded');
  // o cursor de verdade, parado em cima da janela, geraria eventos de mouse: no teste, a janela os ignora
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.setIgnoreMouseEvents(true));
  // a página conta todo evento de mouse de verdade (o roteiro não emite nenhum)
  await p.evaluate(() => {
    const w = window as unknown as { __mouse: number };
    w.__mouse = 0;
    for (const ev of ['mousedown', 'mouseup', 'mousemove', 'pointerdown', 'pointermove', 'wheel', 'contextmenu', 'dragstart']) {
      addEventListener(ev, (e) => e.isTrusted && w.__mouse++, true);
    }
  });
  return p;
}

/** Fecha pela janela (como o X): a página grava o que falta e a casca sai. */
async function fechar(app: ElectronApplication): Promise<void> {
  const saiu = new Promise<void>((ok) => app.once('close', () => ok()));
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.close());
  await Promise.race([saiu, new Promise((ok) => setTimeout(ok, 15000))]);
}

export async function percorrerCasca(abrir: Abrir, falar: (linha: string) => void = console.log): Promise<Resultado> {
  const base = mkdtempSync(join(tmpdir(), 'ekfrase-casca-'));
  const env = {
    EKFRASE_CASCA_PERFIL: join(base, 'perfil'),
    EKFRASE_CASCA_DOCUMENTOS: join(base, 'Documentos'),
    EKFRASE_CASCA_ESPELHO_MS: '200',
    // sem internet: um servidor que não responde
    EKFRASE_CASCA_SERVIDOR: 'http://127.0.0.1:9/api/v1/',
  };
  const pasta = join(base, 'Documentos', 'Ekfrase Writer');
  const falhas: string[] = [];
  let passos = 0;
  const somar = (r: Roteiro) => {
    passos += r.passos;
    falhas.push(...r.falhas);
  };

  // ================= primeira vez =================
  let app = await abrir(env);
  let p = await janela(app);
  let r = new Roteiro(p, falar);
  const erros: string[] = [];
  p.on('pageerror', (e) => erros.push(e.message));
  try {
    r.ok(await r.esperar('casca-pasta'), 'a casca abre na escolha da pasta');
    await r.passo('escolha da pasta');
    r.ok(await r.focoEm('casca-sugerida'), 'o foco já está em "Usar a pasta sugerida"');
    await r.tecla('Enter');

    r.ok(await r.esperar('casca-criar-senha'), 'pasta nova: pede para criar a senha');
    await r.passo('criar a senha');
    r.ok(await r.focoEm('casca-senha'), 'o foco está no campo da senha');
    await p.keyboard.type('curta');
    await r.tecla('Tab');
    await p.keyboard.type('curta');
    await r.tecla('Enter');
    r.ok(await r.esperar('casca-erro', 3000), 'senha curta é recusada');
    await r.passo('depois da senha curta');
    if (await r.tabAte('casca-senha')) {
      await p.keyboard.press('Control+a');
      await p.keyboard.type(SENHA);
    }
    if (await r.tabAte('casca-senha-repetir')) {
      await p.keyboard.press('Control+a');
      await p.keyboard.type(SENHA);
      await r.tecla('Enter');
    }

    r.ok(await r.esperar('casca-espelho'), 'senha criada: pergunta do espelho .md');
    await r.passo('pergunta do espelho');
    r.ok(await r.focoEm('casca-espelho-nao'), 'o foco começa em "Não" (a cópia não é cifrada)');
    await r.tecla('Shift+Tab');
    r.ok(await r.focoEm('casca-espelho-sempre'), 'Shift+Tab chega em "sempre nesta pasta"');
    await r.tecla('Enter');

    // a tela inicial do app, sem o cartão "baixar para o computador" (já está nele)
    await p.waitForSelector('[data-teste="entrada-outra-forma"]', { timeout: 8000 }).catch(() => null);
    r.ok((await p.$('[data-teste="entrada-computador"]')) === null, 'dentro da casca, a tela inicial não oferece baixar o app');
    if (await r.tabAte('entrada-outra-forma')) await r.tecla('Enter');
    r.ok(await r.esperar('tela-estante'), '"escrever sem conta" abre a estante');
    await r.passo('estante');

    if (await r.tabAte('nova-historia')) await r.tecla('Enter');
    r.ok(await r.esperar('tela-historia'), 'nova história');
    if (await r.comando('novo-capitulo')) r.ok(await r.esperar('linha-capitulo'), 'capítulo novo');
    if (!(await r.focoEm('linha-capitulo'))) await r.tabAte('linha-capitulo');
    await r.tecla('Control+Enter');
    r.ok(await r.esperar('linha-cena'), 'cena nova');
    // o foco vai para a cena nova logo depois de ela aparecer: espera chegar antes do Enter
    await p.waitForFunction(() => document.activeElement?.getAttribute('data-teste') === 'linha-cena', null, { timeout: 5000 }).catch(() => null);
    if (!(await r.focoEm('linha-cena'))) await r.tabAte('linha-cena');
    await r.tecla('Enter');
    r.ok(await r.esperar('tela-escrever'), 'a folha abre');
    r.ok(await r.esperar('editor'), 'o texto da cena aparece');
    await r.passo('folha aberta');
    await p.keyboard.type(TEXTO, { delay: 4 });
    await p
      .waitForFunction(() => document.querySelector('[data-teste="gravacao"]')?.getAttribute('data-estado') === 'salvo', null, { timeout: 6000 })
      .catch(() => null);
    r.ok((await p.getAttribute('[data-teste="gravacao"]', 'data-estado')) === 'salvo', 'o texto foi gravado sem internet');

    // ---- as travas (PLANO §7)
    const pagina = await p.evaluate(async () => {
      const w = window as unknown as Record<string, unknown>;
      const aberta = window.open('https://example.com/', '_blank');
      let rede = 'aberta';
      try {
        await fetch('https://example.com/', { mode: 'no-cors' });
      } catch {
        rede = 'bloqueada';
      }
      return { janela: aberta === null, require: typeof w['require'], process: typeof w['process'], rede };
    });
    r.ok(pagina.janela, 'window.open não abre janela nenhuma');
    r.ok(pagina.require === 'undefined' && pagina.process === 'undefined', 'a página não tem Node (require, process)');
    r.ok(pagina.rede === 'bloqueada', 'a página não sai para a internet');
    await p.evaluate(() => {
      location.href = 'https://example.com/';
    });
    await p.waitForTimeout(600);
    r.ok(p.url().startsWith('app://writer/'), `navegar para fora não sai do app (${p.url()})`);
    await p.evaluate(() => ((window as unknown as { __marca: number }).__marca = 1));
    // as teclas do navegador entram como as de um teclado de verdade (pelo processo principal: as do
    // Playwright entram por fora do before-input-event e não servem para provar a trava)
    await app.evaluate(({ BrowserWindow }) => {
      const wc = BrowserWindow.getAllWindows()[0]?.webContents;
      const teclas: [string, ('control' | 'shift')[]][] = [['F12', []], ['I', ['control', 'shift']], ['R', ['control']], ['O', ['control']], ['F5', []]];
      for (const [keyCode, modifiers] of teclas) {
        wc?.sendInputEvent({ type: 'keyDown', keyCode, modifiers });
        wc?.sendInputEvent({ type: 'keyUp', keyCode, modifiers });
      }
    });
    await p.waitForTimeout(800);
    const principal = await app.evaluate(({ BrowserWindow }) => {
      const ws = BrowserWindow.getAllWindows();
      const travas = (globalThis as unknown as { ekfraseCasca?: { travas: { bloqueado: { tipo: string }[] } } }).ekfraseCasca?.travas.bloqueado ?? [];
      return { janelas: ws.length, devtools: ws.some((w: { webContents: { isDevToolsOpened(): boolean } }) => w.webContents.isDevToolsOpened()), tipos: [...new Set(travas.map((b) => b.tipo))] };
    });
    r.ok(principal.janelas === 1, `uma janela só (${principal.janelas})`);
    r.ok(!principal.devtools, 'F12 e Ctrl+Shift+I não abrem o DevTools');
    r.ok(['janela', 'navegar', 'tecla'].every((t) => principal.tipos.includes(t)), `a casca anotou os bloqueios (${principal.tipos.join(', ')})`);
    r.ok((await p.evaluate(() => (window as unknown as { __marca?: number }).__marca)) === 1, 'Ctrl+R e F5 não recarregaram a página');
    r.ok((await p.$('[data-teste="ideia-texto"]')) === null, 'Ctrl+Shift+I não chegou ao app');
    await r.passo('depois das teclas proibidas');

    // ---- espelho .md em dia, e o banco cifrado
    await p.waitForTimeout(1200);
    const mds = arquivos(join(pasta, 'espelho')).filter((f) => f.endsWith('.md'));
    r.ok(mds.some((f) => readFileSync(f, 'utf8').includes(TEXTO)), `o espelho .md tem o texto (${mds.length} arquivos .md)`);
    const bancos = arquivos(join(pasta, 'dados'));
    r.ok(bancos.some((f) => /textos-local\.db$/.test(f)), 'o banco do dono "local" existe');
    r.ok(!bancos.some((f) => readFileSync(f).includes(Buffer.from('Escrito no computador'))), 'o texto não aparece legível em nenhum arquivo do banco (cifrado)');

    r.ok((await r.mouse()) === 0, 'nenhum evento de mouse');
    r.ok(erros.length === 0, `nenhum erro na página (${erros.join(' | ')})`);
  } finally {
    somar(r);
    await fechar(app);
  }

  // ================= segunda vez: a senha =================
  app = await abrir(env);
  p = await janela(app);
  r = new Roteiro(p, falar);
  try {
    r.ok(await r.esperar('casca-abrir'), 'a casca lembra a pasta e pede a senha');
    await r.passo('pedir a senha');
    await p.keyboard.type('senha errada');
    await r.tecla('Enter');
    r.ok(await r.esperar('casca-erro', 4000), 'a senha errada é recusada');
    await r.passo('depois da senha errada');
    if (await r.tabAte('casca-senha')) {
      await p.keyboard.press('Control+a');
      await p.keyboard.type(SENHA);
      await r.tecla('Enter');
    }
    // "sempre nesta pasta": não pergunta de novo; e o "escrever sem conta" foi lembrado
    r.ok(await r.esperar('tela-estante'), 'com a senha certa, abre direto na estante (sem perguntar o espelho de novo)');
    await r.passo('estante, de novo');
    const guardado = await p.evaluate(async () => {
      const c = (window as unknown as { ekfraseCasca: { armazem: { abrir(d: string): Promise<string>; chamar(a: string, m: string, x: unknown[]): Promise<unknown> } } }).ekfraseCasca;
      const alca = await c.armazem.abrir('local');
      return JSON.stringify(await c.armazem.chamar(alca, 'listar', ['cenas']));
    });
    r.ok(guardado.includes(TEXTO), 'o texto escrito na primeira vez está lá');
    r.ok((await r.mouse()) === 0, 'nenhum evento de mouse (segunda vez)');
  } finally {
    somar(r);
    await fechar(app);
    rmSync(base, { recursive: true, force: true });
  }
  return { passos, falhas };
}
