// SPDX-License-Identifier: MPL-2.0

/**
 * A tela dos PENDRIVES do Writer OS (PLANO §6.5 item 5, §7): importar e salvar sem o seletor de arquivos
 * do Linux. Primeiro o pendrive, depois as pastas; só se enxerga o que está nos discos USB (a casca
 * recusa qualquer outro caminho). Tudo pelo teclado: Enter entra na pasta, a barra de espaço marca o
 * arquivo, Esc fecha. Quem pede é `pendrive.ts`.
 */
import type { DiscoUSB, ErroSistema, ItemDePasta } from '@ekfrase/writer-nucleo';
import { useEffect, useRef, useState } from 'preact/hooks';
import { t } from '../textos.ts';
import { Camada, avisar } from '../ui.tsx';
import { sistemaOS } from './casca.ts';
import { aoPedidoDePendrive, fecharPedido, pedidoDePendrive, terminarPedido, type ArquivoLido, type PedidoDePendrive } from './pendrive.ts';
import { tamanho, useDiscos } from './SistemaOS.tsx';

const os = sistemaOS as NonNullable<typeof sistemaOS>;

/** O tamanho de um arquivo (de poucos bytes a megas): o `tamanho` do painel arredonda tudo para pelo menos 1 MB. */
const tamanhoDoArquivo = (bytes: number): string => (bytes >= 1024 ** 2 ? tamanho(bytes) : bytes >= 1024 ? `${Math.round(bytes / 1024)} kB` : `${bytes} B`);

const textoDoErro = (e: ErroSistema): string => t(`writer.os.pendrive.erro.${e}`);

/** Montada uma vez no `App` (só no Writer OS): aparece quando alguém pede um arquivo ou um lugar para guardar. */
export function PendriveOS() {
  const [, setV] = useState(0);
  useEffect(() => aoPedidoDePendrive(() => setV((n) => n + 1)), []);
  const pedido = pedidoDePendrive();
  if (!pedido) return null;
  return <EscolherNoPendrive pedido={pedido} />;
}

