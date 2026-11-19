// SPDX-License-Identifier: MPL-2.0
/**
 * Regras dos textos (DEC-P010): todo idioma tem os mesmos arquivos e as mesmas
 * chaves do português; os {parametros} batem; nenhum texto vazio; toda chave
 * usada no código existe. Traduzir para outra língua = copiar `locales/en`.
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const raiz = fileURLToPath(new URL('../', import.meta.url));
const pasta = join(raiz, 'locales');
const idiomas = readdirSync(pasta).filter((n) => statSync(join(pasta, n)).isDirectory());

function ler(idioma: string): Record<string, Record<string, string>> {
  const out: Record<string, Record<string, string>> = {};
  for (const arq of readdirSync(join(pasta, idioma)).filter((n) => n.endsWith('.json'))) {
    out[arq.replace(/\.json$/, '')] = JSON.parse(readFileSync(join(pasta, idioma, arq), 'utf8')) as Record<string, string>;
  }
  return out;
}

const pt = ler('pt-BR');
const parametros = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

function codigo(dir: string, out: string[] = []): string[] {
  for (const n of readdirSync(dir)) {
    if (n === 'node_modules' || n === 'dist') continue;
    const f = join(dir, n);
    if (statSync(f).isDirectory()) codigo(f, out);
    else if (/\.(ts|tsx)$/.test(n)) out.push(f);
  }
  return out;
}

describe('idiomas', () => {
  it('existem português e inglês', () => {
    expect(idiomas).toEqual(expect.arrayContaining(['pt-BR', 'en']));
  });

  for (const idioma of idiomas.filter((i) => i !== 'pt-BR')) {
    it(`${idioma} tem os mesmos arquivos, chaves e parâmetros do português`, () => {
      const outro = ler(idioma);
      expect(Object.keys(outro).sort()).toEqual(Object.keys(pt).sort());
      for (const [arq, msgs] of Object.entries(pt)) {
        expect(Object.keys(outro[arq]!).sort(), `${idioma}/${arq}.json`).toEqual(Object.keys(msgs).sort());
        for (const [k, v] of Object.entries(msgs)) {
          expect(parametros(outro[arq]![k]!), `${idioma}/${arq}.json → ${k}`).toEqual(parametros(v));
        }
      }
    });
  }

  it('nenhum texto vazio e todo idioma tem nome', () => {
    for (const idioma of idiomas) {
      const msgs = ler(idioma);
      expect(msgs['nucleo']?.['idioma.nome'], idioma).toBeTruthy();
      for (const [arq, m] of Object.entries(msgs)) for (const [k, v] of Object.entries(m)) expect(v.trim(), `${idioma}/${arq}.json → ${k}`).not.toBe('');
    }
  });

  it('toda chave escrita no código existe no português', () => {
    const faltando: string[] = [];
    for (const f of [...codigo(join(raiz, 'apps')), ...codigo(join(raiz, 'packages'))]) {
      if (f.endsWith('.test.ts')) continue;
      // O Maker chama t('chave') com as chaves do arquivo dele (locales/<idioma>/maker.json), sem o
      // prefixo do arquivo; o teste dele (apps/maker/test/i18n.test.ts) cobra essas chaves.
      if (/[\\/](apps[\\/]maker|packages[\\/]maker-[a-z]+)[\\/]/.test(f)) continue;
      const texto = readFileSync(f, 'utf8');
      for (const m of texto.matchAll(/\bt\(\s*'([a-z0-9_-]+)\.([a-z0-9_.-]+)'/g)) {
        const [arq, chave] = [m[1]!, m[2]!];
        const msgs = pt[arq];
        const existe = msgs !== undefined && (chave in msgs || `${chave}.other` in msgs);
        if (!existe) faltando.push(`${relative(raiz, f)}: ${arq}.${chave}`);
      }
    }
    expect(faltando).toEqual([]);
  });

  // o Writer monta algumas chaves no código (`writer.status.${s}`…): todas têm de existir
  // (no repositório público, só quando o Writer já estiver lá)
  it.skipIf(!existsSync(join(raiz, 'packages', 'writer-nucleo')))('o Writer tem texto para todo status, tipo de ideia, situação da nuvem e código de erro', async () => {
    const { STATUS_CENA, TIPOS_IDEIA, VIROU } = await import('../packages/writer-nucleo/src/modelo.ts');
    const { TECLADOS } = await import('../sistema/writer-os/casca/src/motor/sistema.ts');
    const w = pt['writer'];
    expect(w, 'locales/pt-BR/writer.json').toBeTruthy();
    const tem = (k: string) => k in w! || `${k}.other` in w!;
    const faltando: string[] = [];
    const montadas = [
      ...STATUS_CENA.map((s) => `status.${s}`),
      ...TIPOS_IDEIA.map((x) => `tipo.${x}`),
      ...VIROU.flatMap((v) => [`virou.${v}`, `transformar.${v}`, `transformar.feito-${v}`]),
      ...['em-dia', 'enviando', 'sem-rede', 'sem-conta', 'pendentes', 'memoria'].map((s) => `nuvem.${s}`),
      ...['salvo', 'gravando', 'erro'].map((g) => `gravacao.${g}`),
      // da ponte (/api/v1/escrita/*), do transporte e do núcleo
      ...['login', 'csrf', 'dados', 'vazio', 'muitos', 'cota', 'grande', 'servidor', 'rede', 'recusado', 'invalido', 'grande_demais', 'nao-existe', 'sem-historia'].map((c) => `erro.${c}`),
      // do importar (ErroImportar + ErroEkfr)
      ...['nao-e-ekfr', 'sem-envelope', 'envelope-invalido', 'envelope-novo', 'grande', 'outro-app', 'versao-nova', 'tipo-desconhecido', 'app-desconhecido', 'conteudo-invalido', 'vazio'].map((c) => `importar.erro.${c}`),
      ...['titulo', 'subtitulo', 'logline', 'sinopse', 'genero', 'formato', 'ponto_vista', 'tempo_verbal', 'tema', 'publico'].map((c) => `ficha.${c}`),
      // o Writer OS (apps/writer/src/computador/SistemaOS.tsx): os teclados do sistema, os motivos do
      // ekfrase-dados.sh, o Secure Boot e os códigos de erro do sistema e da casca
      ...TECLADOS.map((id) => `os.teclado.${id}`),
      ...['sem-espaco', 'nao-usb', 'sem-medio', 'nao-monta', 'protegido', 'sem-servico', 'sem-dados', 'nao-grava', 'outras-particoes', 'nao-cria', 'nao-formata'].map((m) => `os.onde.motivo.${m}`),
      ...['ligado', 'desligado', 'desconhecido'].map((s) => `os.sobre.secure-boot.${s}`),
      ...['senha', 'falhou', 'negado'].flatMap((e) => [`os.wifi.erro.${e}`, `os.discos.erro.${e}`]),
      // instalar no computador (PLANO §8c): os passos e os erros do ekfrase-instalar.sh e os motivos da tela
      ...['apagar', 'particoes', 'copiar', 'conferir', 'textos', 'entrada'].map((p) => `os.instalar.passo.${p}`),
      ...['sem-espaco', 'nao-gpt', 'nao-uefi', 'ja-instalado', 'nao-usb', 'disco', 'copia', 'textos', 'entrada', 'ocupado', 'confirmacao', 'falhou'].map((e) => `os.instalar.erro.${e}`),
      ...['nao-uefi', 'sem-disco', 'ja-instalado', 'vazio', 'nao-gpt', 'sem-espaco'].map((m) => `os.instalar.motivo.${m}`),
      // "Apagar o disco inteiro" (W3f): o que é cada partição; o tutorial: a tecla e a configuração de cada marca
      ...['windows', 'recuperacao', 'efi', 'linux', 'writer', 'outra'].map((p) => `os.instalar.parte.${p}`),
      ...['lenovo', 'dell', 'hp', 'acer', 'asus', 'msi', 'samsung', 'positivo', 'outra'].flatMap((m) => [`os.tutorial.tecla.${m}`, `os.tutorial.config.${m}`]),
      ...['senha', 'senha-curta', 'pasta', 'nao-abre', 'fechada', 'ja-tem', 'diferentes'].map((e) => `computador.erro.${e}`),
    ];
    for (const k of montadas) if (!tem(k)) faltando.push(k);
    // os atalhos fixos da lista de atalhos (apps/writer/src/Paleta.tsx) são chaves inteiras no código
    const paleta = readFileSync(join(raiz, 'apps', 'writer', 'src', 'Paleta.tsx'), 'utf8');
    for (const m of paleta.matchAll(/'writer\.(atalho\.[a-z-]+)'/g)) if (!tem(m[1]!)) faltando.push(m[1]!);
    expect(faltando).toEqual([]);
    expect(pt['nucleo']?.['app.writer']).toBeTruthy();
  });

  // o servidor (ponte/) só existe no repositório da plataforma
  it.skipIf(!existsSync(join(raiz, 'ponte', 'sql', 'esquema.sql')))('todo papel do banco tem nome nos idiomas (a chave é montada no código)', () => {
    const esquema = readFileSync(join(raiz, 'ponte', 'sql', 'esquema.sql'), 'utf8');
    const papeis = /papel ENUM\(([^)]*)\)/.exec(esquema)![1]!.split(',').map((s) => s.trim().replace(/'/g, ''));
    for (const p of papeis) expect(pt['nucleo']![`papel.${p}`], p).toBeTruthy();
  });
});
