// SPDX-License-Identifier: MPL-2.0

/**
 * As anotações do leitor: um trecho do capítulo (posição no TEXTO do capítulo, em caracteres, que
 * não muda quando os destaques são desenhados), a cor e a nota. Ficam nos dados do livro no
 * inventário (`ponte.gravarDadosDoItem('livros', id, dados)`), junto com onde a pessoa parou.
 */

export type Cor = 'amarelo' | 'verde' | 'azul' | 'rosa';
export const CORES: readonly Cor[] = ['amarelo', 'verde', 'azul', 'rosa'];

export interface Anotacao {
  id: string;
  capitulo: number;
  inicio: number;
  fim: number;
  /** O trecho (para a lista e a exportação). */
  texto: string;
  nota: string;
  cor: Cor;
  criada: string;
}

/** O que fica no inventário para cada livro. */
export interface DadosLivro {
  capitulo: number;
  /** Quanto do capítulo já foi (0 a 1). */
  fracao: number;
  anotacoes: Anotacao[];
}

export const novosDados = (): DadosLivro => ({ capitulo: 1, fracao: 0, anotacoes: [] });

/** Confere o que veio da nuvem (dados velhos ou estragados viram o padrão). */
export function lerDados(d: unknown): DadosLivro {
  const o = (d ?? {}) as Partial<DadosLivro>;
  return {
    capitulo: Number.isInteger(o.capitulo) && o.capitulo! > 0 ? o.capitulo! : 1,
    fracao: typeof o.fracao === 'number' ? Math.min(1, Math.max(0, o.fracao)) : 0,
    anotacoes: Array.isArray(o.anotacoes)
      ? o.anotacoes.filter((a): a is Anotacao => Boolean(a) && typeof a.id === 'string' && Number.isInteger(a.inicio) && Number.isInteger(a.fim) && a.fim > a.inicio)
      : [],
  };
}

// ---------- posição no texto ----------

function textos(raiz: Node): Text[] {
  const out: Text[] = [];
  const w = document.createTreeWalker(raiz, NodeFilter.SHOW_TEXT);
  for (let n = w.nextNode(); n; n = w.nextNode()) out.push(n as Text);
  return out;
}

/** A posição (em caracteres do texto do capítulo) de um ponto da seleção. */
export function posicao(raiz: Node, no: Node, desloc: number): number {
  if (no.nodeType !== Node.TEXT_NODE) {
    // ponto entre elementos: conta o texto de tudo o que vem antes
    const r = document.createRange();
    r.setStart(raiz, 0);
    r.setEnd(no, desloc);
    return r.toString().length;
  }
  let total = 0;
  for (const t of textos(raiz)) {
    if (t === no) return total + desloc;
    total += t.data.length;
  }
  return total;
}

/** O trecho selecionado dentro de `raiz`, ou null. */
export function selecaoEm(raiz: HTMLElement): { inicio: number; fim: number; texto: string; caixa: DOMRect } | null {
  const s = getSelection();
  if (!s || s.isCollapsed || s.rangeCount === 0) return null;
  const r = s.getRangeAt(0);
  if (!raiz.contains(r.commonAncestorContainer)) return null;
  const inicio = posicao(raiz, r.startContainer, r.startOffset);
  const fim = posicao(raiz, r.endContainer, r.endOffset);
  const texto = r.toString().replace(/\s+/g, ' ').trim();
  if (fim <= inicio || !texto) return null;
  return { inicio, fim, texto, caixa: r.getBoundingClientRect() };
}

/** Desenha os destaques do capítulo (cada pedaço de texto dentro do trecho vira um <mark>). */
export function marcar(raiz: HTMLElement, anotacoes: readonly Anotacao[]): void {
  for (const a of [...anotacoes].sort((x, y) => y.inicio - x.inicio)) {
    let total = 0;
    for (const t of textos(raiz)) {
      const ini = total;
      const fimNo = total + t.data.length;
      total = fimNo;
      if (fimNo <= a.inicio || ini >= a.fim) continue;
      const de = Math.max(0, a.inicio - ini);
      const ate = Math.min(t.data.length, a.fim - ini);
      if (ate <= de || !t.data.slice(de, ate).trim()) continue;
      const r = document.createRange();
      r.setStart(t, de);
      r.setEnd(t, ate);
      const m = document.createElement('mark');
      m.className = `destaque cor-${a.cor}${a.nota ? ' com-nota' : ''}`;
      m.dataset['anotacao'] = a.id;
      r.surroundContents(m);
    }
  }
}

// ---------- exportar ----------

export function exportar(formato: 'md' | 'txt', livro: { titulo: string; autor: string }, sumario: readonly string[], anotacoes: readonly Anotacao[], rotulos: { nota: string; exportado: string }): Blob {
  const ordem = [...anotacoes].sort((a, b) => a.capitulo - b.capitulo || a.inicio - b.inicio);
  const linhas: string[] = [];
  if (formato === 'md') {
    linhas.push(`# ${livro.titulo}`, `*${livro.autor}*`, '', `_${rotulos.exportado}_`, '');
    let cap = 0;
    for (const a of ordem) {
      if (a.capitulo !== cap) {
        cap = a.capitulo;
        linhas.push(`## ${sumario[cap - 1] ?? cap}`, '');
      }
      linhas.push(`> ${a.texto}`, '');
      if (a.nota) linhas.push(`**${rotulos.nota}:** ${a.nota}`, '');
    }
  } else {
    linhas.push(livro.titulo, livro.autor, '', rotulos.exportado, '');
    let cap = 0;
    for (const a of ordem) {
      if (a.capitulo !== cap) {
        cap = a.capitulo;
        linhas.push('', `== ${sumario[cap - 1] ?? cap} ==`, '');
      }
      linhas.push(`“${a.texto}”`);
      if (a.nota) linhas.push(`  ${rotulos.nota}: ${a.nota}`);
      linhas.push('');
    }
  }
  return new Blob([linhas.join('\n')], { type: formato === 'md' ? 'text/markdown;charset=utf-8' : 'text/plain;charset=utf-8' });
}

export function baixar(blob: Blob, nome: string): void {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = nome;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
