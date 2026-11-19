// SPDX-License-Identifier: MPL-2.0

/**
 * AS ATUALIZAÇÕES (DEC-P072, docs/ATUALIZACOES.md): o pacote `@ekfrase/atualizacoes` (a ordem das versões, o canal, os
 * Releases, o manifesto e o lacre dele) e o Writer OS se atualizando (`atualizacoes-os.ts`) contra um "GitHub" local e
 * o sistema simulado: procurar → baixar → conferir → aplicar na cópia de reserva; o modo perguntar; o arquivo trocado no
 * caminho; a versão que não ligou não volta; sem a partição de dados. O `ekfrase-atualizar.sh` e o GRUB de verdade são
 * conferidos no QEMU (`tests/writer-os/qemu.py`, teste_atualizar e teste_voltar).
 */
import { canalAceita, compararVersoes, conferirManifesto, ErroManifesto, lancamentos, lerManifesto, maisNova, nomeDoManifesto, proximaBusca, type Buscar } from '@ekfrase/atualizacoes';
import { createHash, randomBytes } from 'node:crypto';
import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { lerEstadoBoot, lerLinhaAplicar, SistemaSimulado } from '../sistema/writer-os/casca/src/motor/sistema.ts';
import { AtualizacoesOS } from '../sistema/writer-os/casca/src/writer/atualizacoes-os.ts';
import { assinadorTeste } from './gravador/imagem-teste.ts';

const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex');

describe('as versões e o canal', () => {
  it('a estável vence as de teste dela; as de teste andam pelo número', () => {
    const ordem = ['0.1.4', '0.2.0-teste.1', '0.2.0-teste.2', '0.2.0-teste.10', '0.2.0', '0.2.1', '0.10.0'];
    for (let i = 1; i < ordem.length; i++) expect(maisNova(ordem[i]!, ordem[i - 1]!), `${ordem[i]} > ${ordem[i - 1]}`).toBe(true);
    expect(compararVersoes('0.2.0', '0.2.0')).toBe(0);
    expect(maisNova('1.0.0', 'lixo')).toBe(true);
    expect(maisNova('lixo', '0.0.1')).toBe(false);
  });

  it('o canal estável só vê estáveis; o de teste vê as duas', () => {
    expect(canalAceita('estavel', '0.2.0')).toBe(true);
    expect(canalAceita('estavel', '0.2.1-teste.1')).toBe(false);
    expect(canalAceita('teste', '0.2.1-teste.1')).toBe(true);
    expect(canalAceita('teste', '0.2.1')).toBe(true);
  });

  it('sem internet tenta de novo mais cedo, e cada vez mais devagar, até o intervalo de sempre', () => {
    expect(proximaBusca(0)).toBe(6 * 3600_000);
    expect(proximaBusca(1)).toBe(60_000);
    expect(proximaBusca(3)).toBe(240_000);
    expect(proximaBusca(20)).toBe(30 * 60_000);
  });
});

