// SPDX-License-Identifier: MPL-2.0
/**
 * O WRITER OS SIMULADO (a casca com `EKFRASE_CASCA_OS=simulado`), só pelo teclado: a conferência que dá
 * para fazer fora do pendrive e do QEMU (no Windows também). O sistema de verdade (Cage, Debian, as
 * travas do §7) é testado pelo CI no QEMU (`tests/writer-os/qemu.py`).
 *
 * 1. Com a partição de dados: idioma → teclado → fuso (Enter em cada um: a opção padrão) → senha →
 *    espelho → Wi-Fi ("seguir") → escrever sem conta. O agente de teste conta tudo no relato (texto
 *    falta, usb ok, interno negado, gravado N). Ctrl+Alt+S abre o painel do sistema. O `sistema.json`
 *    fica ao lado dos textos. Fecha e abre de novo: só a senha, e o agente diz "texto ok".
 * 2. Sem a partição de dados: "onde guardar" → a memória → a faixa âmbar → "guardar num pendrive"
 *    → os textos vão para o OUTRO e a senha (a mesma) abre de novo, já lá.
 *
 * 3. Tudo Ekfrase (PLANO §6.5): nenhuma tela tem link para fora do app nem seletor de arquivos do sistema,
 *    "Desligar" está à vista no topo, e importar e salvar passam pela tela dos pendrives (só teclado).
 *
 * Os prints de cada tela vão para `EKFRASE_PRINTS_OS` (se houver). Roda por `npm run teclado -- --so-os`.
 */
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import type { BrowserType, ElectronApplication, Page } from 'playwright';
import { Roteiro, type Resultado } from './teclado.spec.ts';

const SENHA = 'escrever2026';

/** Uma vez da casca do Writer OS aberta: a página e como fechar (gravando o que falta, como no Cage). */
export interface SessaoOS {
  pagina(): Promise<Page>;
  fechar(): Promise<void>;
}
type Abrir = (env: Record<string, string>) => Promise<SessaoOS>;

async function janela(app: ElectronApplication): Promise<Page> {
  const p = await app.firstWindow();
  await p.waitForLoadState('domcontentloaded');
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.setIgnoreMouseEvents(true));
  return p;
}

/** Troca de tela como o app faz (caminho limpo, sem recarregar; a janela da casca nunca navega de verdade). */
const irPara = (p: Page, caminho: string): Promise<void> =>
  p.evaluate((c) => {
    history.pushState(null, '', c);
    dispatchEvent(new PopStateEvent('popstate'));
  }, caminho);

async function fechar(app: ElectronApplication): Promise<void> {
  const saiu = new Promise<void>((ok) => app.once('close', () => ok()));
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.close());
  await Promise.race([saiu, new Promise((ok) => setTimeout(ok, 15000))]);
}

/** A casca de antes (o Electron com `EKFRASE_CASCA_OS=simulado`). */
export const abrirComElectron =
  (lancar: (env: Record<string, string>) => Promise<ElectronApplication>): Abrir =>
  async (env) => {
    const app = await lancar(env);
    return { pagina: () => janela(app), fechar: () => fechar(app) };
  };

/**
 * A casca SEM o Electron (prompt P3): o serviço do Writer OS (`instalador/writer-os/servico-os.cjs`) no Node e, no
 * lugar do Cog, o WebKit do Playwright (o mesmo motor do WPE) com a ponte da página injetada antes de tudo, como o
 * Cog faz. Fechar = "fechar" na entrada do serviço (a página grava o que falta, os bancos fecham).
 */
