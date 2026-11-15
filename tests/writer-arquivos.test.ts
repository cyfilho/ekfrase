// SPDX-License-Identifier: MPL-2.0

/**
 * Exportar e importar do Writer: Markdown (pasta em .zip e arquivo único), `.docx` de manuscrito
 * e `.ekfr`. O que sai volta igual (ida e volta), e importar sempre cria registros NOVOS.
 */
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { gravarEkfr, identificar, lerEkfr } from '../packages/arquivo/src/index.ts';
import {
  ArmazemMemoria,
  Escrita,
  FORMATO_EKFR,
  cenaEmMd,
  documentoXml,
  exportarDocx,
  exportarEkfrHistoria,
  exportarEkfrIdeias,
  exportarHistoriaMd,
  exportarHistoriaZip,
  exportarIdeiasMd,
  exportarTudoZip,
  historiaEmArquivos,
  historiaParaArquivo,
  importarArquivo,
  importarEkfr,
  importarIdeiasMd,
  importarMd,
  importarZip,
  LIMITES_ZIP,
  MAX_TEXTO_CENA,
  zipGrandeDemais,
  lerCenaMd,
  lerHistoriaMd,
  lerPasta,
  nomeSeguro,
  tituloDoNome,
  trechos,
  type HistoriaCompleta,
  type HistoriaImportada,
} from '../packages/writer-nucleo/src/index.ts';

const T0 = 1794480000000;

function nova(): Escrita {
  let t = T0;
  const agora = (): number => ++t;
  return new Escrita(new ArmazemMemoria({ dono: 'ana', aparelho: 'aaaaaaaa', agora }), { agora, dia: () => '2026-11-12' });
}

/** Textos escolhidos para quebrar um leitor de Markdown descuidado. */
const TEXTO_DIFICIL = ['— Você *vem*? — perguntou **ela**.', '', '# isto é texto, não título', '## nem isto', '\\# barra de verdade', '---', 'chave: valor', '<!-- {"titulo":"falso"} -->', '   espaços no começo e no fim   ', '', '', 'Último parágrafo, com "aspas", <tags> & e-comercial.'].join('\n');

async function historiaDeExemplo(e: Escrita): Promise<string> {
  const h = await e.criarHistoria({
    titulo: 'A torre: o começo / "parte" 1?',
    subtitulo: 'Um romance',
    genero: 'fantasia',
    formato: 'romance',
    logline: 'Uma torre que cresce sozinha.',
    sinopse: 'Primeira linha da sinopse.\n\nSegunda, com # no meio.',
    tema: 'ambição',
    publico: 'adulto',
    ponto_vista: '3ª pessoa',
    tempo_verbal: 'passado',
    meta_palavras: 80000,
    capa: { cor: 'azul', semente: 7 },
  });
  await e.criarCena(h.id, { titulo: 'Prólogo', texto: 'Antes de tudo, o vento.', status: 'final' });
  await e.criarCena(h.id, { titulo: '', texto: '' });
  const c1 = await e.criarCapitulo(h.id, { titulo: 'A fundação', resumo: 'Onde tudo começa.\nEm duas linhas.' });
  await e.criarCena(h.id, { titulo: 'A pedra', capitulo: c1.id, texto: TEXTO_DIFICIL, resumo: 'r', objetivo: 'o', conflito: 'c', desfecho: 'd', meta_palavras: 1200, status: 'revisada' });
  await e.criarCena(h.id, { titulo: 'A pedra', capitulo: c1.id, texto: 'Mesmo título, outra cena.\n' });
  const c2 = await e.criarCapitulo(h.id, { titulo: '' });
  await e.criarCena(h.id, { titulo: 'Fim?', capitulo: c2.id, texto: '\nComeça e termina com linha vazia.\n\n', status: 'ideia' });
  await e.criarCapitulo(h.id, { titulo: 'Capítulo vazio' });
  await e.criarPersonagem(h.id, { nome: 'Lia', papel: 'protagonista', desejo: 'subir', necessidade: 'descer', medo: 'altura', notas: 'Notas da Lia.\n\n## com um título dentro' });
  await e.criarPersonagem(h.id, { nome: 'Zeca' });
  await e.criarIdeia({ historia: h.id, titulo: 'E se a torre falasse?', tipo: 'reviravolta', texto: 'Ela fala.\n\nBaixinho.', etiquetas: ['torre', 'voz'], fixada: true });
  await e.criarIdeia({ historia: h.id, titulo: 'Sem nada' });
  return h.id;
}