describe('o manifesto e o lacre dele', () => {
  const ass = assinadorTeste();
  const outra = assinadorTeste();
  const m = { app: 'ekfrase-writer-os', versao: '0.2.1', canal: 'estavel', arquivos: [{ papel: 'squashfs', nome: 'ekfrase-writer-os-0.2.1.squashfs', tamanho: 10, sha256: 'a'.repeat(64) }] };
  const texto = JSON.stringify(m);
  const o = { chaves: [ass.chave], app: 'ekfrase-writer-os', nome: 'Ekfrase Writer OS', versao: '0.2.1' };

  it('confere com a chave e o comentário certos', () => {
    expect(conferirManifesto(texto, ass.assinar(Buffer.from(texto), 'Ekfrase Writer OS 0.2.1 atualizacao'), o)).toMatchObject({ versao: '0.2.1', arquivos: [{ papel: 'squashfs' }] });
    // a segunda chave da lista também vale (a de teste, na imagem de teste)
    expect(conferirManifesto(texto, ass.assinar(Buffer.from(texto), 'Ekfrase Writer OS 0.2.1 atualizacao'), { ...o, chaves: [outra.chave, ass.chave] }).versao).toBe('0.2.1');
  });

  it('recusa outra chave, o texto mudado, o lacre de outra versão ou de outro app', () => {
    const motivo = (f: () => unknown) => {
      try {
        f();
      } catch (e) {
        return e instanceof ErroManifesto ? e.motivo : String(e);
      }
      return 'aceitou';
    };
    expect(motivo(() => conferirManifesto(texto, outra.assinar(Buffer.from(texto), 'Ekfrase Writer OS 0.2.1 atualizacao'), o))).toBe('lacre');
    expect(motivo(() => conferirManifesto(`${texto} `, ass.assinar(Buffer.from(texto), 'Ekfrase Writer OS 0.2.1 atualizacao'), o))).toBe('lacre');
    // um lacre antigo e válido não serve para outra versão
    expect(motivo(() => conferirManifesto(texto, ass.assinar(Buffer.from(texto), 'Ekfrase Writer OS 0.2.0 atualizacao'), o))).toBe('outra-versao');
    expect(motivo(() => conferirManifesto(texto, ass.assinar(Buffer.from(texto), 'Ekfrase Writer OS 0.2.1'), o))).toBe('outra-versao');
    const deOutro = JSON.stringify({ ...m, app: 'ekfrase-writer' });
    expect(motivo(() => conferirManifesto(deOutro, ass.assinar(Buffer.from(deOutro), 'Ekfrase Writer OS 0.2.1 atualizacao'), o))).toBe('outro-app');
  });

  it('recusa o que foge do formato (nome com barra, sha curto, papel repetido)', () => {
    const com = (a: object) => JSON.stringify({ ...m, arquivos: [{ ...m.arquivos[0], ...a }] });
    expect(() => lerManifesto(com({ nome: '../etc/passwd' }))).toThrow('formato');
    expect(() => lerManifesto(com({ nome: '.oculto' }))).toThrow('formato');
    expect(() => lerManifesto(com({ sha256: 'abc' }))).toThrow('formato');
    expect(() => lerManifesto(com({ tamanho: -1 }))).toThrow('formato');
    expect(() => lerManifesto(JSON.stringify({ ...m, arquivos: [m.arquivos[0], m.arquivos[0]] }))).toThrow('formato');
    expect(() => lerManifesto(JSON.stringify({ ...m, versao: '0.2' }))).toThrow('formato');
    expect(nomeDoManifesto('ekfrase-writer-os', '0.2.1')).toBe('ekfrase-writer-os-0.2.1.atualizacao.json');
  });
});

describe('o que o ekfrase-atualizar.sh responde', () => {
  it('o estado das duas cópias', () => {
    const e = lerEstadoBoot(['lado\tlive-b\t0.2.1', 'atual\tlive', 'reserva\tlive\t0.2.0', 'novo\tlive-b\t0.2.1\t1', 'fim', ''].join('\n'));
    expect(e).toEqual({ lado: 'live-b', versao: '0.2.1', atual: 'live', reserva: { lado: 'live', versao: '0.2.0' }, novo: { lado: 'live-b', versao: '0.2.1', tentativas: 1 }, falhou: null });
    expect(lerEstadoBoot('lado\tlive\t0.2.0\nfalhou\tlive-b\t0.2.1\nfim\n')?.falhou).toEqual({ lado: 'live-b', versao: '0.2.1' });
    // sem o fim, a resposta não chegou inteira
    expect(lerEstadoBoot('lado\tlive\t0.2.0\n')).toBeNull();
    // um lado que não é nosso é ignorado
    expect(lerEstadoBoot('lado\t../x\t1\nfim\n')?.lado).toBe('live');
  });

  it('as linhas do aplicar', () => {
    expect(lerLinhaAplicar('passo\tcopiar\t10\t100')).toEqual({ passo: 'copiar', feito: 10, total: 100 });
    expect(lerLinhaAplicar('ok')).toEqual({ ok: true });
    expect(lerLinhaAplicar('erro\tlacre')).toEqual({ ok: false, erro: 'lacre' });
    expect(lerLinhaAplicar('erro\tqualquer-coisa')).toEqual({ ok: false, erro: 'falhou' });
    expect(lerLinhaAplicar('outra')).toBeNull();
  });
});