export const abrirComCog =
  (servico: string, webkit: BrowserType, porta: number): Abrir =>
  async (env) => {
    const filho = spawn(process.execPath, [servico], {
      env: { ...process.env, ...env, EKFRASE_CASCA_NAVEGADOR: 'nenhum', EKFRASE_CASCA_PORTA: String(porta) },
      stdio: ['pipe', 'pipe', 'inherit'],
    });
    const saiu = new Promise<void>((ok) => filho.once('exit', () => ok()));
    let saida = '';
    const ponte = await new Promise<string>((ok, falhou) => {
      filho.stdout.on('data', (d: Buffer) => {
        saida += String(d);
        const m = /ekfrase-servico pronto \S+ (.+)/.exec(saida);
        if (m?.[1]) ok(m[1].trim());
      });
      void saiu.then(() => falhou(new Error(`o serviço saiu antes de ficar pronto: ${saida}`)));
    });
    const navegador = await webkit.launch();
    const contexto = await navegador.newContext({ viewport: { width: 1280, height: 800 } });
    await contexto.addInitScript({ path: ponte });
    const p = await contexto.newPage();
    await p.goto(`http://127.0.0.1:${porta}/writer/`);
    await p.waitForLoadState('domcontentloaded');
    return {
      pagina: async () => p,
      fechar: async () => {
        filho.stdin.write('fechar' + String.fromCharCode(10));
        await Promise.race([saiu, new Promise((ok) => setTimeout(ok, 15000))]);
        if (filho.exitCode === null) filho.kill();
        await navegador.close();
      },
    };
  };

const lerRelato = (raiz: string): string => {
  try {
    return readFileSync(join(raiz, 'run', 'teste', 'relato'), 'utf8');
  } catch {
    return '';
  }
};

async function esperarRelato(raiz: string, linha: string | RegExp, ms = 15000): Promise<boolean> {
  const fim = Date.now() + ms;
  while (Date.now() < fim) {
    const r = lerRelato(raiz);
    if (typeof linha === 'string' ? r.split('\n').includes(linha) : linha.test(r)) return true;
    await new Promise((ok) => setTimeout(ok, 200));
  }
  return false;
}

