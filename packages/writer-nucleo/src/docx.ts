// SPDX-License-Identifier: MPL-2.0

/**
 * EXPORTAR `.docx` no formato de MANUSCRITO PADRÃO: Times New Roman 12, espaço duplo, recuo na
 * primeira linha, cada capítulo numa página nova, `#` centrado entre as cenas. O itálico e o
 * negrito do Markdown viram itálico e negrito de verdade.
 *
 * O arquivo é montado à mão (OOXML mínimo: 4 entradas num ZIP), sem biblioteca: é pequeno, abre no
 * Word, no LibreOffice e no Google Docs, e mesmos dados = mesmos bytes.
 */
import { strToU8, zipSync } from 'fflate';
import type { HistoriaCompleta } from './dominio.ts';

export const TIPO_DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

const DATA_ZIP = new Date(2026, 0, 1, 0, 0, 0);

/** Um trecho de texto com a sua formatação. */
export interface Trecho {
  texto: string;
  italico: boolean;
  negrito: boolean;
}

const ALFANUM = /[\p{L}\p{N}]/u;

/**
 * O Markdown de UMA linha em trechos: `*itálico*` ou `_itálico_`, `**negrito**` ou `__negrito__`,
 * `***os dois***`; `\*` é um asterisco de verdade. Marca sem par fica como está no texto.
 */
export function trechos(linha: string): Trecho[] {
  type Peca = { marca: false; texto: string } | { marca: true; texto: string; par: number };
  const pecas: Peca[] = [];
  let texto = '';
  const fecharTexto = (): void => {
    if (texto) pecas.push({ marca: false, texto });
    texto = '';
  };
  for (let i = 0; i < linha.length; ) {
    const c = linha[i]!;
    if (c === '\\' && i + 1 < linha.length && /[\\*_#`]/.test(linha[i + 1]!)) {
      texto += linha[i + 1]!;
      i += 2;
      continue;
    }
    if (c === '*' || c === '_') {
      let n = 1;
      while (linha[i + n] === c) n++;
      const antes = linha[i - 1] ?? ' ';
      const depois = linha[i + n] ?? ' ';
      // `_` no meio de uma palavra (nome_de_arquivo) e marca solta entre espaços não formatam
      const solta = (c === '_' && ALFANUM.test(antes) && ALFANUM.test(depois)) || (/\s/.test(antes) && /\s/.test(depois)) || n > 3;
      if (solta) texto += c.repeat(n);
      else {
        fecharTexto();
        pecas.push({ marca: true, texto: c.repeat(n), par: -1 });
      }
      i += n;
      continue;
    }
    texto += c;
    i += 1;
  }
  fecharTexto();
  // cada marca casa com a próxima igual; a que sobra vira texto
  for (let i = 0; i < pecas.length; i++) {
    const p = pecas[i]!;
    if (!p.marca || p.par !== -1) continue;
    const j = pecas.findIndex((q, k) => k > i && q.marca && q.par === -1 && q.texto === p.texto);
    if (j > 0) {
      p.par = j;
      (pecas[j] as { par: number }).par = i;
    }
  }
  const saida: Trecho[] = [];
  let italico = false;
  let negrito = false;
  const juntar = (t: string): void => {
    const ultimo = saida.at(-1);
    if (ultimo && ultimo.italico === italico && ultimo.negrito === negrito) ultimo.texto += t;
    else saida.push({ texto: t, italico, negrito });
  };
  for (const p of pecas) {
    if (!p.marca || p.par === -1) {
      juntar(p.texto);
      continue;
    }
    const n = p.texto.length;
    if (n === 1 || n === 3) italico = !italico;
    if (n === 2 || n === 3) negrito = !negrito;
  }
  return saida.filter((t) => t.texto !== '');
}

const xml = (t: string): string =>
  t
    // caracteres que o XML 1.0 não aceita
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f￾￿]/g, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

function corrida(t: Trecho, forcarNegrito = false): string {
  const negrito = t.negrito || forcarNegrito;
  const rpr = negrito || t.italico ? `<w:rPr>${negrito ? '<w:b/>' : ''}${t.italico ? '<w:i/>' : ''}</w:rPr>` : '';
  return `<w:r>${rpr}<w:t xml:space="preserve">${xml(t.texto)}</w:t></w:r>`;
}