/** A história como vai para um arquivo, com as listas sem ordem própria (ideias) ordenadas. */
function normal(h: HistoriaCompleta): HistoriaImportada {
  const a = historiaParaArquivo(h);
  return { ...a, ideias: [...a.ideias].sort((x, y) => String(x['titulo']).localeCompare(String(y['titulo']))) };
}

describe('exportar e importar Markdown', () => {
  it('pasta em .zip: uma pasta, capítulos e cenas numerados; ida e volta sem perda', async () => {
    const e = nova();
    const id = await historiaDeExemplo(e);
    const original = await e.completa(id);
    const zip = exportarHistoriaZip(original);
    const nomes = Object.keys(unzipSync(zip)).sort();
    expect(nomes).toEqual([
      'A torre o começo parte 1/01 - Prólogo.md',
      'A torre o começo parte 1/02.md',
      'A torre o começo parte 1/03 - A fundação/01 - A pedra.md',
      'A torre o começo parte 1/03 - A fundação/02 - A pedra.md',
      'A torre o começo parte 1/03 - A fundação/capitulo.md',
      'A torre o começo parte 1/04/01 - Fim.md',
      'A torre o começo parte 1/04/capitulo.md',
      'A torre o começo parte 1/05 - Capítulo vazio/capitulo.md',
      'A torre o começo parte 1/historia.md',
      'A torre o começo parte 1/ideias.md',
      'A torre o começo parte 1/personagens.md',
    ]);
    // mesmos dados = mesmos bytes
    expect(exportarHistoriaZip(original)).toEqual(zip);
    // um arquivo de cena abre em qualquer editor: título e texto à vista
    const arquivos = historiaEmArquivos(original);
    expect(arquivos['A torre o começo parte 1/01 - Prólogo.md']).toBe('---\nstatus: "final"\n---\n\n# Prólogo\n\nAntes de tudo, o vento.\n');

    const r = await importarZip(e, zip);
    expect(r).toMatchObject({ ok: true, ideias: 0 });
    if (!r.ok) return;
    expect(r.historias).toHaveLength(1);
    expect(r.historias[0]).not.toBe(id);
    const volta = await e.completa(r.historias[0]!);
    expect(normal(volta)).toEqual(normal(original));
    // registros NOVOS: nenhum id repetido, e o original continua lá
    const idsDe = (h: HistoriaCompleta): string[] => [h.historia.id, ...h.soltas.map((c) => c.id), ...h.capitulos.flatMap((c) => [c.capitulo.id, ...c.cenas.map((x) => x.id)]), ...h.personagens.map((p) => p.id), ...h.ideias.map((i) => i.id)];
    expect(idsDe(volta).filter((x) => idsDe(original).includes(x))).toEqual([]);
    expect(await e.historias()).toHaveLength(2);
    // o que o núcleo calcula foi recalculado
    const pedra = volta.capitulos[0]!.cenas[0]!;
    expect(pedra.palavras).toBe(original.capitulos[0]!.cenas[0]!.palavras);
    expect(pedra).toMatchObject({ historia: volta.historia.id, capitulo: volta.capitulos[0]!.capitulo.id, conflito_de: null });
    expect((await e.totais(volta.historia.id)).palavras).toBe((await e.totais(id)).palavras);
  });

  it('tudo num arquivo só: ida e volta sem perda', async () => {
    const e = nova();
    const id = await historiaDeExemplo(e);
    const original = await e.completa(id);
    const md = exportarHistoriaMd(original);
    expect(md.startsWith('---\nekfrase_writer: 1\n')).toBe(true);
    expect(md).toContain('\n# A torre: o começo / "parte" 1?\n');
    expect(md).toContain('\n## A fundação\n');
    expect(md).toContain('\n### Prólogo\n');
    expect(md).toContain('\n\\# isto é texto, não título\n');
    const r = await importarMd(e, md, 'qualquer.md');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const volta = await e.completa(r.historias[0]!);
    // o arquivo único não leva personagens nem ideias (vão no .zip e no .ekfr)
    expect({ ...normal(volta), personagens: [], ideias: [] }).toEqual({ ...normal(original), personagens: [], ideias: [] });
    expect(volta.capitulos[0]!.cenas[0]!.texto).toBe(TEXTO_DIFICIL);
    // com fim de linha do Windows e BOM também
    const r2 = await importarMd(e, `\ufeff${md.replace(/\n/g, '\r\n')}`);
    expect(r2.ok && normal(await e.completa(r2.historias[0]!)).capitulos).toEqual(normal(original).capitulos);
  });

  it('várias histórias e as ideias soltas num .zip só', async () => {
    const e = nova();
    const a = await historiaDeExemplo(e);
    const b = await e.criarHistoria({ titulo: 'Segunda' });
    await e.criarCena(b.id, { titulo: 'única', texto: 'Só isto.' });
    const mesmoNome = await e.criarHistoria({ titulo: 'Segunda' });
    await e.criarIdeia({ titulo: 'Solta 1', texto: 'Um.', tipo: 'titulo' });
    await e.criarIdeia({ titulo: 'Solta 2', etiquetas: ['x'] });
    const zip = exportarTudoZip([await e.completa(a), await e.completa(b.id), await e.completa(mesmoNome.id)], await e.ideias({ historia: null }));
    const nomes = Object.keys(unzipSync(zip));
    expect(nomes).toContain('ideias.md');
    expect(nomes).toContain('Segunda/historia.md');
    expect(nomes).toContain('Segunda (2)/historia.md');

    const outro = nova();
    const r = await importarArquivo(outro, 'tudo.zip', zip);
    expect(r).toMatchObject({ ok: true, ideias: 2 });
    expect((await outro.historias()).map((h) => h.titulo).sort()).toEqual(['A torre: o começo / "parte" 1?', 'Segunda', 'Segunda']);
    expect((await outro.ideias({ historia: null })).map((i) => [i.titulo, i.tipo, i.texto, i.etiquetas]).sort()).toEqual([
      ['Solta 1', 'titulo', 'Um.', []],
      ['Solta 2', 'outro', '', ['x']],
    ]);
  });

  it('ideias.md sozinho: ida e volta', async () => {
    const e = nova();
    await e.criarIdeia({ titulo: 'Farol', tipo: 'cenario', texto: 'Um farol.\n\n## Dentro dele\n\nEscuro.', etiquetas: ['mar'], fixada: true });
    await e.criarIdeia({ titulo: 'Vazia' });
    const md = exportarIdeiasMd(await e.ideias());
    expect(md).toContain('## Farol\n<!-- {"tipo":"cenario","etiquetas":["mar"],"fixada":true} -->\n\nUm farol.');
    const outro = nova();
    expect(await importarArquivo(outro, 'C:\\Users\\ana\\ideias.md', strToU8(md))).toEqual({ ok: true, historias: [], ideias: 2 });
    expect(await importarIdeiasMd(outro, '')).toEqual({ ok: false, erro: 'vazio' });
    const lidas = (await outro.ideias()).map((i) => ({ titulo: i.titulo, tipo: i.tipo, texto: i.texto, etiquetas: i.etiquetas, fixada: i.fixada, historia: i.historia }));
    expect(lidas).toEqual([
      { titulo: 'Farol', tipo: 'cenario', texto: 'Um farol.\n\n## Dentro dele\n\nEscuro.', etiquetas: ['mar'], fixada: true, historia: null },
      { titulo: 'Vazia', tipo: 'outro', texto: '', etiquetas: [], fixada: false, historia: null },
    ]);
  });

  it('Markdown de outros programas entra do melhor jeito: # título, ## capítulo, ### cena', async () => {
    const md = ['# Meu romance', '', 'Um começo sem cena.', '', '## Capítulo 1', '', 'Texto direto no capítulo.', '', '### A festa', '', 'Dançaram.', '', '#', '', 'Depois da festa.', '', '## Capítulo 2', '### Sem texto'].join('\n');
    const h = lerHistoriaMd(md, 'romance.md');
    expect(h.campos).toEqual({ titulo: 'Meu romance' });
    expect(h.soltas).toEqual([{ titulo: '', texto: 'Um começo sem cena.' }]);
    expect(h.capitulos).toEqual([
      { campos: { titulo: 'Capítulo 1' }, cenas: [{ titulo: '', texto: 'Texto direto no capítulo.' }, { titulo: 'A festa', texto: 'Dançaram.\n\n#\n\nDepois da festa.' }] },
      { campos: { titulo: 'Capítulo 2' }, cenas: [{ titulo: 'Sem texto', texto: '' }] },
    ]);
    // sem título: vale o nome do arquivo; um segundo "#" é capítulo
    const semTitulo = lerHistoriaMd('Só texto.\n', 'pasta/03 - Meu conto.md');
    expect(semTitulo.campos).toEqual({ titulo: 'Meu conto' });
    expect(semTitulo.soltas).toEqual([{ titulo: '', texto: 'Só texto.' }]);
    expect(lerHistoriaMd('# Livro\n# Parte um\ntexto\n# Parte dois\n').capitulos.map((c) => c.campos['titulo'])).toEqual(['Parte um', 'Parte dois']);
    expect(tituloDoNome('12 - A chegada.md')).toBe('A chegada');
    expect(tituloDoNome('07.md')).toBe('');
    expect(tituloDoNome('2001 odisseia.markdown')).toBe('2001 odisseia');
    expect(lerCenaMd('Sem título no arquivo.\n', '02 - Do nome.md')).toEqual({ titulo: 'Do nome', texto: 'Sem título no arquivo.' });
    expect(lerCenaMd(cenaEmMd({ ...(await exemploDeCena()), titulo: 'T', texto: '---\nnão é cabeçalho\n---\n' }))).toMatchObject({ titulo: 'T', texto: '---\nnão é cabeçalho\n---\n' });

    // importar de verdade: campos desconhecidos ou de tipo errado são ignorados, sem derrubar
    const e = nova();
    const r = await importarMd(e, '---\ngenero: "conto"\nmeta_palavras: "muitas"\nhistoria: "id-de-outro"\nstatus: 12\ninventado: true\n---\n# Título\n\n### Cena\n<!-- {"status":"nao-existe","meta_palavras":300,"palavras":999999} -->\n\nUma duas três.\n');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const c = await e.completa(r.historias[0]!);
    expect(c.historia).toMatchObject({ titulo: 'Título', genero: 'conto', meta_palavras: 0 });
    expect(c.historia).not.toHaveProperty('inventado');
    expect(c.soltas).toMatchObject([{ titulo: 'Cena', status: 'rascunho', meta_palavras: 300, palavras: 3, texto: 'Uma duas três.' }]);
    expect(await importarMd(e, '  \n')).toEqual({ ok: false, erro: 'vazio' });
  });

  it('pastas de outros programas: sem historia.md, com embrulho, com arquivos escondidos', () => {
    const p = lerPasta({
      'Meu livro/10 - Final.md': 'fim',
      'Meu livro/2 - Meio.md': '# Meio de verdade\n\nmeio',
      'Meu livro/1 - Parte A/2 - b.md': 'b',
      'Meu livro/1 - Parte A/1 - a.md': 'a',
      'Meu livro/.obsidian/config.md': 'lixo',
      '__MACOSX/Meu livro/._x.md': 'lixo',
      'Meu livro/capa.png': 'não é texto',
    });
    expect(p.ideias).toEqual([]);
    expect(p.historias).toEqual([
      {
        campos: { titulo: 'Meu livro' },
        soltas: [{ titulo: 'Meio de verdade', texto: 'meio' }, { titulo: 'Final', texto: 'fim' }],
        capitulos: [{ campos: { titulo: 'Parte A' }, cenas: [{ titulo: 'a', texto: 'a' }, { titulo: 'b', texto: 'b' }] }],
        personagens: [],
        ideias: [],
      },
    ]);
    expect(lerPasta({})).toEqual({ historias: [], ideias: [] });
    expect(lerPasta({ 'ideias.md': '## Uma\n\ntexto\n' })).toEqual({ historias: [], ideias: [{ titulo: 'Uma', texto: 'texto' }] });
    expect(nomeSeguro('  a/b\\c: d*e?"f"<g>|h.  ')).toBe('abc defgh');
    expect(nomeSeguro('...')).toBe('');
    expect(nomeSeguro('x'.repeat(200))).toHaveLength(60);
  });
});

