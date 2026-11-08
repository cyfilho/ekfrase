// SPDX-License-Identifier: MPL-2.0
/**
 * Acrescenta (ou troca) chaves de texto em pt-BR E en de uma vez, sem abrir os
 * JSONs (economiza leitura e evita esquecer um dos idiomas — o teste cobra os dois).
 *
 *   node scripts/chave.ts <arquivo> <chave> "<português>" "<inglês>" [--depois <chave>]
 *   node scripts/chave.ts --lote novas.json      { "vernakula": { "x.y": ["pt", "en"] } }
 *   node scripts/chave.ts --apagar <arquivo> <chave>
 *
 * <arquivo> é o nome em locales/<idioma>/<arquivo>.json (vernakula, nucleo…);
 * arquivo novo é criado nos dois idiomas. Outros idiomas que existirem
 * (es, fr…) recebem o texto em inglês, marcado para tradução no Editor de Textos.
 * Chave nova vai para o fim, ou logo depois de --depois.
 */
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { RAIZ } from './raiz.ts';

type Lote = Record<string, Record<string, readonly [string, string]>>;
const LOCALES = join(RAIZ, 'locales');
const idiomas = readdirSync(LOCALES).filter((n) => statSync(join(LOCALES, n)).isDirectory());

function gravar(arquivo: string, chave: string, pt: string, en: string, depois?: string): void {
  for (const idioma of idiomas) {
    const f = join(LOCALES, idioma, `${arquivo}.json`);
    const msgs: Record<string, string> = existsSync(f) ? (JSON.parse(readFileSync(f, 'utf8')) as Record<string, string>) : {};
    const texto = idioma === 'pt-BR' ? pt : en;
    const pares = Object.entries(msgs).filter(([k]) => k !== chave);
    const i = depois ? pares.findIndex(([k]) => k === depois) : -1;
    const pos = chave in msgs ? Object.keys(msgs).indexOf(chave) : i >= 0 ? i + 1 : pares.length;
    pares.splice(pos, 0, [chave, texto]);
    writeFileSync(f, JSON.stringify(Object.fromEntries(pares), null, 2) + '\n');
  }
}

function apagar(arquivo: string, chave: string): void {
  for (const idioma of idiomas) {
    const f = join(LOCALES, idioma, `${arquivo}.json`);
    if (!existsSync(f)) continue;
    const msgs = JSON.parse(readFileSync(f, 'utf8')) as Record<string, string>;
    delete msgs[chave];
    writeFileSync(f, JSON.stringify(msgs, null, 2) + '\n');
  }
}

const a = process.argv.slice(2);
if (a[0] === '--lote' && a[1]) {
  const lote = JSON.parse(readFileSync(a[1], 'utf8')) as Lote;
  let n = 0;
  for (const [arquivo, chaves] of Object.entries(lote)) {
    let anterior: string | undefined;
    for (const [chave, [pt, en]] of Object.entries(chaves)) {
      gravar(arquivo, chave, pt, en, anterior);
      anterior = chave;
      n++;
    }
  }
  console.log(`${n} chaves gravadas em ${idiomas.join(', ')}.`);
} else if (a[0] === '--apagar' && a[1] && a[2]) {
  apagar(a[1], a[2]);
  console.log(`Apagada: ${a[1]}.${a[2]}`);
} else if (a.length >= 4) {
  const d = a.indexOf('--depois');
  gravar(a[0]!, a[1]!, a[2]!, a[3]!, d > 0 ? a[d + 1] : undefined);
  console.log(`Gravada: ${a[0]}.${a[1]}`);
} else {
  console.error('Uso: node scripts/chave.ts <arquivo> <chave> "<pt>" "<en>" [--depois <chave>]  |  --lote arq.json  |  --apagar <arquivo> <chave>');
  process.exit(1);
}