interface Estilo {
  centro?: boolean;
  paginaNova?: boolean;
  negrito?: boolean;
  /** Sem o recuo da primeira linha. */
  semRecuo?: boolean;
}

function paragrafo(linha: string, e: Estilo = {}): string {
  const ppr = `${e.paginaNova ? '<w:pageBreakBefore/>' : ''}${e.centro ? '<w:jc w:val="center"/>' : ''}${e.centro || e.semRecuo ? '<w:ind w:firstLine="0"/>' : ''}`;
  return `<w:p>${ppr ? `<w:pPr>${ppr}</w:pPr>` : ''}${trechos(linha)
    .map((t) => corrida(t, e.negrito))
    .join('')}</w:p>`;
}

const QUEBRA_DE_CENA = /^\s*(?:\*\s*\*\s*\*|-\s*-\s*-|_\s*_\s*_)[\s*_-]*$/;
const TITULO = /^#{1,6}\s+(.*)$/;

/** O texto de uma cena em parágrafos: cada linha não vazia é um parágrafo. */
function texto(md: string): string[] {
  const saida: string[] = [];
  for (const linha of md.replace(/\r\n?/g, '\n').split('\n')) {
    if (linha.trim() === '') continue;
    const titulo = TITULO.exec(linha);
    if (titulo) saida.push(paragrafo(titulo[1]!, { centro: true, negrito: true }));
    else if (QUEBRA_DE_CENA.test(linha)) saida.push(paragrafo('#', { centro: true }));
    else saida.push(paragrafo(linha.trim()));
  }
  return saida;
}

const TIPOS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>`;

const RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`;

const RELS_DO_DOCUMENTO = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`;

/** Times New Roman 12 (24 meios-pontos), espaço duplo (480), recuo de 1,27 cm (720) na primeira linha. */
const ESTILOS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman" w:eastAsia="Times New Roman" w:cs="Times New Roman"/><w:sz w:val="24"/><w:szCs w:val="24"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:before="0" w:after="0" w:line="480" w:lineRule="auto"/><w:ind w:firstLine="720"/></w:pPr></w:pPrDefault></w:docDefaults><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style></w:styles>`;

/** O `word/document.xml` do manuscrito. */
export function documentoXml(h: HistoriaCompleta): string {
  const corpo: string[] = [];
  corpo.push(paragrafo(h.historia.titulo, { centro: true, negrito: true }));
  if (h.historia.subtitulo.trim()) corpo.push(paragrafo(h.historia.subtitulo, { centro: true }));

  const cenas = (lista: readonly { texto: string }[], abre: string | null): void => {
    let primeiro = abre === null;
    let teveCena = false;
    if (abre !== null) corpo.push(abre);
    for (const cena of lista) {
      const ps = texto(cena.texto);
      if (!ps.length) continue;
      if (teveCena) corpo.push(paragrafo('#', { centro: true }));
      if (primeiro) {
        // cenas soltas: a primeira abre a página depois da folha de rosto
        ps[0] = ps[0]!.replace('<w:p>', '<w:p><w:pPr><w:pageBreakBefore/></w:pPr>').replace('<w:pPr><w:pageBreakBefore/></w:pPr><w:pPr>', '<w:pPr><w:pageBreakBefore/>');
        primeiro = false;
      }
      corpo.push(...ps);
      teveCena = true;
    }
  };
  cenas(h.soltas, null);
  for (const { capitulo, cenas: lista } of h.capitulos) cenas(lista, paragrafo(capitulo.titulo, { centro: true, negrito: true, paginaNova: true }));

  // A4, margens de 2,54 cm
  const secao = '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="708" w:footer="708" w:gutter="0"/></w:sectPr>';
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${corpo.join('')}${secao}</w:body></w:document>`;
}

/** A história como `.docx` de manuscrito padrão. */
export function exportarDocx(h: HistoriaCompleta): Uint8Array {
  return zipSync(
    {
      '[Content_Types].xml': strToU8(TIPOS),
      '_rels/.rels': strToU8(RELS),
      'word/document.xml': strToU8(documentoXml(h)),
      'word/styles.xml': strToU8(ESTILOS),
      'word/_rels/document.xml.rels': strToU8(RELS_DO_DOCUMENTO),
    },
    { level: 6, mtime: DATA_ZIP },
  );
}