async function exemploDeCena(): Promise<Awaited<ReturnType<Escrita['criarCena']>>> {
  const e = nova();
  const h = await e.criarHistoria({ titulo: 'H' });
  return e.criarCena(h.id, { titulo: 'c' });
}

describe('exportar .docx (manuscrito padrão)', () => {
  it('trechos: itálico e negrito do Markdown', () => {
    const t = (linha: string): [string, string][] => trechos(linha).map((x) => [x.texto, `${x.italico ? 'i' : ''}${x.negrito ? 'b' : ''}`]);
    expect(t('simples')).toEqual([['simples', '']]);
    expect(t('um *dois* três')).toEqual([['um ', ''], ['dois', 'i'], [' três', '']]);
    expect(t('um _dois_ **três** __quatro__')).toEqual([['um ', ''], ['dois', 'i'], [' ', ''], ['três', 'b'], [' ', ''], ['quatro', 'b']]);
    expect(t('***os dois***')).toEqual([['os dois', 'ib']]);
    expect(t('**negrito com *itálico* dentro**')).toEqual([['negrito com ', 'b'], ['itálico', 'ib'], [' dentro', 'b']]);
    expect(t('nome_de_arquivo e 2 * 3 * 4')).toEqual([['nome_de_arquivo e 2 * 3 * 4', '']]);
    expect(t('asterisco \\*de verdade\\* e sobra *sem par')).toEqual([['asterisco *de verdade* e sobra *sem par', '']]);
    expect(t('')).toEqual([]);
  });

  it('o arquivo: Times New Roman 12, espaço duplo, página nova por capítulo', async () => {
    const e = nova();
    const id = await historiaDeExemplo(e);
    const completa = await e.completa(id);
    const docx = exportarDocx(completa);
    expect(exportarDocx(completa)).toEqual(docx);
    const z = unzipSync(docx);
    expect(Object.keys(z).sort()).toEqual(['[Content_Types].xml', '_rels/.rels', 'word/_rels/document.xml.rels', 'word/document.xml', 'word/styles.xml']);
    const estilos = strFromU8(z['word/styles.xml']!);
    expect(estilos).toContain('w:ascii="Times New Roman"');
    expect(estilos).toContain('<w:sz w:val="24"/>'); // 12 pt
    expect(estilos).toContain('w:line="480" w:lineRule="auto"'); // espaço duplo
    const doc = strFromU8(z['word/document.xml']!);
    expect(doc).toBe(documentoXml(completa));
    // folha de rosto, depois as cenas soltas numa página nova, e cada capítulo em outra
    expect(doc.split('<w:pageBreakBefore/>').length - 1).toBe(1 + completa.capitulos.length);
    expect(doc).toContain('<w:r><w:rPr><w:b/></w:rPr><w:t xml:space="preserve">A torre: o começo / "parte" 1?</w:t></w:r>');
    expect(doc).toContain('<w:r><w:rPr><w:i/></w:rPr><w:t xml:space="preserve">vem</w:t></w:r>');
    expect(doc).toContain('<w:r><w:rPr><w:b/></w:rPr><w:t xml:space="preserve">ela</w:t></w:r>');
    expect(doc).toContain('&lt;tags&gt; &amp; e-comercial.');
    expect(doc).not.toContain('**');
    // XML bem formado: toda marca abre e fecha na ordem
    const pilha: string[] = [];
    for (const m of doc.matchAll(/<(\/?)([\w:]+)[^>]*?(\/?)>/g)) {
      if (m[3] === '/') continue;
      if (m[1] === '/') expect(pilha.pop()).toBe(m[2]);
      else pilha.push(m[2]!);
    }
    expect(pilha).toEqual([]);
    // os tipos e as relações apontam para o que existe
    expect(strFromU8(z['[Content_Types].xml']!)).toContain('PartName="/word/document.xml"');
    expect(strFromU8(z['_rels/.rels']!)).toContain('Target="word/document.xml"');
  });

  it('história sem capítulos e com caracteres que o XML não aceita', async () => {
    const e = nova();
    const h = await e.criarHistoria({ titulo: 'Conto' });
    await e.criarCena(h.id, { texto: 'Primeira\u0001 cena.\n\n***\n\nDepois da quebra.' });
    await e.criarCena(h.id, { texto: 'Segunda cena.' });
    const doc = documentoXml(await e.completa(h.id));
    expect(doc).not.toContain('\u0001');
    expect(doc).toContain('Primeira cena.');
    // "***" e a troca de cena viram "#" centrado
    expect(doc.split('<w:jc w:val="center"/><w:ind w:firstLine="0"/></w:pPr><w:r><w:t xml:space="preserve">#</w:t>').length - 1).toBe(2);
    expect(doc.split('<w:pageBreakBefore/>').length - 1).toBe(1);
  });
});

