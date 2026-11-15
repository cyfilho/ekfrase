// SPDX-License-Identifier: MPL-2.0

/**
 * As teclas do navegador que nunca chegam a ele: recarregar, ferramentas do desenvolvedor, abrir,
 * imprimir, salvar a página, ver o código, janela e aba novas. (Sem menu, o Electron já não faz
 * quase nada disso; aqui é a segunda tranca.) As teclas que o APP usa passam sempre: Ctrl+K, F1,
 * Ctrl+I/B/E, Ctrl+Z/Y/Shift+Z, Ctrl+Enter, Ctrl+, , Alt+setas…
 */
const SEMPRE = new Set(['F5', 'F12', 'BrowserBack', 'BrowserForward', 'BrowserRefresh', 'BrowserHome', 'BrowserSearch']);
const COM_CTRL = new Set(['r', 'o', 'p', 's', 'u', 'n', 't', 'w', 'q', 'j', 'h', 'F5']);
const COM_CTRL_SHIFT = new Set(['i', 'j', 'c', 'r', 'n', 't', 'w', 'o', 'delete']);

export function teclaProibida(i: { key: string; control: boolean; meta: boolean; shift: boolean; alt: boolean }): boolean {
  const k = i.key.length === 1 ? i.key.toLowerCase() : i.key;
  const ctrl = i.control || i.meta;
  if (SEMPRE.has(i.key)) return true;
  if (ctrl && i.shift && COM_CTRL_SHIFT.has(k.length === 1 ? k : k.toLowerCase())) return true;
  if (ctrl && !i.shift && !i.alt && COM_CTRL.has(k)) return true;
  return i.alt && !ctrl && k === 'Home';
}
