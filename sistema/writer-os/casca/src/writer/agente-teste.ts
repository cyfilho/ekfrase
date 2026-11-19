// SPDX-License-Identifier: MPL-2.0

/**
 * O AGENTE DE TESTE do Writer OS (PLANO §8). SÓ existe na imagem de teste: liga quando há
 * `/etc/ekfrase/teste` (a imagem de entrega não tem esse arquivo) ou, fora do pendrive, com
 * `EKFRASE_CASCA_OS_TESTE=1`. Ele não mexe na tela: só conta o que acontece, uma linha por evento, em
 * `/run/ekfrase/teste/relato`, que um serviço root da imagem de teste repassa para a serial
 * (`tests/writer-os/qemu.py` lê de lá):
 *
 *   tela <data-teste>       a tela que está aberta (a cada troca)
 *   texto ok | texto falta  depois da senha: a cena de teste tem o texto da última vez?
 *   ultimo <N>              o último número que ficou gravado
 *   integridade <r>         `PRAGMA integrity_check` do banco (`ok`)
 *   usb ok | usb negado     o 2º pendrive (rótulo OUTRO) monta e aceita um arquivo?
 *   interno negado          o disco interno NÃO monta (§7)
 *   gravado <N>             o laço de gravação (cada linha depois do COMMIT): é o teste de arrancar
 *   lugar <usb|computador>  de onde o sistema ligou (o `lugar` do dados.json; instalar no computador, PLANO §8c)
 *   bootorder <lista>       o BootOrder do firmware (ao ligar e depois de instalar), como o efibootmgr mostra
 *   entrada-writer <n>      a entrada "Ekfrase Writer OS" que existe no firmware (Boot<n>)
 *   instalar ok | <erro>    o fim de uma instalação no computador
 *   atualizacao …           as atualizações (atualizacoes-os.ts): `boot <lado> <versão> atual=… novo=… falhou=…`,
 *                           cada situação (`procurando`, `baixando <v>`, `pronta <v>`, `erro - <código>`…),
 *                           `confirmada <lado> <v>`, `sem-confirmar <lado>`, `voltou <de> <para>`
 */
