// SPDX-License-Identifier: MPL-2.0
/**
 * O Writer INTEIRO só pelo teclado (docs/writer/PLANO.md §2.4). Nenhum evento de mouse: o roteiro só
 * aperta teclas, e a página conta qualquer mousedown/pointermove/wheel de verdade (tem de dar zero).
 * A cada passo confere que o foco está num elemento VISÍVEL (nunca o <body>) e com o anel de foco.
 *
 * Não é teste do Vitest (o `vitest.config.ts` deixa os *.spec.ts de fora): roda com o build e o
 * `vite preview` do Writer, por `npm run teclado` (scripts/teclado.ts), que sobe tudo numa porta
 * livre, roda e desliga. Sozinho, com o app já no ar: `node tests/teclado.spec.ts <url-do-writer>`.
 *
 * Sem conta (o CI não tem a ponte): a tela inicial → "escrever sem conta" → estante → história,
 * capítulo e cenas → mover com Alt+setas → escrever → gavetas e janelas → personagens, ideias,
 * histórico → exportar.
 */
import type { Browser, Page } from 'playwright';

export interface Resultado {
  passos: number;
  falhas: string[];
}

type Foco = { ok: boolean; descricao: string; anel: boolean; dentroDe: string | null };

export class Roteiro {
  passos = 0;
  falhas: string[] = [];
  readonly p: Page;
  readonly falar: (linha: string) => void;
  constructor(p: Page, falar: (linha: string) => void) {
    this.p = p;
    this.falar = falar;
  }

  ok(cond: boolean, msg: string): void {
    this.passos++;
    this.falar(`${cond ? 'ok ' : 'XX '} ${msg}`);
    if (!cond) this.falhas.push(msg);
  }

  /** Onde está o foco agora (e se ele é visível e tem anel). */
  async foco(): Promise<Foco> {
    return this.p.evaluate(() => {
      const el = document.activeElement as HTMLElement | null;
      if (!el || el === document.body || el === document.documentElement) return { ok: false, descricao: el ? el.tagName.toLowerCase() : 'nada', anel: false, dentroDe: null };
      const r = el.getBoundingClientRect();
      const css = getComputedStyle(el);
      const visivel =
        el.isConnected && r.width > 0 && r.height > 0 && el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true }) && r.bottom > 0 && r.right > 0 && r.top < innerHeight && r.left < innerWidth;
      // a folha de escrever mostra o cursor piscando, não o anel
      const editor = el.classList.contains('cm-content');
      const anel = editor || (css.outlineStyle !== 'none' && parseFloat(css.outlineWidth) >= 2) || css.boxShadow !== 'none';
      const teste = el.getAttribute('data-teste') ?? el.closest('[data-teste]')?.getAttribute('data-teste') ?? '';
      const descricao = `${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ''}${teste ? `[${teste}]` : ''} "${(el.getAttribute('aria-label') ?? el.textContent ?? '').trim().slice(0, 40)}"`;
      const camada = el.closest('.camada');
      return { ok: visivel, descricao, anel, dentroDe: camada ? (camada.getAttribute('data-teste') ?? 'camada') : null };
    });
  }

  /** Confere o foco depois de um passo. `dentro` = o foco tem de estar dentro dessa janela/gaveta. */
  async passo(nome: string, dentro?: string): Promise<void> {
    await this.p.waitForTimeout(120);
    const f = await this.foco();
    const certo = f.ok && f.anel && (dentro === undefined || f.dentroDe === dentro);
    this.ok(
      certo,
      `${nome}: foco em ${f.descricao}${f.ok ? '' : ' (INVISÍVEL ou perdido)'}${f.anel ? '' : ' (sem anel)'}${dentro && f.dentroDe !== dentro ? ` (fora de "${dentro}")` : ''}`,
    );
  }

  async tecla(k: string, vezes = 1): Promise<void> {
    for (let i = 0; i < vezes; i++) await this.p.keyboard.press(k);
  }

  async esperar(teste: string, ms = 8000): Promise<boolean> {
    return this.p.waitForSelector(`[data-teste="${teste}"]`, { timeout: ms }).then(
      () => true,
      () => false,
    );
  }

  /** O foco está no elemento `teste`? */
  async focoEm(teste: string): Promise<boolean> {
    return this.p.evaluate((x) => document.activeElement?.getAttribute('data-teste') === x, teste);
  }

  /**
   * Tab (ou Shift+Tab, se o elemento está antes do foco na página) até o foco chegar no elemento
   * `teste`, conferindo o foco a cada tecla.
   */
  async tabAte(teste: string, max = 60): Promise<boolean> {
    const reverso = await this.p.evaluate((x) => {
      const alvo = document.querySelector(`[data-teste="${x}"]`);
      const a = document.activeElement;
      return !!alvo && !!a && a !== document.body && !!(alvo.compareDocumentPosition(a) & Node.DOCUMENT_POSITION_FOLLOWING);
    }, teste);
    for (let i = 0; i < max; i++) {
      if (await this.focoEm(teste)) return true;
      await this.p.keyboard.press(reverso ? 'Shift+Tab' : 'Tab');
      const f = await this.foco();
      if (!f.ok || !f.anel) {
        this.ok(false, `Tab procurando "${teste}": foco em ${f.descricao}${f.ok ? ' (sem anel)' : ' (INVISÍVEL ou perdido)'}`);
        return false;
      }
    }
    this.ok(false, `Tab não chegou em "${teste}"`);
    return false;
  }

  /** Ctrl+K, desce pela lista até o comando `id` e aperta Enter. */
  async comando(id: string): Promise<boolean> {
    await this.p.keyboard.press('Control+k');
    if (!(await this.esperar('paleta-busca', 3000))) {
      this.ok(false, `Ctrl+K não abriu a paleta (para "${id}")`);
      return false;
    }
    await this.passo(`Ctrl+K abre a paleta (${id})`, 'paleta');
    for (let i = 0; i < 80; i++) {
      const ativo = await this.p.getAttribute('[data-teste="paleta-busca"]', 'aria-activedescendant');
      if (ativo === `paleta-${id}`) {
        await this.p.keyboard.press('Enter');
        await this.p.waitForTimeout(150);
        return true;
      }
      await this.p.keyboard.press('ArrowDown');
    }
    this.ok(false, `o comando "${id}" não está na paleta`);
    await this.p.keyboard.press('Escape');
    return false;
  }

  async ordem(): Promise<string[]> {
    return this.p.$$eval('[data-teste="linha-cena"]', (l) => l.map((x) => x.getAttribute('data-item') ?? ''));
  }

  async itemComFoco(): Promise<string | null> {
    return this.p.evaluate(() => document.activeElement?.getAttribute('data-item') ?? null);
  }

  async mouse(): Promise<number> {
    return this.p.evaluate(() => (window as unknown as { __mouse: number }).__mouse);
  }
}