describe('o Writer OS se atualiza (atualizacoes-os.ts, sistema simulado, "GitHub" local)', () => {
  const ass = assinadorTeste();
  let servidor: Server;
  let base = '';
  /** O que o "GitHub" oferece agora: as versões e, se quiser, um arquivo trocado no caminho. */
  let oferta: { versao: string; prerelease?: boolean; trocar?: boolean }[] = [];
  const arquivos = new Map<string, Buffer>();
  const pastas: string[] = [];

  function publicar(versao: string, trocar = false): void {
    const conteudo: Record<string, Buffer> = { squashfs: randomBytes(300_000), vmlinuz: randomBytes(20_000), initrd: randomBytes(50_000), 'grub.cfg': Buffer.from(`# grub ${versao}\n`) };
    const lista = Object.entries(conteudo).map(([papel, b]) => ({ papel, nome: `ekfrase-writer-os-${versao}.${papel === 'initrd' ? 'initrd' : papel}`, tamanho: b.length, sha256: sha(b) }));
    const texto = JSON.stringify({ app: 'ekfrase-writer-os', versao, canal: versao.includes('-teste.') ? 'teste' : 'estavel', arquivos: lista });
    const nome = `ekfrase-writer-os-${versao}.atualizacao.json`;
    arquivos.set(nome, Buffer.from(texto));
    arquivos.set(`${nome}.minisig`, Buffer.from(ass.assinar(Buffer.from(texto), `Ekfrase Writer OS ${versao} atualizacao`)));
    for (const a of lista) arquivos.set(a.nome, trocar && a.papel === 'squashfs' ? randomBytes(a.tamanho) : conteudo[a.papel]!);
  }

  beforeAll(async () => {
    servidor = createServer((q, r) => {
      if (q.url === '/repos/cyfilho/ekfrase/releases?per_page=50') {
        r.setHeader('content-type', 'application/json');
        r.end(
          JSON.stringify(
            oferta.map((o) => ({
              tag_name: `writer-os-v${o.versao}`,
              prerelease: o.prerelease ?? o.versao.includes('-teste.'),
              assets: [...arquivos.keys()].filter((n) => n.startsWith(`ekfrase-writer-os-${o.versao}.`)).map((n) => ({ name: n, browser_download_url: `${base}/d/${n}`, size: arquivos.get(n)!.length })),
            })),
          ),
        );
        return;
      }
      const b = q.url?.startsWith('/d/') ? arquivos.get(q.url.slice(3)) : undefined;
      if (!b) {
        r.statusCode = 404;
        r.end();
        return;
      }
      r.writeHead(200, { 'content-length': b.length });
      r.end(b);
    });
    await new Promise<void>((ok) => servidor.listen(0, '127.0.0.1', ok));
    const ad = servidor.address();
    base = `http://127.0.0.1:${typeof ad === 'object' && ad ? ad.port : 0}`;
  });
  afterAll(() => servidor.close());
  afterEach(() => {
    delete process.env['EKFRASE_CASCA_OS_VOLTOU'];
    delete process.env['EKFRASE_CASCA_OS_CANAL'];
    for (const p of pastas.splice(0)) rmSync(p, { recursive: true, force: true });
  });
  const buscar: Buscar = (u, i) => fetch(u, i);

  function montar(o: { modo?: 'automaticas' | 'perguntar'; semDados?: boolean } = {}) {
    const raiz = mkdtempSync(join(tmpdir(), 'ekfrase-atualizar-'));
    pastas.push(raiz);
    const sistema = new SistemaSimulado(raiz, false);
    let modo = o.modo ?? 'automaticas';
    const pasta = join(sistema.caminhos.dados, 'Ekfrase Writer', '.atualizacao');
    const at = new AtualizacoesOS({ sistema, pasta: () => (o.semDados ? null : pasta), modo: () => modo, gravarModo: (m) => (modo = m), buscar, api: base, chaves: [ass.chave], atrasoInicial: 3_600_000 });
    const linhas: string[] = [];
    at.aoRelatar = (l) => linhas.push(l);
    return { sistema, at, pasta, linhas, modo: () => modo };
  }

  it('automáticas: achou uma maior, baixa, confere, grava na cópia de reserva e fica pronta', async () => {
    publicar('0.2.1');
    publicar('0.1.9');
    oferta = [{ versao: '0.1.9' }, { versao: '0.2.1' }];
    const { sistema, at, pasta, linhas } = montar();
    await at.iniciar();
    expect(at.estado()).toMatchObject({ versao: '0.2.0', situacao: 'parado', modo: 'automaticas' });
    const e = await at.procurar();
    at.parar();
    expect(e).toMatchObject({ situacao: 'pronta', nova: '0.2.1', erro: null });
    expect(sistema.aplicadas).toEqual(['0.2.1']);
    expect(linhas).toContain('atualizacao pronta 0.2.1 -');
    // o que foi baixado sai da partição de dados depois de gravado na de boot
    expect(existsSync(pasta) ? readdirSync(pasta) : []).toEqual([]);
    // procurar de novo não grava outra vez: a mesma espera o próximo boot
    expect((await at.procurar()).situacao).toBe('pronta');
    expect(sistema.aplicadas).toEqual(['0.2.1']);
  });

  it('perguntar: achou = "disponível"; só baixa e grava no Instalar', async () => {
    publicar('0.2.1');
    oferta = [{ versao: '0.2.1' }];
    const { sistema, at } = montar({ modo: 'perguntar' });
    await at.iniciar();
    expect(await at.procurar()).toMatchObject({ situacao: 'disponivel', nova: '0.2.1' });
    expect(sistema.aplicadas).toEqual([]);
    expect(await at.instalar()).toMatchObject({ situacao: 'pronta', nova: '0.2.1' });
    expect(sistema.aplicadas).toEqual(['0.2.1']);
    at.parar();
  });

  it('um arquivo trocado no caminho: o lacre não bate e nada é gravado', async () => {
    publicar('0.2.1', true);
    oferta = [{ versao: '0.2.1' }];
    const { sistema, at, pasta } = montar();
    await at.iniciar();
    expect(await at.procurar()).toMatchObject({ situacao: 'erro', erro: 'lacre' });
    expect(sistema.aplicadas).toEqual([]);
    expect(existsSync(join(pasta, '0.2.1'))).toBe(false);
    at.parar();
  });

  it('a versão que não ligou não volta (e o estado conta que voltou)', async () => {
    process.env['EKFRASE_CASCA_OS_VOLTOU'] = '0.2.1';
    publicar('0.2.1');
    oferta = [{ versao: '0.2.1' }];
    const { sistema, at, linhas } = montar();
    await at.iniciar();
    expect(at.estado().voltou).toEqual({ de: '0.2.1', para: '0.2.0' });
    expect(linhas).toContain('atualizacao voltou 0.2.1 0.2.0');
    expect((await at.procurar()).situacao).toBe('em-dia');
    expect(sistema.aplicadas).toEqual([]);
    // uma maior que a que falhou, sim
    publicar('0.2.2');
    oferta = [{ versao: '0.2.1' }, { versao: '0.2.2' }];
    expect(await at.procurar()).toMatchObject({ situacao: 'pronta', nova: '0.2.2' });
    at.parar();
  });

  it('nunca para trás, e o canal estável não vê as de teste', async () => {
    publicar('0.1.9');
    publicar('0.2.1-teste.1');
    oferta = [{ versao: '0.1.9' }, { versao: '0.2.1-teste.1' }];
    const estavel = montar();
    await estavel.at.iniciar();
    expect((await estavel.at.procurar()).situacao).toBe('em-dia');
    estavel.at.parar();
    process.env['EKFRASE_CASCA_OS_CANAL'] = 'teste';
    const teste = montar();
    await teste.at.iniciar();
    expect(await teste.at.procurar()).toMatchObject({ canal: 'teste', situacao: 'pronta', nova: '0.2.1-teste.1' });
    teste.at.parar();
  });

  it('sem a partição de dados não baixa (o aviso manda usar o Gravador); sem rede, erro sem-rede', async () => {
    publicar('0.2.1');
    oferta = [{ versao: '0.2.1' }];
    const sem = montar({ semDados: true });
    await sem.at.iniciar();
    expect(await sem.at.procurar()).toMatchObject({ situacao: 'erro', erro: 'sem-dados' });
    sem.at.parar();
    const raiz = mkdtempSync(join(tmpdir(), 'ekfrase-atualizar-'));
    pastas.push(raiz);
    const s = new SistemaSimulado(raiz, false);
    const fora = new AtualizacoesOS({ sistema: s, pasta: () => raiz, modo: () => 'automaticas', gravarModo: () => undefined, buscar: () => Promise.reject(new Error('sem rede')), api: base, chaves: [ass.chave], atrasoInicial: 3_600_000 });
    await fora.iniciar();
    expect(await fora.procurar()).toMatchObject({ situacao: 'erro', erro: 'sem-rede' });
    fora.parar();
  });

  it('confirmar só pede ao serviço quando ligou por uma cópia nova', async () => {
    const { sistema, at } = montar();
    await at.iniciar();
    await at.confirmar();
    expect(sistema.confirmou).toBe(false);
    at.parar();
  });

  it('os Releases: rascunho e estável marcada como pré-release ficam de fora', async () => {
    publicar('0.3.0');
    oferta = [{ versao: '0.3.0', prerelease: true }, { versao: '0.2.1' }];
    const l = await lancamentos(buscar, { prefixo: 'writer-os-v', canal: 'teste', api: base });
    expect(l.map((x) => x.versao)).toEqual(['0.2.1']);
  });
});