describe('exportar e importar .ekfr', () => {
  it('história: envelope do Writer, ida e volta sem perda', async () => {
    const e = nova();
    const id = await historiaDeExemplo(e);
    const original = await e.completa(id);
    const bytes = exportarEkfrHistoria(original);
    expect(exportarEkfrHistoria(original)).toEqual(bytes);
    const ident = identificar(bytes);
    expect(ident).toMatchObject({ ok: true, legado: false, envelope: { ekfr: 1, app: 'writer', tipo: 'historia', formato: FORMATO_EKFR, gravadoPor: 'writer-web@0.1.0', titulo: 'A torre: o começo / "parte" 1?' } });
    const dentro = JSON.parse(strFromU8(lerEkfr(bytes).arquivos['historia.json']!)) as HistoriaImportada;
    expect(dentro).toEqual(historiaParaArquivo(original));
    expect(JSON.stringify(dentro)).not.toContain(id); // sem ids: quem abre cria registros novos

    const outro = nova();
    const r = await importarArquivo(outro, 'torre.ekfr', bytes);
    expect(r).toMatchObject({ ok: true, ideias: 0 });
    if (!r.ok) return;
    const volta = await outro.completa(r.historias[0]!);
    expect(normal(volta)).toEqual(normal(original));
    expect(volta.historia.id).not.toBe(id);
    expect(volta.historia.dono).toBe('ana');
    // datas no envelope, quando o app quer
    expect(identificar(exportarEkfrHistoria(original, { gravadoPor: 'writer-desktop@0.2.0', criado: '2026-11-12T10:00:00Z', modificado: '2026-11-12T11:00:00Z' }))).toMatchObject({ envelope: { gravadoPor: 'writer-desktop@0.2.0', criado: '2026-11-12T10:00:00Z' } });
  });

  it('ideias: ida e volta', async () => {
    const e = nova();
    await e.criarIdeia({ titulo: 'Uma', tipo: 'dialogo', texto: '— Oi.', etiquetas: ['a', 'b'], fixada: true });
    await e.criarIdeia({ titulo: 'Duas' });
    const bytes = exportarEkfrIdeias(await e.ideias());
    expect(identificar(bytes)).toMatchObject({ ok: true, envelope: { app: 'writer', tipo: 'ideias' } });
    const outro = nova();
    expect(await importarEkfr(outro, bytes)).toEqual({ ok: true, historias: [], ideias: 2 });
    expect((await outro.ideias()).map((i) => [i.titulo, i.tipo, i.texto, i.etiquetas, i.fixada])).toEqual([
      ['Uma', 'dialogo', '— Oi.', ['a', 'b'], true],
      ['Duas', 'outro', '', [], false],
    ]);
  });

  it('o que não abre: de outro app, versão nova, tipo desconhecido, estragado', async () => {
    const e = nova();
    const env = { app: 'writer', tipo: 'historia', formato: '1.0.0', gravadoPor: 'teste@0.0.0' };
    const json = (v: unknown): Uint8Array => strToU8(JSON.stringify(v));
    const doMaker = gravarEkfr({ ...env, app: 'maker', tipo: 'mundo' }, { 'doc.crdt': new Uint8Array([1]) });
    expect(await importarArquivo(e, 'mundo.ekfr', doMaker)).toEqual({ ok: false, erro: 'outro-app', app: 'maker' });
    expect(await importarEkfr(e, gravarEkfr({ ...env, formato: '2.0.0' }, { 'historia.json': json({ campos: {} }) }))).toEqual({ ok: false, erro: 'versao-nova' });
    expect(await importarEkfr(e, gravarEkfr({ ...env, formato: '1.7.0' }, { 'historia.json': json({ campos: { titulo: 'De um Writer mais novo' }, novidade: [1] }) }))).toMatchObject({ ok: true });
    expect(await importarEkfr(e, gravarEkfr({ ...env, tipo: 'roteiro' }, {}))).toEqual({ ok: false, erro: 'tipo-desconhecido' });
    expect(await importarEkfr(e, gravarEkfr({ ...env, app: 'futuro' }, {}))).toEqual({ ok: false, erro: 'app-desconhecido' });
    expect(await importarEkfr(e, gravarEkfr(env, {}))).toEqual({ ok: false, erro: 'conteudo-invalido' });
    expect(await importarEkfr(e, gravarEkfr(env, { 'historia.json': strToU8('{ não é json') }))).toEqual({ ok: false, erro: 'conteudo-invalido' });
    expect(await importarEkfr(e, gravarEkfr(env, { 'historia.json': json({ campos: {}, capitulos: [{ cenas: 'x' }] }) }))).toEqual({ ok: false, erro: 'conteudo-invalido' });
    expect(await importarEkfr(e, gravarEkfr({ ...env, tipo: 'ideias' }, { 'ideias.json': json({ ideias: 'x' }) }))).toEqual({ ok: false, erro: 'conteudo-invalido' });
    expect(await importarEkfr(e, strToU8('isto não é um zip'))).toEqual({ ok: false, erro: 'nao-e-ekfr' });
    expect(await importarArquivo(e, 'texto.ekfr', strToU8('isto não é um zip'))).toEqual({ ok: false, erro: 'nao-e-ekfr' });
    // um .zip sem envelope é tratado como pasta de Markdown; vazio = nada a importar
    expect(await importarArquivo(e, 'fotos.zip', zipSync({ 'foto.png': new Uint8Array([1, 2, 3]) }))).toEqual({ ok: false, erro: 'vazio' });
    expect(await importarZip(e, strToU8('PK estragado'))).toEqual({ ok: false, erro: 'nao-e-ekfr' });
    // só entrou a história do Writer mais novo
    expect((await e.historias()).map((h) => h.titulo)).toEqual(['De um Writer mais novo']);
  });
});

