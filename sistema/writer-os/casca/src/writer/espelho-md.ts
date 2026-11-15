// SPDX-License-Identifier: MPL-2.0

/**
 * O espelho `.md` do WRITER: o que deve estar na pasta do espelho, a partir do armazém. Usa as
 * mesmas funções do "Exportar em Markdown" do app (`historiaEmArquivos`, `exportarIdeiasMd`), então
 * cada cena é um `.md` que abre em qualquer editor e volta igual pelo Importar do app:
 *
 *   <História>/historia.md, personagens.md, ideias.md
 *   <História>/NN - <Capítulo>/capitulo.md + NN - <Cena>.md
 *   ideias.md                (as ideias soltas)
 *
 * Duas histórias com o mesmo título (ou que só mudam em maiúsculas, que no Windows é a mesma pasta)
 * ganham " (2)", " (3)"… na ordem em que foram criadas.
 */
import { exportarIdeiasMd, historiaEmArquivos, nomeSeguro, type Escrita } from '@ekfrase/writer-nucleo';

export async function arquivosDoEspelho(escrita: Escrita): Promise<Record<string, string>> {
  const saida: Record<string, string> = {};
  const usados = new Set<string>();
  const historias = [...(await escrita.historias())].sort((a, b) => (a.id < b.id ? -1 : 1));
  for (const h of historias) {
    const base = nomeSeguro(h.titulo) || 'historia';
    let pasta = base;
    for (let n = 2; usados.has(pasta.toLowerCase()) || pasta.toLowerCase() === 'ideias.md'; n++) pasta = `${base} (${n})`;
    usados.add(pasta.toLowerCase());
    Object.assign(saida, historiaEmArquivos(await escrita.completa(h.id), pasta));
  }
  const soltas = await escrita.ideias({ historia: null });
  if (soltas.length) saida['ideias.md'] = exportarIdeiasMd(soltas);
  return saida;
}