import { DONO_LOCAL, Escrita } from '@ekfrase/writer-nucleo';
import { appendFileSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { Sistema } from '../motor/sistema.ts';
import type { AtualizacoesOS } from './atualizacoes-os.ts';
import type { DadosDoWriter } from './dados.ts';
import type { WriterOS } from './os.ts';
import type { Pagina } from './pagina.ts';

const EFIVARS = '/sys/firmware/efi/efivars';
const GUID_GLOBAL = '8be4df61-93ca-11d2-aa0d-00e098032b8c';

/**
 * O BootOrder e as entradas "Ekfrase Writer OS" lidos das variáveis do firmware (o efivarfs deixa qualquer um ler).
 * Cada arquivo começa com 4 bytes de atributos; o BootOrder é uma lista de UINT16; o Boot#### é um EFI_LOAD_OPTION
 * (UINT32 atributos, UINT16 tamanho dos caminhos e a descrição em UTF-16, terminada em zero).
 */
export function lerEfi(pasta = EFIVARS): { ordem: string | null; writer: string[] } {
  const hex = (n: number) => n.toString(16).toUpperCase().padStart(4, '0');
  let ordem: string | null = null;
  const writer: string[] = [];
  try {
    const b = readFileSync(join(pasta, `BootOrder-${GUID_GLOBAL}`));
    const l: string[] = [];
    for (let i = 4; i + 1 < b.length; i += 2) l.push(hex(b.readUInt16LE(i)));
    ordem = l.join(',');
  } catch {
    // sem UEFI (ou sem o efivarfs)
  }
  let nomes: string[] = [];
  try {
    nomes = readdirSync(pasta);
  } catch {
    // idem
  }
  for (const f of nomes) {
    const m = new RegExp(`^Boot([0-9A-Fa-f]{4})-${GUID_GLOBAL}$`).exec(f);
    if (!m?.[1]) continue;
    let b: Buffer;
    try {
      b = readFileSync(join(pasta, f));
    } catch {
      // uma entrada que o writer não pode ler (o efivarfs pode deixar só o root): as outras seguem
      continue;
    }
    let nome = '';
    for (let i = 10; i + 1 < b.length; i += 2) {
      const c = b.readUInt16LE(i);
      if (!c) break;
      nome += String.fromCharCode(c);
    }
    if (nome === 'Ekfrase Writer OS') writer.push(m[1].toUpperCase());
  }
  return { ordem, writer: writer.sort() };
}

export const HISTORIA_DE_TESTE = 'Teste do Writer OS';
const MARCA = 'Escrito no Writer OS.';
/** Quantas gravações o laço faz (uma a cada 250 ms: ~75 s). */
const VOLTAS = 300;

export function ligarAgente(o: { relato: string; pagina: Pagina; dados: DadosDoWriter; sistema: Sistema; os?: WriterOS; atualizacoes?: AtualizacoesOS }): (linha: string) => void {
  mkdirSync(dirname(o.relato), { recursive: true });
  const dizer = (linha: string) => {
    try {
      appendFileSync(o.relato, `${linha}\n`);
    } catch {
      // o relato é só para o teste
    }
  };
  dizer('agente ligado');
  if (o.atualizacoes) o.atualizacoes.aoRelatar = dizer;
  const contarEfi = () => {
    const e = lerEfi();
    dizer(`bootorder ${e.ordem ?? '?'}`);
    for (const n of e.writer) dizer(`entrada-writer ${n}`);
  };
  if (o.os) {
    dizer(`lugar ${o.os.estado().boot}`);
    contarEfi();
    o.os.aoInstalar = (r) => {
      dizer(`instalar ${r}`);
      contarEfi();
    };
  }
  let tela = '';
  let conferindo = false;

  setInterval(() => {
    if (o.pagina.aberta()) {
      o.pagina
        .qualTela()
        .then((t: unknown) => {
          if (typeof t === 'string' && t && t !== tela) {
            tela = t;
            dizer(`tela ${t}`);
          }
        })
        .catch(() => undefined);
    }
    if (o.dados.aberta && !conferindo) {
      conferindo = true;
      void conferir().catch((e: unknown) => dizer(`erro ${e instanceof Error ? e.message : String(e)}`));
    }
  }, 250);

  async function conferir(): Promise<void> {
    await o.dados.abrirArmazem(DONO_LOCAL);
    const armazem = o.dados.armazemAberto(DONO_LOCAL);
    if (!armazem) throw new Error('sem armazém');
    const escrita = new Escrita(armazem);
    dizer(`integridade ${armazem.integridade()}`);
    let historia = (await escrita.historias()).find((h) => h.titulo === HISTORIA_DE_TESTE);
    let cena = historia ? (await escrita.cenas(historia.id))[0] : undefined;
    let n = 0;
    if (cena && cena.texto.startsWith(MARCA)) {
      n = Number(/gravado=(\d+)/.exec(cena.texto)?.[1] ?? 0);
      dizer('texto ok');
      dizer(`ultimo ${n}`);
    } else dizer('texto falta');
    if (!historia) historia = await escrita.criarHistoria({ titulo: HISTORIA_DE_TESTE });
    if (!cena) cena = await escrita.criarCena(historia.id, { titulo: 'Cena' });

    // o 2º pendrive e o disco interno (§7)
    const outro = (await o.sistema.discos()).find((d) => d.rotulo === 'OUTRO');
    if (outro) {
      const onde = outro.montado ?? (await o.sistema.montar(outro.id));
      try {
        if (!onde) throw new Error('não montou');
        writeFileSync(join(onde, 'ekfrase-teste.txt'), 'ok\n');
        dizer('usb ok');
      } catch {
        dizer('usb negado');
      }
    } else dizer('usb sem-disco');
    dizer(`interno ${await o.sistema.montarInterno()}`);

    // o laço: cada linha "gravado N" só sai depois de o banco confirmar a gravação
    for (let i = 0; i < VOLTAS && o.dados.aberta; i++) {
      n += 1;
      await escrita.gravarTexto(cena.id, `${MARCA}\ngravado=${n}\n`);
      dizer(`gravado ${n}`);
      await new Promise((ok) => setTimeout(ok, 250));
    }
    dizer('laco fim');
  }

  return dizer;
}