function EscolherNoPendrive({ pedido }: { pedido: PedidoDePendrive }) {
  const [discos] = useDiscos();
  const [disco, setDisco] = useState<DiscoUSB | null>(null);
  const [raiz, setRaiz] = useState('');
  const [trilha, setTrilha] = useState<string[]>([]);
  const [itens, setItens] = useState<ItemDePasta[] | null>(null);
  const [marcados, setMarcados] = useState<string[]>([]);
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const vivo = useRef(true);
  useEffect(() => () => void (vivo.current = false), []);

  const caminho = (t: string[]): string => [raiz, ...t].join('/');

  // a lista mudou (escolheu o pendrive, entrou ou saiu de uma pasta): o foco vai ao primeiro item, nunca se perde
  useEffect(() => {
    const c = document.querySelector('[data-teste="os-pendrive"]');
    const alvo = c?.querySelector<HTMLElement>('[data-foco-inicial]') ?? c?.querySelector<HTMLElement>('.lista-pendrive li + li button, .lista-pendrive li + li input') ?? c?.querySelector<HTMLElement>('.lista-pendrive button');
    alvo?.focus();
  }, [disco, trilha.join('/'), discos?.length]);

  const abrirDisco = async (d: DiscoUSB) => {
    setOcupado(true);
    setErro(null);
    const a = await os.abrirDisco(d.id);
    const l = a.ok ? await os.listar(a.raiz) : a;
    if (!vivo.current) return;
    setOcupado(false);
    if (!l.ok) return setErro(textoDoErro(l.erro));
    setDisco(d);
    setRaiz(l.caminho);
    setTrilha([]);
    setItens(l.itens);
    setMarcados([]);
  };

  const irPara = async (nova: string[]) => {
    setErro(null);
    const l = await os.listar(caminho(nova));
    if (!vivo.current) return;
    if (!l.ok) return setErro(textoDoErro(l.erro));
    setTrilha(nova);
    setItens(l.itens);
    setMarcados([]);
  };

  const acima = () => {
    if (!trilha.length) {
      setDisco(null);
      setItens(null);
      return;
    }
    void irPara(trilha.slice(0, -1));
  };

  const importar = async () => {
    setOcupado(true);
    setErro(null);
    const lidos: ArquivoLido[] = [];
    for (const nome of marcados) {
      const r = await os.lerArquivo(`${caminho(trilha)}/${nome}`);
      if (!r.ok) {
        if (vivo.current) {
          setOcupado(false);
          setErro(`${nome}: ${textoDoErro(r.erro)}`);
        }
        return;
      }
      lidos.push({ nome, bytes: r.bytes });
    }
    terminarPedido(lidos);
  };

  const salvar = async () => {
    if (pedido.tipo !== 'salvar') return;
    setOcupado(true);
    setErro(null);
    const r = await os.gravarArquivo(caminho(trilha), pedido.nome, pedido.bytes);
    if (!r.ok) {
      if (vivo.current) {
        setOcupado(false);
        setErro(textoDoErro(r.erro));
      }
      return;
    }
    avisar(t('writer.os.pendrive.salvo', { nome: r.nome }));
    terminarPedido(true);
  };

  const marcar = (nome: string, v: boolean) => setMarcados((m) => (v ? [...m, nome] : m.filter((x) => x !== nome)));
  const importando = pedido.tipo === 'importar';
  const pastas = (itens ?? []).filter((i) => i.pasta);
  const arquivos = importando ? (itens ?? []).filter((i) => !i.pasta) : [];

  return (
    <Camada titulo={t(importando ? 'writer.os.pendrive.importar.titulo' : 'writer.os.pendrive.salvar.titulo')} fechar={fecharPedido} teste="os-pendrive">
      {!disco && (
        <div class="acoes-coluna">
          <p>{t('writer.os.pendrive.escolher')}</p>
          {(discos ?? []).map((d, i) => (
            <button key={d.id} type="button" class={i === 0 ? 'botao principal' : 'botao'} disabled={ocupado} onClick={() => void abrirDisco(d)} {...(i === 0 ? { 'data-foco-inicial': true } : {})} data-teste="os-pendrive-disco">
              {t('writer.os.pendrive.disco', { nome: d.rotulo || d.nome || d.id, tamanho: tamanho(d.tamanho) })}
            </button>
          ))}
          {discos && !discos.length && <p class="dica">{t('writer.os.onde.sem-disco')}</p>}
        </div>
      )}
      {disco && (
        <>
          <p data-teste="os-pendrive-onde">
            {t('writer.os.pendrive.onde', { onde: [disco.rotulo || disco.nome || disco.id, ...trilha].join(' / ') })}
          </p>
          {!importando && <p class="dica">{t('writer.os.pendrive.arquivo', { nome: pedido.nome })}</p>}
          <ul class="lista-pendrive" aria-label={t('writer.os.pendrive.lista')}>
            <li>
              <button type="button" class="botao pequeno" onClick={acima} data-teste="os-pendrive-acima">
                {t(trilha.length ? 'writer.os.pendrive.acima' : 'writer.os.pendrive.trocar')}
              </button>
            </li>
            {pastas.map((p) => (
              <li key={`p-${p.nome}`}>
                <button type="button" class="botao" onClick={() => void irPara([...trilha, p.nome])} data-teste="os-pendrive-pasta">
                  {t('writer.os.pendrive.pasta', { nome: p.nome })}
                </button>
              </li>
            ))}
            {arquivos.map((a) => (
              <li key={`a-${a.nome}`}>
                <label class="marcar">
                  <input type="checkbox" checked={marcados.includes(a.nome)} onChange={(e) => marcar(a.nome, e.currentTarget.checked)} data-teste="os-pendrive-arquivo" />
                  {t('writer.os.pendrive.arquivo-item', { nome: a.nome, tamanho: tamanhoDoArquivo(a.tamanho) })}
                </label>
              </li>
            ))}
          </ul>
          {itens && !pastas.length && !arquivos.length && <p class="dica">{t(importando ? 'writer.os.pendrive.vazia' : 'writer.os.pendrive.sem-pastas')}</p>}
          {importando && <p class="dica">{t('writer.os.pendrive.dica')}</p>}
          <div class="acoes-linha">
            {importando ? (
              <button type="button" class="botao principal" disabled={ocupado || !marcados.length} aria-busy={ocupado} onClick={() => void importar()} data-teste="os-pendrive-importar">
                {t('writer.os.pendrive.importar.botao', { n: marcados.length })}
              </button>
            ) : (
              <button type="button" class="botao principal" disabled={ocupado} aria-busy={ocupado} onClick={() => void salvar()} data-teste="os-pendrive-salvar">
                {t('writer.os.pendrive.salvar.botao')}
              </button>
            )}
          </div>
        </>
      )}
      {erro && (
        <p class="ekf-erro" role="alert" data-teste="os-pendrive-erro">
          {erro}
        </p>
      )}
    </Camada>
  );
}
