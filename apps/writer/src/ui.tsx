// SPDX-License-Identifier: MPL-2.0

/**
 * As peças de tela que o Writer usa em toda parte, todas feitas para o TECLADO (PLANO §2.4):
 * - `Camada`: janela ou gaveta por cima. Prende o foco (Tab e Shift+Tab giram dentro), fecha com
 *   Esc e devolve o foco a quem estava com ele antes.
 * - `MenuAcoes`: o botão "mais ações" de uma linha (setas sobem e descem, Esc fecha).
 * - `Campo`: um campo que grava sozinho (400 ms depois da última tecla, e ao sair dele).
 * - `avisar` + `Avisos`: os recados curtos no canto (lidos pelo leitor de tela).
 * - `confirmar` + `Confirmacoes`: "tem certeza?" sem o `confirm()` do navegador.
 */
import { IconeFechar } from '@ekfrase/interface';
import type { ComponentChildren, TargetedKeyboardEvent } from 'preact';
import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import { noOS } from './computador/casca.ts';
import { salvarNoPendrive } from './computador/pendrive.ts';
import { IconeMenu } from './icones.tsx';
import { t } from './textos.ts';

const FOCAVEIS = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** Os elementos que recebem foco dentro de `raiz`, na ordem do Tab (só os visíveis). */
export function focaveis(raiz: HTMLElement): HTMLElement[] {
  return [...raiz.querySelectorAll<HTMLElement>(FOCAVEIS)].filter((el) => el.getClientRects().length > 0);
}

let abertas = 0;
/** Há uma janela ou gaveta aberta? (Os atalhos gerais esperam ela fechar.) */
export const camadaAberta = (): boolean => abertas > 0;

// quem usa o teclado nunca pode ficar com o foco perdido no <body> (PLANO §2.4)
let peloTeclado = false;
addEventListener('keydown', () => (peloTeclado = true), true);
addEventListener('pointerdown', () => (peloTeclado = false), true);

/**
 * O foco se perdeu (o elemento que o tinha sumiu: trocou a tela, fechou a janela de quem a abriu):
 * leva o foco ao título da tela (ou ao texto, na folha), que o leitor de tela lê. Só para quem está
 * no teclado, e só se ninguém pegou o foco antes (a tela nova pode pôr o foco onde quiser).
 */
export function focarTela(): void {
  let vezes = 0;
  const tentar = () => {
    const a = document.activeElement;
    if (!peloTeclado || abertas > 0 || (a && a !== document.body && a.isConnected)) return;
    const alvo = document.querySelector<HTMLElement>('#conteudo h1, [data-teste="editor"]');
    if (alvo) {
      if (!alvo.isContentEditable && !alvo.hasAttribute('tabindex')) alvo.tabIndex = -1;
      alvo.focus();
    } else if (++vezes < 40) setTimeout(tentar, 50);
    else document.getElementById('conteudo')?.focus();
  };
  setTimeout(tentar, 0);
}

let seq = 0;
const novoId = (prefixo: string): string => `${prefixo}-${++seq}`;

export interface CamadaProps {
  titulo: string;
  fechar: () => void;
  children: ComponentChildren;
  /** `janela` (no meio), `gaveta` (do lado direito; no celular, a tela toda) ou `menu` (preso ao canto de cima, à direita). */
  tipo?: 'janela' | 'gaveta' | 'menu';
  teste?: string;
  /** Classe a mais na caixa. */
  classe?: string;
}