export async function percorrer(nav: Browser, base: string, falar: (linha: string) => void = console.log): Promise<Resultado> {
  const ctx = await nav.newContext({ viewport: { width: 1280, height: 820 }, locale: 'pt-BR', acceptDownloads: true });
  // a página conta todo evento de mouse de verdade (o roteiro não pode emitir nenhum)
  await ctx.addInitScript(() => {
    const w = window as unknown as { __mouse: number };
    w.__mouse = 0;
    for (const ev of ['mousedown', 'mouseup', 'mousemove', 'pointerdown', 'pointermove', 'wheel', 'contextmenu', 'dragstart']) {
      addEventListener(ev, (e) => e.isTrusted && w.__mouse++, true);
    }
  });
  const p = await ctx.newPage();
  const r = new Roteiro(p, falar);
  const errosDaPagina: string[] = [];
  p.on('pageerror', (e) => errosDaPagina.push(e.message));

  try {
    await p.goto(base, { waitUntil: 'networkidle' });

    // ---- a tela inicial: "escrever sem conta"
    if (await r.tabAte('entrada-outra-forma')) {
      await r.passo('tela inicial: "escrever sem conta"');
      await r.tecla('Enter');
    }
    r.ok(await r.esperar('tela-estante'), 'Enter leva à estante');
    await r.passo('estante aberta');

    // ---- os links do topo
    for (const [link, tela] of [
      ['nav-ideias', 'tela-ideias'],
      ['nav-arquivos', 'tela-arquivos'],
      ['nav-estante', 'tela-estante'],
    ] as const) {
      if (!(await r.tabAte(link))) continue;
      await r.tecla('Enter');
      r.ok(await r.esperar(tela), `link "${link}" pelo teclado`);
      await r.passo(`${tela} aberta`);
    }

    // ---- nova história
    if (await r.tabAte('nova-historia')) await r.tecla('Enter');
    r.ok(await r.esperar('tela-historia'), 'Enter em "Nova história" abre a história');
    await r.passo('história nova aberta');

    // ---- capítulo e cenas (paleta, Ctrl+Enter)
    if (await r.comando('novo-capitulo')) {
      r.ok(await r.esperar('linha-capitulo'), 'paleta: "novo capítulo" criou o capítulo');
      await r.passo('depois de criar o capítulo');
    }
    if (!(await r.focoEm('linha-capitulo'))) await r.tabAte('linha-capitulo');
    await r.tecla('Control+Enter');
    r.ok(await r.esperar('linha-cena'), 'Ctrl+Enter no capítulo cria a cena');
    await r.passo('cena nova');
    r.ok(await r.focoEm('linha-cena'), 'o foco foi para a cena nova');
    await r.tecla('Control+Enter');
    await p.waitForFunction(() => document.querySelectorAll('[data-teste="linha-cena"]').length === 2, null, { timeout: 5000 }).catch(() => null);
    const antes = await r.ordem();
    r.ok(antes.length === 2, `Ctrl+Enter na cena cria outra abaixo (${antes.length} cenas)`);
    await r.passo('segunda cena');
    const movida = await r.itemComFoco();
    r.ok(movida === antes[1], 'o foco está na segunda cena');

    // ---- mover com Alt+setas
    await r.tecla('Alt+ArrowUp');
    await p.waitForTimeout(400);
    r.ok((await r.ordem())[0] === movida, 'Alt+↑ subiu a cena');
    await r.passo('depois de Alt+↑');
    r.ok((await r.itemComFoco()) === movida, 'o foco seguiu a cena movida');
    await r.tecla('Alt+ArrowDown');
    await p.waitForTimeout(400);
    r.ok((await r.ordem())[1] === movida, 'Alt+↓ desceu a cena');
    await r.passo('depois de Alt+↓');
    await r.tecla('Alt+ArrowLeft');
    await p.waitForTimeout(400);
    await r.passo('depois de Alt+← (a cena sai do capítulo)');
    r.ok((await r.itemComFoco()) === movida, 'o foco seguiu a cena que saiu do capítulo');
    await r.tecla('Alt+ArrowRight');
    await p.waitForTimeout(400);
    await r.passo('depois de Alt+→ (a cena volta a um capítulo)');
    await r.tecla('ArrowUp');
    await r.passo('↑ anda na árvore');
    await r.tecla('ArrowDown');
    await r.passo('↓ anda na árvore');

    // ---- renomear com F2
    await r.tecla('F2');
    if (await r.esperar('renomear-nome', 3000)) {
      await r.passo('F2 abre o renomear', 'renomear');
      await p.keyboard.press('Control+a');
      await p.keyboard.type('A chegada');
      await r.tecla('Enter');
      await p.waitForTimeout(300);
      await r.passo('depois de renomear');
    } else r.ok(false, 'F2 não abriu o renomear');

    // ---- a ficha (gaveta)
    if (await r.comando('ficha')) {
      await r.passo('a ficha da história abre com o foco dentro', 'gaveta-ficha');
      await r.tecla('Escape');
      await r.passo('Esc fecha a ficha e devolve o foco');
    }

    // ---- escrever
    if (!(await r.focoEm('linha-cena'))) await r.tabAte('linha-cena');
    await r.tecla('Enter');
    r.ok(await r.esperar('tela-escrever'), 'Enter na cena abre a folha');
    await p.waitForSelector('[data-teste="editor"]');
    await r.passo('folha aberta: o foco está no texto');
    r.ok(await r.focoEm('editor'), 'o foco já está no texto');
    await p.keyboard.type('Era uma vez -- disse ela -- uma folha.', { delay: 4 });
    await p.waitForFunction(() => document.querySelector('[data-teste="gravacao"]')?.getAttribute('data-estado') === 'salvo', null, { timeout: 5000 }).catch(() => null);
    r.ok((await p.getAttribute('[data-teste="gravacao"]', 'data-estado')) === 'salvo', 'o texto foi gravado');
    r.ok(((await p.textContent('[data-teste="editor"]')) ?? '').includes('—'), '"--" virou travessão');
    await r.tecla('Escape');
    await r.passo('Esc na folha (o topo)');
    if (await r.tabAte('abrir-notas', 20)) {
      await r.tecla('Enter');
      await r.passo('notas da cena (gaveta) com o foco dentro', 'gaveta-notas');
      await r.tecla('Escape');
      await r.passo('Esc fecha as notas e devolve o foco');
    }
    if (await r.comando('voltar-texto')) await r.passo('paleta: "voltar ao texto"');
    await r.tecla('Control+i');
    if (await r.esperar('ideia-texto', 3000)) {
      await r.passo('Ctrl+I: ideia rápida', 'ideia-rapida');
      await p.keyboard.type('Um farol que acende sozinho');
      await r.tecla('Enter');
      await p.waitForTimeout(300);
      await r.passo('a ideia rápida fecha e o foco volta');
    } else r.ok(false, 'Ctrl+I não abriu a ideia rápida');
    if (await r.comando('modo-foco')) await r.passo('paleta: modo foco');
    if (await r.comando('modo-foco')) await r.passo('paleta: modo foco desligado');

    // ---- escrever sem menus (PLANO §6.5 item 4): Alt+M esconde o topo e o rodapé; Esc os traz; Alt+M desliga
    const menus = () =>
      p.evaluate(() => {
        const topo = document.querySelector('[data-teste="folha-topo"]');
        const rodape = document.querySelector('[data-teste="folha-rodape"]');
        return { topoEscondido: topo?.classList.contains('escondido') === true, rodape: rodape ? getComputedStyle(rodape).opacity : '?' };
      });
    await p.waitForTimeout(1800);
    await r.tecla('Alt+m');
    await p.waitForTimeout(700);
    const sem = await menus();
    r.ok(sem.topoEscondido && sem.rodape === '0', `Alt+M: o topo e o rodapé somem (${JSON.stringify(sem)})`);
    const prints = process.env['EKFRASE_PRINTS_TECLADO'];
    if (prints) await p.screenshot({ path: `${prints}/folha-sem-menus.png` });
    r.ok(await r.focoEm('editor'), 'Alt+M: o foco continua no texto');
    await r.tecla('Escape');
    await p.waitForTimeout(700);
    const volta = await menus();
    r.ok(!volta.topoEscondido && volta.rodape === '1', `Esc traz o topo e o rodapé de volta (${JSON.stringify(volta)})`);
    if (prints) await p.screenshot({ path: `${prints}/folha-menus-voltaram.png` });
    await r.tecla('Alt+m');
    await p.waitForTimeout(700);
    const aberto = await menus();
    r.ok(!aberto.topoEscondido && aberto.rodape === '1', `Alt+M de novo desliga o modo (${JSON.stringify(aberto)})`);
    await r.passo('o foco segue visível depois do modo sem menus');
    if (await r.comando('historico')) {
      r.ok(await r.esperar('tela-historico'), 'paleta: histórico da cena');
      await r.passo('histórico aberto');
    }
    if (await r.comando('estante')) {
      r.ok(await r.esperar('tela-estante'), 'paleta: estante');
      await r.passo('estante');
    }
    if (await r.tabAte('livro')) await r.tecla('Enter');
    r.ok(await r.esperar('tela-historia'), 'Enter no livro abre a história');
    await r.passo('história de novo');

    // ---- personagens
    if (await r.comando('personagens')) {
      r.ok(await r.esperar('tela-personagens'), 'paleta: personagens');
      await r.passo('personagens aberto');
      if (await r.comando('novo-personagem')) {
        r.ok(await r.esperar('personagem'), 'paleta: novo personagem');
        await r.passo('personagem novo');
        await p.keyboard.type('Ana');
      }
    }

    // ---- ideias
    if (await r.comando('banco-ideias')) {
      r.ok(await r.esperar('tela-ideias'), 'paleta: banco de ideias');
      await r.passo('banco de ideias');
      if (await r.comando('nova-ideia')) {
        await r.passo('nova ideia: o foco no editor da ideia');
        await p.keyboard.type('E se o narrador mentir?');
        if (await r.tabAte('ideia-salvar')) {
          await r.tecla('Enter');
          await p.waitForTimeout(300);
          await r.passo('ideia guardada');
        }
      }
      r.ok(((await p.textContent('[data-teste="cartoes-ideias"]').catch(() => '')) ?? '').includes('farol'), 'a ideia rápida está no banco');
    }

    // ---- ajustes e atalhos
    await r.tecla('Control+,');
    if (await r.esperar('ajustes', 3000)) {
      await r.passo('Ctrl+, abre os ajustes', 'ajustes');
      await r.tecla('Tab', 2);
      await r.passo('Tab gira dentro dos ajustes', 'ajustes');
      await r.tecla('Escape');
      await r.passo('Esc fecha os ajustes');
    } else r.ok(false, 'Ctrl+, não abriu os ajustes');
    await r.tecla('F1');
    if (await r.esperar('atalhos', 3000)) {
      await r.passo('F1 abre os atalhos', 'atalhos');
      await r.tecla('Escape');
      await r.passo('Esc fecha os atalhos');
    } else r.ok(false, 'F1 não abriu os atalhos');

    // ---- exportar
    if (await r.comando('arquivos')) {
      r.ok(await r.esperar('tela-arquivos'), 'paleta: arquivos');
      await r.passo('arquivos');
      for (const [teste, ext] of [
        ['exportar-md', '.md'],
        ['exportar-docx', '.docx'],
        ['exportar-ekfr', '.ekfr'],
      ] as const) {
        if (!(await r.tabAte(teste))) continue;
        const baixou = p.waitForEvent('download', { timeout: 5000 }).catch(() => null);
        await r.tecla('Enter');
        const d = await baixou;
        r.ok(!!d && d.suggestedFilename().endsWith(ext), `Enter em "${teste}" baixa ${d?.suggestedFilename() ?? 'nada'}`);
        await r.passo(`depois de exportar ${ext}`);
      }
    }

    // ---- apagar pelo teclado: o foco vai para a linha que ficou no lugar; sem nenhuma, para o título
    if (await r.comando('nova-historia')) {
      r.ok(await r.esperar('tela-historia'), 'paleta: nova história (para apagar)');
      for (let k = 0; k < 2; k++) {
        await r.comando('nova-cena');
        await p.waitForFunction((n) => document.querySelectorAll('[data-teste="linha-cena"]').length === n, k + 1, { timeout: 5000 }).catch(() => null);
      }
      for (const [sobram, nome] of [
        [1, 'depois de apagar uma de duas cenas'],
        [0, 'depois de apagar a única cena'],
      ] as const) {
        if (!(await r.focoEm('linha-cena'))) await r.tabAte('linha-cena');
        await r.tecla('Delete');
        if (!(await r.esperar('confirmar-sim', 3000))) {
          r.ok(false, 'Delete na cena não pediu confirmação');
          break;
        }
        await r.passo('Delete pede confirmação', 'confirmar');
        await r.tecla('Enter');
        await p.waitForFunction((n) => document.querySelectorAll('[data-teste="linha-cena"]').length === n, sobram, { timeout: 5000 }).catch(() => null);
        await r.passo(nome);
      }
      r.ok(await r.focoEm('titulo-historia'), 'sem cenas, o foco fica no título da história');
    }

    if (await r.comando('estante')) {
      r.ok(await r.esperar('tela-estante'), 'paleta: estante (fim)');
      await r.passo('estante no fim');
    }

    r.ok((await r.mouse()) === 0, `nenhum evento de mouse (${await r.mouse()})`);
    r.ok(errosDaPagina.length === 0, `nenhum erro na página (${errosDaPagina.join(' | ')})`);
  } catch (e) {
    r.ok(false, `o roteiro parou: ${(e as Error).message.split('\n')[0]}`);
  } finally {
    await ctx.close();
  }
  return { passos: r.passos, falhas: r.falhas };
}

// sozinho: node tests/teclado.spec.ts <url-do-writer>
if (process.argv[1]?.endsWith('teclado.spec.ts')) {
  const url = process.argv[2];
  if (!url) {
    console.error('uso: node tests/teclado.spec.ts <url-do-writer>');
    process.exit(2);
  }
  const { chromium } = await import('playwright');
  const nav = await chromium.launch();
  const r = await percorrer(nav, url);
  await nav.close();
  console.log(r.falhas.length ? `\n${r.falhas.length} de ${r.passos} passos falharam.` : `\nTeclado: ${r.passos} passos, tudo certo.`);
  process.exit(r.falhas.length ? 1 : 0);
}