export async function percorrerCascaOS(abrir: Abrir, falar: (linha: string) => void = console.log): Promise<Resultado> {
  const prints = process.env['EKFRASE_PRINTS_OS'];
  if (prints) mkdirSync(prints, { recursive: true });
  const falhas: string[] = [];
  let passos = 0;
  const somar = (r: Roteiro) => {
    passos += r.passos;
    falhas.push(...r.falhas);
  };
  const foto = async (p: Page, nome: string) => {
    if (prints) await p.screenshot({ path: join(prints, `${nome}.png`) });
  };

  /** O que, na tela, leva para fora do app (um link que não é interno) ou abre o seletor de arquivos do sistema. */
  // links para dentro do app (`/writer/...`, caminho limpo) não são saída: o app troca de tela sem recarregar
  const saidas = (pg: Page): Promise<string[]> =>
    pg.evaluate(() => [
      ...[...document.querySelectorAll('a[href]')].map((a) => a.getAttribute('href') ?? '').filter((h) => !(h.startsWith('#') || /^\/writer(\/[^#]*)?$/.test(h))),
      ...[...document.querySelectorAll('a[target="_blank"], input[type="file"], form[action]')].map((e) => e.tagName.toLowerCase()),
    ]);

  const base = mkdtempSync(join(tmpdir(), 'ekfrase-os-'));
  const comum = { EKFRASE_CASCA_OS: 'simulado', EKFRASE_CASCA_SERVIDOR: 'http://127.0.0.1:9/api/v1/', EKFRASE_CASCA_ESPELHO_MS: '200' };

  /** Uma tela do primeiro uso: espera, confere o foco, tira o print e aperta Enter (a opção padrão). */
  const enter = async (r: Roteiro, teste: string, nome: string, relato?: string) => {
    const veio = await r.esperar(teste, 10000);
    r.ok(veio, `a tela "${teste}" aparece`);
    if (!veio) return;
    // como o QEMU: só digita depois de o agente de teste contar que a tela abriu
    if (relato) r.ok(await esperarRelato(relato, `tela ${teste}`), `o agente de teste viu "${teste}"`);
    await r.passo(`${teste}: o foco começa na opção padrão`);
    await foto(r.p, nome);
    await r.tecla('Enter');
  };

  const senhaNova = async (r: Roteiro) => {
    r.ok(await r.esperar('casca-criar-senha', 10000), 'a senha nova aparece (o app abriu)');
    await r.passo('o foco está na senha');
    await foto(r.p, '04-senha');
    await r.p.keyboard.type(SENHA);
    if (await r.tabAte('casca-senha-repetir')) await r.p.keyboard.type(SENHA);
    await r.tecla('Enter');
  };

  // ================= 1. com a partição de dados =================
  const raiz1 = join(base, 'pendrive');
  const env1 = { ...comum, EKFRASE_CASCA_OS_RAIZ: raiz1, EKFRASE_CASCA_OS_DADOS: 'pendrive', EKFRASE_CASCA_OS_TESTE: '1', EKFRASE_CASCA_PERFIL: join(raiz1, 'perfil') };
  // o 2º pendrive já tem um arquivo para importar (o Writer só mostra .ekfr, .md, .txt e .zip)
  const pendrive = join(raiz1, 'media', 'OUTRO');
  mkdirSync(pendrive, { recursive: true });
  writeFileSync(join(pendrive, 'conto.md'), ['# O conto', '', 'Havia uma vez um pendrive.', ''].join(String.fromCharCode(10)));
  let app = await abrir(env1);
  let p = await app.pagina();
  let r = new Roteiro(p, falar);
  falar('— Writer OS (simulado), com a partição de dados: o primeiro uso');
  await enter(r, 'os-idioma', '01-idioma', raiz1);
  await enter(r, 'os-teclado', '02-teclado', raiz1);
  await enter(r, 'os-fuso', '03-fuso', raiz1);
  await senhaNova(r);
  await enter(r, 'casca-espelho', '05-espelho');
  await enter(r, 'os-wifi', '06-wifi');
  await p.waitForSelector('[data-teste="entrada-outra-forma"]', { timeout: 10000 }).catch(() => null);
  await foto(p, '07-conta');
  r.ok((await saidas(p)).length === 0, `a tela inicial não leva a lugar nenhum fora do app (${(await saidas(p)).join(', ')})`);
  r.ok((await p.$('[data-teste="botao-passeio"]')) === null && (await p.$('a[href*="torre"]')) === null, 'no Writer OS não há o botão do modo jogo');
  if (await r.tabAte('entrada-outra-forma')) await r.tecla('Enter');
  r.ok(await r.esperar('nova-historia', 10000), 'a estante abre (escrever sem conta)');
  r.ok(await esperarRelato(raiz1, 'texto falta'), 'o agente: na primeira vez, o texto de teste não existe');
  r.ok(await esperarRelato(raiz1, 'usb ok'), 'o agente: o 2º pendrive monta e aceita um arquivo');
  r.ok(await esperarRelato(raiz1, 'interno negado'), 'o agente: o disco interno não monta');
  r.ok(await esperarRelato(raiz1, 'gravado 5'), 'o agente: o laço de gravação anda');
  r.ok(await esperarRelato(raiz1, 'integridade ok'), 'o agente: o banco está íntegro');
  const sistemaJson = join(raiz1, 'dados', 'Ekfrase Writer', 'sistema.json');
  let sj: Record<string, unknown> = {};
  try {
    sj = JSON.parse(readFileSync(sistemaJson, 'utf8')) as Record<string, unknown>;
  } catch {
    // fica vazio
  }
  r.ok(sj['idioma'] === 'pt-BR' && sj['teclado'] === 'br' && sj['fuso'] === 'America/Sao_Paulo' && sj['wifiVisto'] === true, `o sistema.json fica ao lado dos textos (${JSON.stringify(sj)})`);
  r.ok(existsSync(join(raiz1, 'dados', 'Ekfrase Writer', 'dados', 'cofre.db')), 'os textos estão na partição de dados (a mesma pasta do computador)');

  // as abas do topo: "Início" antes de todas (18/11)
  const abas = await p.$$eval('.topo-nav a', (l) => l.map((a) => a.getAttribute('data-teste')));
  r.ok(abas[0] === 'nav-inicio', `a primeira aba é "Início" (${abas.join(', ')})`);

  // o menu do sistema (18/11): Ctrl+Alt+S ou a engrenagem; Desligar e Reiniciar em cima, a conta, o resto
  await r.tecla('Control+Alt+s');
  const menu = await r.esperar('menu-sistema', 5000);
  r.ok(menu, 'Ctrl+Alt+S abre o menu do sistema');
  if (menu) {
    await r.passo('o foco começa no menu', 'menu-sistema');
    r.ok(await r.focoEm('os-desligar'), 'o foco começa em Desligar, no alto do menu');
    const itens = await p.$$eval('[data-teste="menu-sistema"] [role="menuitem"]', (l) => l.map((e) => e.getAttribute('data-teste') ?? ''));
    r.ok(itens[0] === 'os-desligar' && itens[1] === 'os-reiniciar' && itens[2] === 'os-conta-entrar', `Desligar e Reiniciar em cima, depois a conta (${itens.join(', ')})`);
    for (const s of ['os-menu-wifi', 'os-menu-energia', 'os-menu-teclado', 'os-menu-fuso', 'os-menu-servidor', 'os-menu-discos', 'os-menu-sobre', 'os-menu-ajustes']) r.ok(itens.includes(s), `o menu tem "${s}"`);
    r.ok(((await p.textContent('[data-teste="os-menu-conta"]')) ?? '').includes('sem conta'), 'o menu mostra a conta (aqui, escrevendo sem conta, com Entrar)');
    await p.waitForTimeout(300);
    await foto(p, '08-menu');
    if (prints) {
      await p.emulateMedia({ colorScheme: 'dark' });
      await p.waitForTimeout(200);
      await foto(p, '08-menu-escuro');
      await p.emulateMedia({ colorScheme: 'light' });
    }
    // as setas andam pelo menu, em roda
    await r.tecla('ArrowDown');
    r.ok(await r.focoEm('os-reiniciar'), 'seta para baixo: Reiniciar');
    await r.tecla('ArrowUp', 2);
    r.ok(await r.focoEm(itens[itens.length - 1] ?? ''), 'seta para cima no primeiro: vai ao último');
    // Bateria e tela: setas até ele, Enter
    for (let i = 0; i < itens.length && !(await r.focoEm('os-menu-energia')); i++) await r.tecla('ArrowDown');
    await r.tecla('Enter');
    if (await r.esperar('os-painel-energia', 5000)) {
      await p.waitForTimeout(300);
      r.ok((await p.textContent('[data-teste="os-painel-energia"]'))?.includes('50') === true, 'o brilho começa em 50%');
      await foto(p, '08b-menu-energia');
      if (await r.tabAte('os-brilho-mais')) {
        await r.tecla('Enter');
        await p.waitForTimeout(200);
        r.ok((await p.textContent('[data-teste="os-painel-energia"]'))?.includes('60') === true, 'o brilho sobe (50% → 60%)');
      }
      await r.tecla('Escape');
      r.ok((await r.esperar('os-menu-energia', 3000)) && (await r.focoEm('os-menu-energia')), 'Esc numa parte volta ao menu, no item dela');
    } else r.ok(false, 'Enter em "Bateria e tela" abre a parte');
    // Wi-Fi: a senha da rede escolhida aparece ACIMA da lista (18/11)
    for (let i = 0; i < itens.length && !(await r.focoEm('os-menu-wifi')); i++) await r.tecla('ArrowUp');
    await r.tecla('Enter');
    if ((await r.esperar('os-rede', 5000)) && (await r.tabAte('os-rede'))) {
      // a rede "Casa" (com senha) vem antes da "Biblioteca" (aberta); o Tab pode ter chegado pela outra ponta
      const naCasa = () => p.evaluate(() => (document.activeElement?.textContent ?? '').startsWith('Casa'));
      for (let i = 0; i < 6 && !(await naCasa()); i++) await r.tecla('Shift+Tab');
      await r.tecla('Enter');
      if (await r.esperar('os-rede-senha', 3000)) {
        r.ok(await r.focoEm('os-rede-senha'), 'escolher a rede põe o foco na senha');
        const acima = await p.evaluate(() => {
          const senha = document.querySelector('[data-teste="os-rede-senha"]');
          const rede = document.querySelector('[data-teste="os-rede"]');
          return !!senha && !!rede && (senha.compareDocumentPosition(rede) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
        });
        r.ok(acima, 'o campo da senha do Wi-Fi fica acima da lista de redes');
        await foto(p, '08c-menu-wifi-senha');
        if (await r.tabAte('os-rede-cancelar')) {
          await r.tecla('Enter');
          await p.waitForTimeout(150);
          r.ok(await naCasa(), 'Cancelar: o foco volta para a rede');
        }
      } else {
        const onde = await p.evaluate(() => `${document.activeElement?.getAttribute('data-teste')} | ${document.activeElement?.textContent} | ${[...document.querySelectorAll('[data-teste="os-rede"]')].map((e) => e.textContent).join(' / ')}`);
        r.ok(false, `a rede com senha pede a senha (foco: ${onde})`);
      }
      await r.tecla('Escape');
    } else r.ok(false, 'a lista de redes aparece no menu');
    await r.esperar('os-menu-wifi', 3000);
    await r.tecla('Escape');
    r.ok(!(await p.$('[data-teste="menu-sistema"]')), 'Esc no menu fecha');
  }
  r.ok(existsSync(join(raiz1, 'run', 'sessao', 'pronta')), 'a casca avisou que a sessão abriu (o Num Lock da imagem)');

  // ---- tudo Ekfrase (§6.5): nenhum link para fora, importar e salvar pela tela dos pendrives
  // o menu do sistema: a engrenagem, só com o ícone, à vista; sem o botão da conta nem o dos Ajustes no topo
  const sistema = await p.$('[data-teste="botao-sistema"]');
  r.ok(sistema !== null && (await sistema.isVisible()) && ((await sistema.textContent()) ?? '').trim().length === 0 && !(await p.$('[data-teste="botao-desligar"]')), 'o topo tem o menu do sistema só com o ícone, à vista');
  const rotulos = await p.$$eval('.topo .ekf-acoes [aria-label]', (l) => l.map((e) => e.getAttribute('aria-label') ?? ''));
  r.ok(!(await p.$('[data-teste="botao-ajustes"]')) && !rotulos.some((x) => x.includes('Entrar')), `no topo do OS não há o botão da conta nem o dos Ajustes: estão no menu (${rotulos.join(', ')})`);
  r.ok((await saidas(p)).length === 0, `a estante não leva a lugar nenhum fora do app (${(await saidas(p)).join(', ')})`);
  await irPara(p, '/writer/');
  r.ok(await r.esperar('entrada-abrir', 6000), 'o hall abre');
  r.ok((await saidas(p)).length === 0, `o hall não leva a lugar nenhum fora do app (${(await saidas(p)).join(', ')})`);
  await irPara(p, '/writer/app/arquivos');
  if (await r.esperar('tela-arquivos', 6000)) {
    r.ok((await saidas(p)).length === 0, `Arquivos não tem link para fora nem seletor do sistema (${(await saidas(p)).join(', ')})`);
    if (await r.tabAte('importar-pendrive')) await r.tecla('Enter');
    r.ok(await r.esperar('os-pendrive', 5000), 'importar abre a tela dos pendrives (não o seletor do Linux)');
    if (await r.esperar('os-pendrive-disco', 5000)) {
      await foto(p, '12-importar-pendrives');
      await r.passo('o foco começa no pendrive', 'os-pendrive');
      await r.tecla('Enter');
      if (await r.esperar('os-pendrive-arquivo', 6000)) {
        await r.passo('o foco passa para a lista de arquivos', 'os-pendrive');
        await foto(p, '13-importar-lista');
        await p.keyboard.press('Space');
        if (await r.tabAte('os-pendrive-importar')) await r.tecla('Enter');
        r.ok(await r.esperar('tela-historia', 8000), 'o arquivo do pendrive foi importado (a história abre)');
      } else r.ok(false, 'o conto aparece na lista do pendrive');
    }
    // exportar: o "salvar" é a tela dos pendrives, não o do sistema
    await irPara(p, '/writer/app/arquivos');
    if (await r.esperar('exportar-md', 6000)) {
      if (await r.tabAte('exportar-md')) await r.tecla('Enter');
      r.ok(await r.esperar('os-pendrive', 5000), 'exportar abre a tela dos pendrives');
      if (await r.esperar('os-pendrive-disco', 5000)) {
        // o foco vai ao pendrive depois que a lista de discos chega; Enter antes disso caía no "exportar" de trás
        await p
          .waitForFunction(() => document.activeElement?.getAttribute('data-teste') === 'os-pendrive-disco', null, { timeout: 5000 })
          .catch(() => undefined);
        await r.passo('salvar: o foco começa no pendrive', 'os-pendrive');
        await r.tecla('Enter');
        // o pendrive monta e a pasta lista antes de o botão existir (num computador lento leva um tempo)
        await r.esperar('os-pendrive-salvar', 10000);
        if (await r.tabAte('os-pendrive-salvar')) {
          await foto(p, '14-salvar-pendrive');
          await r.tecla('Enter');
        }
      }
      await p.waitForTimeout(600);
      const md = readdirSync(pendrive).filter((n) => n.toLowerCase().endsWith('.md'));
      r.ok(md.length >= 2, `o arquivo exportado foi para o pendrive (${md.join(', ')})`);
      r.ok((await p.$('[data-teste="os-pendrive"]')) === null, 'a tela dos pendrives fecha depois de salvar');
    }
  }
  await app.fechar();
  somar(r);

  // ---- outro boot: só a senha
  falar('— outro boot: só a senha, e o texto continua lá');
  // o perfil do Chromium vive na memória do pendrive: num boot novo ele começa vazio
  app = await abrir({ ...env1, EKFRASE_CASCA_PERFIL: join(raiz1, 'perfil-2') });
  p = await app.pagina();
  r = new Roteiro(p, falar);
  r.ok(await r.esperar('casca-abrir', 10000), 'no segundo boot, direto na senha (o primeiro uso não volta)');
  await foto(p, '09-senha-de-novo');
  await p.keyboard.type(SENHA);
  await r.tecla('Enter');
  r.ok(await esperarRelato(raiz1, 'texto ok'), 'o agente: o texto gravado no boot anterior está lá');
  const lembrou = await r.esperar('nova-historia', 10000);
  r.ok(lembrou, 'escrever sem conta foi lembrado (cifrado no cofre)');
  if (!lembrou) falar(`   (tela: ${await p.evaluate(() => document.querySelector('main[data-teste], [data-teste^="tela-"], [data-teste^="entrada"]')?.getAttribute('data-teste'))}; relato: ${lerRelato(raiz1).split('\n').filter((l) => !l.startsWith('gravado')).join(' | ')})`);
  await app.fechar();
  somar(r);

  // ================= 2. sem a partição de dados =================
  falar('— Writer OS (simulado), sem a partição de dados: memória → outro pendrive');
  const raiz2 = join(base, 'sem-dados');
  const env2 = { ...comum, EKFRASE_CASCA_OS_RAIZ: raiz2, EKFRASE_CASCA_OS_DADOS: 'sem-dados', EKFRASE_CASCA_PERFIL: join(raiz2, 'perfil') };
  app = await abrir(env2);
  p = await app.pagina();
  r = new Roteiro(p, falar);
  for (const t of ['os-idioma', 'os-teclado', 'os-fuso']) await enter(r, t, `sem-dados-${t}`);
  r.ok(await r.esperar('os-onde-guardar', 10000), 'sem a partição de dados: "onde guardar"');
  await p.waitForSelector('[data-teste="os-guardar-disco"]', { timeout: 6000 }).catch(() => null);
  await r.passo('o foco começa no pendrive OUTRO');
  await foto(p, '10-onde-guardar');
  if (await r.tabAte('os-guardar-memoria')) await r.tecla('Enter');
  await senhaNova(r);
  await enter(r, 'casca-espelho', 'sem-dados-espelho');
  await enter(r, 'os-wifi', 'sem-dados-wifi');
  r.ok(await r.esperar('os-faixa-memoria', 10000), 'a faixa âmbar avisa que os textos estão na memória');
  await foto(p, '11-faixa-memoria');
  if (await r.tabAte('os-faixa-guardar')) await r.tecla('Enter');
  if (await r.esperar('os-levar-disco', 6000)) {
    await r.passo('"guardar num pendrive" abre a lista', 'os-levar-memoria');
    if (await r.tabAte('os-levar-disco')) await r.tecla('Enter');
  } else r.ok(false, 'a lista de pendrives aparece');
  r.ok(await r.esperar('casca-abrir', 10000), 'os textos foram para o pendrive: a senha (a mesma) abre de novo');
  await p.keyboard.type(SENHA);
  await r.tecla('Enter');
  await p.waitForTimeout(800);
  r.ok(existsSync(join(raiz2, 'media', 'OUTRO', 'Ekfrase Writer', 'dados', 'cofre.db')), 'o cofre está no OUTRO');
  r.ok(!existsSync(join(raiz2, 'ram', 'Ekfrase Writer')), 'e saiu da memória');
  r.ok((await p.$('[data-teste="os-faixa-memoria"]')) === null, 'a faixa âmbar some');
  await app.fechar();
  somar(r);

  return { passos, falhas };
}
