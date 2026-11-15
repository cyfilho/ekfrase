// SPDX-License-Identifier: MPL-2.0

/**
 * O EDITOR da folha de escrever: CodeMirror 6 (MIT, DEC-P062) com Markdown leve.
 * - Os símbolos (`*`, `**`, `#`, `>`) somem fora das linhas onde está o cursor: o texto aparece
 *   formatado, como num editor comum, e o Markdown continua lá.
 * - `--` vira travessão (—) na hora.
 * - Modo máquina de escrever: a linha atual fica no meio da tela.
 * - Modo foco: o parágrafo atual em destaque, o resto apagado.
 * - Ctrl+B negrito, Ctrl+E itálico (o Ctrl+I é a ideia rápida, PLANO §2.1), Ctrl+Enter nova cena.
 * Tab sai do texto (não vira tabulação): nada prende o teclado aqui dentro.
 */
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
import { markdown } from '@codemirror/lang-markdown';
import { syntaxTree } from '@codemirror/language';
import { Annotation, Compartment, EditorSelection, EditorState, Prec, type Range } from '@codemirror/state';
import { Decoration, EditorView, ViewPlugin, keymap, placeholder, type DecorationSet, type ViewUpdate } from '@codemirror/view';

/** Marca as trocas que vêm de fora (a nuvem): essas não voltam como "a pessoa digitou". */
const deFora = Annotation.define<boolean>();

// ---------- os símbolos que somem ----------

const esconder = Decoration.replace({});
const italico = Decoration.mark({ class: 'cm-italico' });
const negrito = Decoration.mark({ class: 'cm-negrito' });

function linhasDoCursor(view: EditorView): Set<number> {
  const linhas = new Set<number>();
  if (!view.hasFocus) return linhas;
  const { doc, selection } = view.state;
  for (const r of selection.ranges) {
    for (let n = doc.lineAt(r.from).number; n <= doc.lineAt(r.to).number; n++) linhas.add(n);
  }
  return linhas;
}

function decorar(view: EditorView): DecorationSet {
  const { state } = view;
  const ativas = linhasDoCursor(view);
  const decos: Range<Decoration>[] = [];
  for (const { from, to } of view.visibleRanges) {
    syntaxTree(state).iterate({
      from,
      to,
      enter: (no) => {
        const nome = no.name;
        if (nome === 'Emphasis') decos.push(italico.range(no.from, no.to));
        else if (nome === 'StrongEmphasis') decos.push(negrito.range(no.from, no.to));
        const titulo = /^ATXHeading(\d)$/.exec(nome);
        if (titulo) decos.push(Decoration.line({ class: `cm-titulo cm-titulo-${titulo[1]}` }).range(state.doc.lineAt(no.from).from));
        if (nome === 'Blockquote') {
          for (let n = state.doc.lineAt(no.from).number; n <= state.doc.lineAt(no.to).number; n++) decos.push(Decoration.line({ class: 'cm-citacao' }).range(state.doc.line(n).from));
        }
        if (nome === 'EmphasisMark' || nome === 'HeaderMark' || nome === 'QuoteMark') {
          if (ativas.has(state.doc.lineAt(no.from).number)) return;
          let fim = no.to;
          // "# Título" e "> citação": o espaço depois do símbolo some junto
          if (nome !== 'EmphasisMark' && state.doc.sliceString(fim, fim + 1) === ' ') fim += 1;
          if (fim > no.from) decos.push(esconder.range(no.from, fim));
        }
      },
    });
  }
  return Decoration.set(decos, true);
}

const marcas = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = decorar(view);
    }
    update(u: ViewUpdate) {
      if (u.docChanged || u.selectionSet || u.viewportChanged || u.focusChanged || syntaxTree(u.startState) !== syntaxTree(u.state)) this.decorations = decorar(u.view);
    }
  },
  { decorations: (v) => v.decorations },
);

// ---------- o modo foco: o parágrafo atual ----------

const atual = Decoration.line({ class: 'cm-paragrafo-atual' });

function paragrafo(view: EditorView): DecorationSet {
  const { doc, selection } = view.state;
  const linha = doc.lineAt(selection.main.head);
  let a = linha.number;
  let b = linha.number;
  if (linha.text.trim() !== '') {
    while (a > 1 && doc.line(a - 1).text.trim() !== '') a -= 1;
    while (b < doc.lines && doc.line(b + 1).text.trim() !== '') b += 1;
  }
  const decos: Range<Decoration>[] = [];
  for (let n = a; n <= b; n++) decos.push(atual.range(doc.line(n).from));
  return Decoration.set(decos);
}

const destaqueDoParagrafo = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = paragrafo(view);
    }
    update(u: ViewUpdate) {
      if (u.docChanged || u.selectionSet) this.decorations = paragrafo(u.view);
    }
  },
  { decorations: (v) => v.decorations },
);

const modoFoco = [destaqueDoParagrafo, EditorView.editorAttributes.of({ class: 'modo-foco' })];

// ---------- o modo máquina de escrever ----------

const modoMaquina = [
  EditorView.editorAttributes.of({ class: 'modo-maquina' }),
  EditorState.transactionExtender.of((tr) => (tr.docChanged || tr.selection ? { effects: EditorView.scrollIntoView(tr.newSelection.main.head, { y: 'center' }) } : null)),
];

// ---------- o travessão e a formatação ----------