describe('importar: proteção contra bombas de zip e cenas grandes demais', () => {
  const escrita = (): Escrita => new Escrita(new ArmazemMemoria({ dono: 'ana', aparelho: 'aaaaaaaa' }));

  it('soma do descompactado, número de entradas e tamanho de uma entrada: recusa antes de descompactar', async () => {
    const zeros = new Uint8Array(LIMITES_ZIP.entrada); // 16 MB de zeros: comprimidos, poucos KB
    const muitos: Record<string, Uint8Array> = {};
    for (let k = 0; k < 5; k++) muitos[`h/${k}.md`] = zeros; // 80 MB descompactados
    const bomba = zipSync(muitos, { level: 1 });
    expect(bomba.length).toBeLessThan(1024 * 1024);
    expect(zipGrandeDemais(bomba)).toBe(true);
    const e = escrita();
    expect(await importarZip(e, bomba)).toEqual({ ok: false, erro: 'grande' });
    expect(await importarArquivo(e, 'bomba.zip', bomba)).toEqual({ ok: false, erro: 'grande' });

    const pequenos: Record<string, Uint8Array> = {};
    for (let k = 0; k <= LIMITES_ZIP.entradas; k++) pequenos[`h/${k}.md`] = strToU8('x');
    expect(await importarZip(e, zipSync(pequenos))).toEqual({ ok: false, erro: 'grande' });

    const uma = zipSync({ 'h/1.md': new Uint8Array(LIMITES_ZIP.entrada + 1) }, { level: 1 });
    expect(await importarZip(e, uma)).toEqual({ ok: false, erro: 'grande' });
    // só o que é Markdown conta
    expect(zipGrandeDemais(zipSync({ 'foto.png': zeros, 'h/1.md': strToU8('# Oi') }, { level: 1 }), (n) => n.endsWith('.md'))).toBe(false);
    expect(await e.historias()).toEqual([]);
  }, 30_000);

  it('cena maior que o servidor aceita não entra (ficaria para sempre fora da nuvem)', async () => {
    const e = escrita();
    const md = `# Grande\n\n### Cena\n\n${'palavra '.repeat(MAX_TEXTO_CENA / 8 + 10)}\n`;
    expect(await importarMd(e, md)).toEqual({ ok: false, erro: 'cena-grande' });
    expect(await e.historias()).toEqual([]);
  });
});