export function Camada({ titulo, fechar, children, tipo = 'janela', teste, classe }: CamadaProps) {
  const caixa = useRef<HTMLElement>(null);
  const id = useRef(novoId('camada'));
  // antes de pintar: o que se digitar logo depois de abrir já cai dentro da janela
  useLayoutEffect(() => {
    abertas += 1;
    const antes = document.activeElement as HTMLElement | null;
    const c = caixa.current;
    if (c) {
      const alvo = c.querySelector<HTMLElement>('[data-foco-inicial]') ?? focaveis(c).find((el) => !el.classList.contains('camada-fechar')) ?? c.querySelector<HTMLElement>('.camada-fechar') ?? c;
      alvo.focus();
    }
    return () => {
      abertas -= 1;
      // devolve o foco (se quem tinha ainda existe; senão, o próximo da tela recebe pelo Tab)
      if (antes && antes !== document.body && document.contains(antes)) antes.focus();
      else focarTela();
    };
  }, []);

  const tecla = (e: TargetedKeyboardEvent<HTMLElement>) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      fechar();
      return;
    }
    if (e.key !== 'Tab' || !caixa.current) return;
    const lista = focaveis(caixa.current);
    if (!lista.length) return;
    const primeiro = lista[0]!;
    const ultimo = lista[lista.length - 1]!;
    const ativo = document.activeElement;
    if (e.shiftKey && (ativo === primeiro || ativo === caixa.current)) {
      e.preventDefault();
      ultimo.focus();
    } else if (!e.shiftKey && ativo === ultimo) {
      e.preventDefault();
      primeiro.focus();
    }
  };

  return (
    <div class={`camada-fundo ${tipo}`} onPointerDown={(e) => e.target === e.currentTarget && fechar()}>
      <section
        ref={caixa}
        class={`camada ${tipo}${classe ? ` ${classe}` : ''}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={id.current}
        tabIndex={-1}
        onKeyDown={tecla}
        data-teste={teste}
      >
        <header class="camada-topo">
          <h2 id={id.current}>{titulo}</h2>
          <button type="button" class="botao-icone camada-fechar" title={t('writer.fechar')} aria-label={t('writer.fechar')} onClick={fechar} data-teste="fechar">
            <IconeFechar tamanho={16} />
          </button>
        </header>
        <div class="camada-miolo">{children}</div>
      </section>
    </div>
  );
}

// ---------- o menu de ações de uma linha ----------

export interface Acao {
  rotulo: string;
  fazer: () => void;
  perigo?: boolean;
  teste?: string;
}

export function MenuAcoes({ rotulo, itens, teste }: { rotulo: string; itens: readonly (Acao | false | null | undefined)[]; teste?: string }) {
  const [aberto, setAberto] = useState(false);
  const raiz = useRef<HTMLDivElement>(null);
  const botao = useRef<HTMLButtonElement>(null);
  const lista = itens.filter((i): i is Acao => !!i);

  useEffect(() => {
    if (!aberto) return;
    raiz.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
    const fora = (e: Event) => {
      if (!raiz.current?.contains(e.target as Node)) setAberto(false);
    };
    document.addEventListener('pointerdown', fora);
    return () => document.removeEventListener('pointerdown', fora);
  }, [aberto]);

  const fechar = (devolver = true) => {
    setAberto(false);
    if (devolver) botao.current?.focus();
  };

  const tecla = (e: TargetedKeyboardEvent<HTMLDivElement>) => {
    if (!aberto) return;
    const itensDom = [...(raiz.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])];
    const i = itensDom.indexOf(document.activeElement as HTMLElement);
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      fechar();
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      e.stopPropagation();
      const n = itensDom.length;
      itensDom[(i + (e.key === 'ArrowDown' ? 1 : n - 1)) % n]?.focus();
    } else if (e.key === 'Home' || e.key === 'End') {
      e.preventDefault();
      (e.key === 'Home' ? itensDom[0] : itensDom.at(-1))?.focus();
    } else if (e.key === 'Tab') {
      fechar(false);
    }
  };

  return (
    <div class="menu-acoes" ref={raiz} onKeyDown={tecla}>
      <button
        ref={botao}
        type="button"
        class="botao-icone"
        title={rotulo}
        aria-label={rotulo}
        aria-haspopup="menu"
        aria-expanded={aberto}
        onClick={() => setAberto(!aberto)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown' && !aberto) {
            e.preventDefault();
            e.stopPropagation();
            setAberto(true);
          }
        }}
        data-teste={teste}
      >
        <IconeMenu tamanho={16} />
      </button>
      {aberto && (
        <div class="menu-acoes-lista" role="menu">
          {lista.map((a) => (
            <button
              key={a.rotulo}
              type="button"
              role="menuitem"
              class={a.perigo ? 'perigo' : undefined}
              data-teste={a.teste}
              onClick={() => {
                fechar(false);
                a.fazer();
              }}
            >
              {a.rotulo}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------- o campo que grava sozinho ----------

export const ESPERA_GRAVAR = 400;

export interface CampoProps {
  rotulo: string;
  valor: string | number;
  gravar: (v: string) => void | Promise<unknown>;
  /** `area` = texto de várias linhas. */
  tipo?: 'texto' | 'area' | 'numero';
  linhas?: number;
  dica?: string;
  teste?: string;
  focoInicial?: boolean;
}

export function Campo({ rotulo, valor, gravar, tipo = 'texto', linhas = 3, dica, teste, focoInicial }: CampoProps) {
  const [local, setLocal] = useState(String(valor));
  const editando = useRef(false);
  const espera = useRef<ReturnType<typeof setTimeout> | null>(null);
  const ultimoGravado = useRef(String(valor));
  const atual = useRef(local);
  const funcao = useRef(gravar);
  funcao.current = gravar;
  const id = useRef(novoId('campo'));

  // o valor mudou por fora (outra tela, a nuvem) e ninguém está digitando aqui: acompanha
  useEffect(() => {
    if (!editando.current) {
      setLocal(String(valor));
      atual.current = String(valor);
      ultimoGravado.current = String(valor);
    }
  }, [valor]);

  const agora = () => {
    if (espera.current) clearTimeout(espera.current);
    espera.current = null;
    const v = atual.current;
    if (v === ultimoGravado.current) return;
    ultimoGravado.current = v;
    void funcao.current(v);
  };
  // ao sumir da tela com algo por gravar: grava
  useEffect(() => () => agora(), []);

  const mudou = (v: string) => {
    editando.current = true;
    atual.current = v;
    setLocal(v);
    if (espera.current) clearTimeout(espera.current);
    espera.current = setTimeout(agora, ESPERA_GRAVAR);
  };
  const saiu = () => {
    editando.current = false;
    agora();
  };
  const comum = {
    id: id.current,
    value: local,
    onInput: (e: Event) => mudou((e.currentTarget as HTMLInputElement).value),
    onBlur: saiu,
    'data-teste': teste,
    ...(focoInicial ? { 'data-foco-inicial': true } : {}),
    ...(dica ? { 'aria-describedby': `${id.current}-dica` } : {}),
  };
  return (
    <div class="campo">
      <label for={id.current}>{rotulo}</label>
      {tipo === 'area' ? <textarea rows={linhas} {...comum} /> : tipo === 'numero' ? <input type="number" inputMode="numeric" min={0} {...comum} /> : <input type="text" {...comum} />}
      {dica && (
        <small id={`${id.current}-dica`} class="dica">
          {dica}
        </small>
      )}
    </div>
  );
}

// ---------- recados ----------

interface Recado {
  id: number;
  texto: string;
  tipo: 'ok' | 'erro';
}
let recados: Recado[] = [];
let proximo = 1;
const ouvintesRecado = new Set<() => void>();
const avisarOuvintes = () => {
  for (const f of [...ouvintesRecado]) f();
};

/** Um recado curto no canto da tela, que some sozinho. */
export function avisar(texto: string, tipo: 'ok' | 'erro' = 'ok'): void {
  const r = { id: proximo++, texto, tipo };
  recados = [...recados.slice(-2), r];
  avisarOuvintes();
  setTimeout(
    () => {
      recados = recados.filter((x) => x.id !== r.id);
      avisarOuvintes();
    },
    tipo === 'erro' ? 7000 : 4000,
  );
}

export function Avisos() {
  const [, setV] = useState(0);
  useEffect(() => {
    const f = () => setV((n) => n + 1);
    ouvintesRecado.add(f);
    return () => {
      ouvintesRecado.delete(f);
    };
  }, []);
  return (
    <div class="recados" role="status" aria-live="polite" data-teste="recados">
      {recados.map((r) => (
        <p key={r.id} class={`recado ${r.tipo}`}>
          {r.texto}
        </p>
      ))}
    </div>
  );
}

// ---------- "tem certeza?" ----------

interface Pergunta {
  texto: string;
  sim: string;
  perigo: boolean;
  responder: (sim: boolean) => void;
}
let pergunta: Pergunta | null = null;
const ouvintesPergunta = new Set<() => void>();
const avisarPergunta = () => {
  for (const f of [...ouvintesPergunta]) f();
};

/** Pergunta antes de fazer (apagar, trocar de app). Resolve `true` se a pessoa confirmou. */
export function confirmar(texto: string, sim: string, perigo = false): Promise<boolean> {
  return new Promise((resolve) => {
    pergunta?.responder(false);
    pergunta = {
      texto,
      sim,
      perigo,
      responder: (r) => {
        pergunta = null;
        avisarPergunta();
        resolve(r);
      },
    };
    avisarPergunta();
  });
}

export function Confirmacoes() {
  const [, setV] = useState(0);
  useEffect(() => {
    const f = () => setV((n) => n + 1);
    ouvintesPergunta.add(f);
    return () => {
      ouvintesPergunta.delete(f);
    };
  }, []);
  const p = pergunta;
  if (!p) return null;
  return (
    <Camada titulo={t('writer.confirmar.titulo')} fechar={() => p.responder(false)} teste="confirmar">
      <p>{p.texto}</p>
      <div class="acoes-linha">
        <button type="button" class="botao" onClick={() => p.responder(false)} data-teste="confirmar-nao">
          {t('writer.cancelar')}
        </button>
        <button type="button" class={`botao principal${p.perigo ? ' perigo' : ''}`} onClick={() => p.responder(true)} data-teste="confirmar-sim" data-foco-inicial>
          {p.sim}
        </button>
      </div>
    </Camada>
  );
}

/** Baixa bytes (ou texto) como arquivo. */
export function baixar(conteudo: Uint8Array | string, nome: string, tipo: string): void {
  // no Writer OS não há "salvar" do sistema: a tela do app leva o arquivo a uma pasta de um pendrive
  if (noOS) {
    void salvarNoPendrive(typeof conteudo === 'string' ? new TextEncoder().encode(conteudo) : conteudo, nome);
    return;
  }
  const parte: BlobPart = typeof conteudo === 'string' ? conteudo : (conteudo.slice().buffer as ArrayBuffer);
  const url = URL.createObjectURL(new Blob([parte], { type: tipo }));
  const a = document.createElement('a');
  a.href = url;
  a.download = nome;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