const travessao = EditorView.inputHandler.of((view, from, to, texto) => {
  if (texto !== '-' || from < 1 || view.state.sliceDoc(from - 1, from) !== '-') return false;
  view.dispatch({ changes: { from: from - 1, to, insert: '—' }, selection: { anchor: from }, userEvent: 'input.type' });
  return true;
});

/** Põe ou tira a marca (`**`, `*`) em volta de cada seleção. */
export function alternar(view: EditorView, marca: string): boolean {
  const { state } = view;
  const n = marca.length;
  view.dispatch(
    state.changeByRange((r) => {
      if (state.sliceDoc(r.from - n, r.from) === marca && state.sliceDoc(r.to, r.to + n) === marca) {
        return {
          changes: [
            { from: r.from - n, to: r.from },
            { from: r.to, to: r.to + n },
          ],
          range: EditorSelection.range(r.from - n, r.to - n),
        };
      }
      return {
        changes: [
          { from: r.from, insert: marca },
          { from: r.to, insert: marca },
        ],
        range: EditorSelection.range(r.from + n, r.to + n),
      };
    }),
    { userEvent: 'input' },
  );
  view.focus();
  return true;
}

/** Faz da linha do cursor um título (ou tira o título). */
export function alternarTitulo(view: EditorView): boolean {
  const { state } = view;
  const linha = state.doc.lineAt(state.selection.main.head);
  const m = /^#{1,6} /.exec(linha.text);
  view.dispatch({ changes: m ? { from: linha.from, to: linha.from + m[0].length } : { from: linha.from, insert: '# ' }, userEvent: 'input' });
  view.focus();
  return true;
}

// ---------- o tema (as cores vêm dos tokens) ----------

const tema = EditorView.theme({
  '&': { color: 'var(--tinta)', backgroundColor: 'transparent', height: '100%' },
  '&.cm-focused': { outline: 'none' },
  '.cm-scroller': { fontFamily: 'var(--fonte-texto)', lineHeight: '1.75', overflowX: 'hidden' },
  '.cm-content': { caretColor: 'var(--destaque)', padding: '2rem 0 40vh', maxWidth: '40rem', margin: '0 auto', whiteSpace: 'pre-wrap' },
  '.cm-line': { padding: '0 1.25rem' },
  '.cm-cursor': { borderLeftColor: 'var(--destaque)', borderLeftWidth: '2px' },
  '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection': { backgroundColor: 'var(--frio-claro)' },
  '.cm-placeholder': { color: 'var(--tinta-suave)', fontStyle: 'italic' },
});

// ---------- montar ----------

export interface OpcoesEditor {
  pai: HTMLElement;
  texto: string;
  rotulo: string;
  dica: string;
  maquina: boolean;
  foco: boolean;
  aoMudar: (texto: string) => void;
  aoSair: () => void;
  aoSelecionar: (view: EditorView) => void;
  aoIdeia: () => void;
  aoNovaCena: () => void;
}

export interface Editor {
  view: EditorView;
  modos(m: { maquina: boolean; foco: boolean }): void;
  /** Troca o texto inteiro (veio da nuvem, ou voltou uma versão): não conta como digitação. */
  trocarTexto(texto: string): void;
  destruir(): void;
}

export function criarEditor(o: OpcoesEditor): Editor {
  const compMaquina = new Compartment();
  const compFoco = new Compartment();
  const view = new EditorView({
    parent: o.pai,
    state: EditorState.create({
      doc: o.texto,
      extensions: [
        Prec.high(
          keymap.of([
            { key: 'Mod-b', run: (v) => alternar(v, '**'), preventDefault: true },
            { key: 'Mod-e', run: (v) => alternar(v, '*'), preventDefault: true },
            { key: 'Mod-i', run: () => (o.aoIdeia(), true), preventDefault: true },
            { key: 'Mod-Enter', run: () => (o.aoNovaCena(), true), preventDefault: true },
          ]),
        ),
        history(),
        keymap.of([...historyKeymap, ...defaultKeymap]),
        markdown(),
        EditorView.lineWrapping,
        travessao,
        marcas,
        tema,
        placeholder(o.dica),
        compMaquina.of(o.maquina ? modoMaquina : []),
        compFoco.of(o.foco ? modoFoco : []),
        EditorView.contentAttributes.of({ 'aria-label': o.rotulo, 'aria-multiline': 'true', 'data-teste': 'editor', spellcheck: 'true', autocapitalize: 'sentences' }),
        EditorView.updateListener.of((u) => {
          if (u.docChanged && !u.transactions.some((tr) => tr.annotation(deFora))) o.aoMudar(u.state.doc.toString());
          if (u.selectionSet || u.focusChanged || u.docChanged) o.aoSelecionar(u.view);
        }),
        EditorView.domEventHandlers({
          blur: () => {
            o.aoSair();
            return false;
          },
        }),
      ],
    }),
  });
  return {
    view,
    modos(m) {
      view.dispatch({ effects: [compMaquina.reconfigure(m.maquina ? modoMaquina : []), compFoco.reconfigure(m.foco ? modoFoco : [])] });
    },
    trocarTexto(texto) {
      if (texto === view.state.doc.toString()) return;
      const fim = Math.min(view.state.selection.main.head, texto.length);
      view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: texto }, selection: { anchor: fim }, annotations: deFora.of(true) });
    },
    destruir() {
      view.destroy();
    },
  };
}
