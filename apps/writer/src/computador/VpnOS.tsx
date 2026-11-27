// SPDX-License-Identifier: MPL-2.0

/**
 * A VPN do WRITER OS (PLANO §7, "VPN"; W4, parte 2c-2): a parte "VPN" do menu do sistema e o cadeado ao lado da
 * bateria. Quem faz o trabalho é a casca (`os.importarVpn`, `ligarVpn`, `desligarVpn`, `esquecerVpn`, `vpnSozinha`);
 * aqui só a tela.
 *
 * - "Importar o arquivo da VPN" abre a tela dos pendrives (`escolherVpnNoPendrive`: só `.conf` e `.ovpn`); o arquivo
 *   vai à casca, que o confere de novo (as diretivas proibidas do `.ovpn`, o tamanho, o tipo).
 * - Cada VPN tem Ligar/Desligar (um botão só, que troca), Esquecer (com confirmação: o arquivo sai do cofre) e
 *   "Ligar sozinha quando houver internet" (padrão: não). O OpenVPN que pede usuário e senha mostra os campos ACIMA da
 *   lista (como a senha do Wi-Fi), com o foco neles; deu certo, a casca os guarda cifrados e não pergunta mais.
 * - "Adicionar VPN de empresa" (W5a-2): Cisco AnyConnect, GlobalProtect ou Fortinet, sem arquivo: o tipo, o servidor, o usuário e
 *   a senha; adicionada, liga em seguida. Ligar pode pedir o código do segundo fator (`segundo-fator`) ou a confiança num
 *   certificado que o sistema não conhece (`certificado`, com a impressão para conferir com a TI); `sso` (login só pelo
 *   navegador) é dito e não tem saída aqui.
 * - A lista é uma só para a tela toda (`useVpns`), relida a cada 20 s enquanto alguém olha: a casca liga sozinha a
 *   que pede, e o cadeado do `RelogioOS` precisa saber.
 */
import type { ExtraVpn, PonteSistema, ProtocoloVpn, RespostaVpn, VpnOS } from '@ekfrase/writer-nucleo';
import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import { IconeCadeado } from '../icones.tsx';
import { t } from '../textos.ts';
import { confirmar } from '../ui.tsx';
import { sistemaOS } from './casca.ts';
import { escolherVpnNoPendrive } from './pendrive.ts';

const os = sistemaOS as PonteSistema;

const PROTOCOLOS: ProtocoloVpn[] = ['anyconnect', 'gp', 'fortinet'];

/** A casca liga sozinha a VPN que pede (a vigia dela é de 20 s): a página relê no mesmo ritmo. */
const RELER_MS = 20_000;

// ---------- a lista, uma só para a tela toda ----------

/** `null` = ainda lendo. */
let atual: VpnOS[] | null = null;
const ouvintes = new Set<() => void>();
let parar: (() => void) | null = null;

/** A casca respondeu com a lista nova (só avisa quem olha se algo mudou). */
export function mudarVpns(lista: VpnOS[]): void {
  if (atual && JSON.stringify(atual) === JSON.stringify(lista)) return;
  atual = lista;
  for (const f of [...ouvintes]) f();
}

/** Pergunta à casca agora. */
export function lerVpns(): Promise<VpnOS[]> {
  if (!sistemaOS) return Promise.resolve([]);
  return os.vpns().then(
    (l) => {
      mudarVpns(l);
      return l;
    },
    () => atual ?? [],
  );
}

function iniciar(): () => void {
  if (!sistemaOS) return () => undefined;
  void lerVpns();
  const i = setInterval(() => void lerVpns(), RELER_MS);
  return () => clearInterval(i);
}

/** As VPNs agora (`null` enquanto lê). */
export function useVpns(): VpnOS[] | null {
  const [, setV] = useState(0);
  useEffect(() => {
    const f = () => setV((n) => n + 1);
    ouvintes.add(f);
    if (ouvintes.size === 1) parar = iniciar();
    return () => {
      ouvintes.delete(f);
      if (!ouvintes.size) {
        parar?.();
        parar = null;
      }
    };
  }, []);
  return atual;
}

/** O nome da VPN ligada (para o cadeado), ou `null`. */
export function useVpnLigada(): string | null {
  return useVpns()?.find((v) => v.ligada)?.nome ?? null;
}

/** O cadeado pequeno ao lado da bateria, só com uma VPN ligada (quem o põe é o `RelogioOS`). */
export function CadeadoDaVpn({ nome }: { nome: string | null }) {
  if (!nome) return null;
  const rotulo = t('writer.os.vpn.cadeado', { nome });
  return (
    <span class="vpn-cadeado" title={rotulo} aria-label={rotulo} data-teste="os-vpn-cadeado">
      <IconeCadeado tamanho={12} />
    </span>
  );
}

/** O que dizer de uma resposta que deu errado (`proibida` diz qual linha do arquivo). */
export function textoDoErroVpn(r: Extract<RespostaVpn, { ok: false }>): string {
  return r.erro === 'proibida' ? t('writer.os.vpn.erro.proibida', { diretiva: r.diretiva ?? '?' }) : t(`writer.os.vpn.erro.${r.erro}`);
}

// ---------- a parte "VPN" do menu do sistema ----------

export function ParteVpn() {
  const lista = useVpns();
  // ao abrir, a lista de agora (a de todos pode ter sido lida antes de as do cofre voltarem); antes disso, nada aparece
  // e o menu espera pelo primeiro botão: o foco cai no Ligar da primeira VPN, ou no Importar
  const [lida, setLida] = useState(false);
  useEffect(() => void lerVpns().finally(() => setLida(true)), []);
  const vpns = lida ? lista : null;
  const [pedindo, setPedindo] = useState<VpnOS | null>(null);
  const [usuario, setUsuario] = useState('');
  const [senha, setSenha] = useState('');
  const [aviso, setAviso] = useState<{ texto: string; erro: boolean } | null>(null);
  const [ocupado, setOcupado] = useState(false);
  // a VPN de empresa: o formulário de adicionar, o código do segundo fator e o certificado em que confiar
  const [nova, setNova] = useState(false);
  const [protocolo, setProtocolo] = useState<ProtocoloVpn>('anyconnect');
  const [servidor, setServidor] = useState('');
  const [codigo, setCodigo] = useState('');
  const [pedindoCodigo, setPedindoCodigo] = useState<VpnOS | null>(null);
  const [certificado, setCertificado] = useState<{ v: VpnOS; impressao: string } | null>(null);
  /** A impressão em que a pessoa já confiou nesta tentativa (vai junto quando o servidor ainda pede o código). */
  const confiou = useRef<string | null>(null);
  const campoServidor = useRef<HTMLInputElement>(null);
  const campoCodigo = useRef<HTMLInputElement>(null);
  const botaoConfiar = useRef<HTMLButtonElement>(null);
  const botaoEmpresa = useRef<HTMLButtonElement>(null);
  const raiz = useRef<HTMLElement>(null);
  const botaoImportar = useRef<HTMLButtonElement>(null);
  const campoUsuario = useRef<HTMLInputElement>(null);
  const campoSenha = useRef<HTMLInputElement>(null);

  // a lista demorou mais do que o menu espera pelo primeiro botão: o foco, que ficou fora, vem para a parte
  useLayoutEffect(() => {
    const r = raiz.current;
    if (!lida || !r || r.contains(document.activeElement)) return;
    (r.querySelector<HTMLElement>('.vpn-alternar') ?? botaoImportar.current)?.focus();
  }, [lida]);

  // pediu o usuário e a senha: o foco vai para o primeiro campo vazio (os campos ficam ACIMA da lista)
  useLayoutEffect(() => {
    if (!pedindo) return;
    (pedindo.usuario ? campoSenha : campoUsuario).current?.focus();
  }, [pedindo]);

  useLayoutEffect(() => {
    if (!nova) return;
    campoServidor.current?.focus();
    // o botão que abriu o formulário fica desabilitado e leva o foco junto: de novo, já com a tela assentada
    const i = setTimeout(() => {
      const em = document.activeElement;
      if (!em || em === document.body || em.tagName === 'SELECT') campoServidor.current?.focus();
    }, 50);
    return () => clearTimeout(i);
  }, [nova]);
  useLayoutEffect(() => {
    if (pedindoCodigo) campoCodigo.current?.focus();
  }, [pedindoCodigo]);
  useLayoutEffect(() => {
    if (certificado) botaoConfiar.current?.focus();
  }, [certificado]);

  /**
   * O foco vai ao botão Ligar/Desligar de uma VPN (ou ao Importar, se ela sumiu). Com `respeitar`, quem já está com o
   * foco dentro da linha dessa VPN fica onde está: a pessoa pode ter apertado Tab logo depois de Ligar (no CI lento, o
   * Enter seguinte caía no Desligar, puxado de volta pelo foco que chegava atrasado).
   */
  const focarNa = (nome: string | null, respeitar = false) =>
    setTimeout(() => {
      const linha = [...(raiz.current?.querySelectorAll<HTMLElement>('[data-teste="os-vpn"]') ?? [])].find((l) => l.dataset['nome'] === nome);
      if (respeitar && linha && linha.contains(document.activeElement)) return;
      (linha?.querySelector<HTMLElement>('.vpn-alternar') ?? botaoImportar.current)?.focus();
    }, 0);

  const importar = async () => {
    setAviso(null);
    const a = await escolherVpnNoPendrive();
    if (!a) return;
    setOcupado(true);
    setAviso({
      texto: t('writer.os.vpn.importando', { nome: a.nome }),
      erro: false,
    });
    const r = await os.importarVpn(a.nome, a.bytes).catch((): RespostaVpn => ({ ok: false, erro: 'falhou' }));
    setOcupado(false);
    if (!r.ok) {
      setAviso({ texto: `${a.nome}: ${textoDoErroVpn(r)}`, erro: true });
      focarNa(null);
      return;
    }
    await lerVpns();
    setAviso({
      texto: t('writer.os.vpn.importou', { nome: r.nome }),
      erro: false,
    });
    focarNa(r.nome);
  };

  const ligar = async (v: VpnOS, u: string | null, s: string | null, extra?: ExtraVpn) => {
    setOcupado(true);
    setAviso({
      texto: t('writer.os.vpn.ligando', { nome: v.nome }),
      erro: false,
    });
    const r = await os.ligarVpn(v.nome, u, s, extra).catch((): RespostaVpn => ({ ok: false, erro: 'falhou' }));
    setOcupado(false);
    await lerVpns();
    if (r.ok) {
      setPedindo(null);
      setSenha('');
      setPedindoCodigo(null);
      setCertificado(null);
      setCodigo('');
      confiou.current = null;
      setAviso({
        texto: t('writer.os.vpn.ligou', { nome: v.nome }),
        erro: false,
      });
      focarNa(v.nome, true);
      return;
    }
    // a VPN de empresa pede o código do segundo fator, ou a confiança num certificado novo
    if (r.erro === 'segundo-fator') {
      if (extra?.confiar) confiou.current = extra.confiar;
      setAviso(null);
      setCodigo('');
      setCertificado(null);
      setPedindoCodigo(v);
      return;
    }
    if (r.erro === 'certificado' && r.impressao) {
      setAviso(null);
      setPedindoCodigo(null);
      setCertificado({ v, impressao: r.impressao });
      return;
    }
    setAviso({ texto: textoDoErroVpn(r), erro: true });
    if (r.erro === 'sso' || r.erro === 'servidor') {
      focarNa(v.nome, true);
      return;
    }
    // o código não serviu: o campo, de novo
    if (r.erro === 'senha' && pedindoCodigo) {
      setTimeout(() => campoCodigo.current?.select(), 0);
      return;
    }
    // o usuário ou a senha não serviram (os digitados agora ou os guardados): os campos, de novo
    if (r.erro === 'senha' && v.pedeSenha) {
      if (pedindo) setTimeout(() => campoSenha.current?.select(), 0);
      else {
        setUsuario(v.usuario ?? '');
        setSenha('');
        setPedindo(v);
      }
    } else focarNa(v.nome, true);
  };

  const alternar = async (v: VpnOS) => {
    if (v.ligada) {
      setOcupado(true);
      const r = await os.desligarVpn(v.nome).catch((): RespostaVpn => ({ ok: false, erro: 'falhou' }));
      setOcupado(false);
      await lerVpns();
      setAviso(
        r.ok
          ? {
              texto: t('writer.os.vpn.desligou', { nome: v.nome }),
              erro: false,
            }
          : { texto: textoDoErroVpn(r), erro: true },
      );
      focarNa(v.nome, true);
      return;
    }
    if (v.pedeCodigo) {
      setAviso(null);
      setCodigo('');
      confiou.current = null;
      setPedindoCodigo(v);
      return;
    }
    if (v.pedeSenha && !v.temSenha) {
      setAviso(null);
      setUsuario(v.usuario ?? '');
      setSenha('');
      setPedindo(v);
      return;
    }
    await ligar(v, null, null);
  };

  const esquecer = async (v: VpnOS) => {
    if (!(await confirmar(t('writer.os.vpn.esquecer.confirmar', { nome: v.nome }), t('writer.os.vpn.esquecer'), true))) {
      focarNa(v.nome);
      return;
    }
    setOcupado(true);
    await os.esquecerVpn(v.nome).catch(() => undefined);
    setOcupado(false);
    if (pedindo?.nome === v.nome) setPedindo(null);
    const lista = await lerVpns();
    setAviso({
      texto: t('writer.os.vpn.esqueceu', { nome: v.nome }),
      erro: false,
    });
    focarNa(lista[0]?.nome ?? null);
  };

  const adicionar = async () => {
    setOcupado(true);
    setAviso(null);
    const r = await os.adicionarVpnEmpresa({ protocolo, servidor: servidor.trim(), usuario, senha }).catch((): RespostaVpn => ({ ok: false, erro: 'falhou' }));
    setOcupado(false);
    if (!r.ok) {
      setAviso({ texto: textoDoErroVpn(r), erro: true });
      setTimeout(() => (r.erro === 'senha' ? campoSenha : campoServidor).current?.focus(), 0);
      return;
    }
    setNova(false);
    setServidor('');
    setUsuario('');
    setSenha('');
    const v = (await lerVpns()).find((x) => x.nome === r.nome);
    setAviso({ texto: t('writer.os.vpn.empresa.adicionou', { nome: r.nome }), erro: false });
    if (v) await ligar(v, null, null);
    else focarNa(r.nome);
  };

  const sozinha = async (v: VpnOS, sim: boolean) => {
    const lista = await os.vpnSozinha(v.nome, sim).catch(() => null);
    if (lista) mudarVpns(lista);
  };

  return (
    <section class="secao-os" data-teste="os-painel-vpn" aria-label={t('writer.os.vpn.titulo')} ref={raiz}>
      <p class="dica">{t('writer.os.vpn.texto')}</p>
      {vpns === null && <p aria-busy="true">{t('writer.os.vpn.lendo')}</p>}
      {/* o usuário e a senha do OpenVPN ficam ACIMA da lista, como a senha do Wi-Fi: à vista, sem rolar */}
      {nova && (
        <form
          class="form-casca"
          onSubmit={(e) => {
            e.preventDefault();
            if (servidor.trim() && usuario && senha) void adicionar();
          }}
          noValidate
          data-teste="os-vpn-empresa-form"
        >
          <p class="dica">{t('writer.os.vpn.empresa.texto')}</p>
          <label class="campo">
            <span>{t('writer.os.vpn.empresa.tipo')}</span>
            <select value={protocolo} onChange={(e) => setProtocolo(e.currentTarget.value as ProtocoloVpn)} data-teste="os-vpn-empresa-tipo">
              {PROTOCOLOS.map((p) => (
                <option key={p} value={p}>
                  {t(`writer.os.vpn.protocolo.${p}`)}
                </option>
              ))}
            </select>
          </label>
          <label class="campo">
            <span>{t('writer.os.vpn.empresa.servidor')}</span>
            <input type="text" autocomplete="off" spellcheck={false} value={servidor} onInput={(e) => setServidor(e.currentTarget.value)} ref={campoServidor} data-teste="os-vpn-empresa-servidor" />
          </label>
          <label class="campo">
            <span>{t('writer.os.vpn.usuario')}</span>
            <input type="text" autocomplete="off" spellcheck={false} value={usuario} onInput={(e) => setUsuario(e.currentTarget.value)} data-teste="os-vpn-usuario" />
          </label>
          <label class="campo">
            <span>{t('writer.os.vpn.senha')}</span>
            <input type="password" value={senha} onInput={(e) => setSenha(e.currentTarget.value)} ref={campoSenha} data-teste="os-vpn-senha" />
          </label>
          <div class="acoes-linha">
            <button type="submit" class="botao principal" disabled={ocupado || !servidor.trim() || !usuario || !senha} data-teste="os-vpn-empresa-adicionar">
              {t('writer.os.vpn.empresa.adicionar')}
            </button>
            <button
              type="button"
              class="botao"
              onClick={() => {
                setNova(false);
                setSenha('');
                setTimeout(() => botaoEmpresa.current?.focus(), 0);
              }}
              data-teste="os-vpn-empresa-cancelar"
            >
              {t('writer.os.cancelar')}
            </button>
          </div>
        </form>
      )}
      {pedindoCodigo && (
        <form
          class="form-casca"
          onSubmit={(e) => {
            e.preventDefault();
            if (codigo) void ligar(pedindoCodigo, null, null, { codigo, ...(confiou.current ? { confiar: confiou.current } : {}) });
          }}
          noValidate
          data-teste="os-vpn-codigo-form"
        >
          <p>{t('writer.os.vpn.codigo.pede', { nome: pedindoCodigo.nome })}</p>
          <label class="campo">
            <span>{t('writer.os.vpn.codigo')}</span>
            <input type="text" inputMode="numeric" autocomplete="off" spellcheck={false} value={codigo} onInput={(e) => setCodigo(e.currentTarget.value)} ref={campoCodigo} data-teste="os-vpn-codigo" />
          </label>
          <div class="acoes-linha">
            <button type="submit" class="botao principal" disabled={ocupado || !codigo} data-teste="os-vpn-codigo-ligar">
              {t('writer.os.vpn.ligar')}
            </button>
            <button
              type="button"
              class="botao"
              onClick={() => {
                const nome = pedindoCodigo.nome;
                setPedindoCodigo(null);
                setCodigo('');
                confiou.current = null;
                focarNa(nome);
              }}
              data-teste="os-vpn-codigo-cancelar"
            >
              {t('writer.os.cancelar')}
            </button>
          </div>
        </form>
      )}
      {certificado && (
        <div class="form-casca" role="group" aria-label={t('writer.os.vpn.erro.certificado')} data-teste="os-vpn-certificado">
          <p>{t('writer.os.vpn.certificado.pede', { nome: certificado.v.nome })}</p>
          <p>
            <code class="vpn-impressao" data-teste="os-vpn-impressao">{certificado.impressao}</code>
          </p>
          <div class="acoes-linha">
            <button
              type="button"
              class="botao principal"
              ref={botaoConfiar}
              disabled={ocupado}
              onClick={() => {
                const c = certificado;
                setCertificado(null);
                confiou.current = c.impressao;
                void ligar(c.v, null, null, { confiar: c.impressao });
              }}
              data-teste="os-vpn-confiar"
            >
              {t('writer.os.vpn.certificado.confiar')}
            </button>
            <button
              type="button"
              class="botao"
              onClick={() => {
                const nome = certificado.v.nome;
                setCertificado(null);
                focarNa(nome);
              }}
              data-teste="os-vpn-certificado-cancelar"
            >
              {t('writer.os.cancelar')}
            </button>
          </div>
        </div>
      )}
      {pedindo && (
        <form
          class="form-casca"
          onSubmit={(e) => {
            e.preventDefault();
            if (usuario && senha) void ligar(pedindo, usuario, senha);
          }}
          noValidate
          data-teste="os-vpn-senha-form"
        >
          <p>{t('writer.os.vpn.pede', { nome: pedindo.nome })}</p>
          <label class="campo">
            <span>{t('writer.os.vpn.usuario')}</span>
            <input type="text" autocomplete="off" spellcheck={false} value={usuario} onInput={(e) => setUsuario(e.currentTarget.value)} ref={campoUsuario} data-teste="os-vpn-usuario" />
          </label>
          <label class="campo">
            <span>{t('writer.os.vpn.senha')}</span>
            <input type="password" value={senha} onInput={(e) => setSenha(e.currentTarget.value)} ref={campoSenha} data-teste="os-vpn-senha" />
          </label>
          <div class="acoes-linha">
            <button type="submit" class="botao principal" disabled={ocupado || !usuario || !senha} data-teste="os-vpn-senha-ligar">
              {t('writer.os.vpn.ligar')}
            </button>
            <button
              type="button"
              class="botao"
              onClick={() => {
                const nome = pedindo.nome;
                setPedindo(null);
                setSenha('');
                focarNa(nome);
              }}
              data-teste="os-vpn-senha-cancelar"
            >
              {t('writer.os.cancelar')}
            </button>
          </div>
        </form>
      )}
      {vpns && !vpns.length && <p data-teste="os-vpn-nenhuma">{t('writer.os.vpn.nenhuma')}</p>}
      {vpns && vpns.length > 0 && (
        <ul class="lista-vpn" aria-label={t('writer.os.vpn.lista')}>
          {vpns.map((v) => (
            <li key={v.nome} class="vpn-os" role="group" aria-label={v.nome} data-nome={v.nome} data-ligada={v.ligada ? 'sim' : 'nao'} data-teste="os-vpn">
              <p class="vpn-os-nome">
                <strong>{v.nome}</strong>
                <small>
                  {' · '}
                  {t(`writer.os.vpn.tipo.${v.tipo}`)}
                  {v.tipo === 'openconnect' && v.protocolo && ` (${t(`writer.os.vpn.protocolo.${v.protocolo}`)}${v.servidor ? `, ${v.servidor}` : ''})`}
                  {' · '}
                  {t(v.ligada ? 'writer.os.vpn.ligada' : 'writer.os.vpn.desligada')}
                </small>
              </p>
              <div class="acoes-linha">
                <button
                  type="button"
                  class={`botao vpn-alternar${v.ligada ? '' : ' principal'}`}
                  disabled={ocupado}
                  aria-pressed={v.ligada}
                  onClick={() => void alternar(v)}
                  data-teste={v.ligada ? 'os-vpn-desligar' : 'os-vpn-ligar'}
                >
                  {t(v.ligada ? 'writer.os.vpn.desligar' : 'writer.os.vpn.ligar')}
                </button>
                <button type="button" class="botao pequeno" disabled={ocupado} onClick={() => void esquecer(v)} data-teste="os-vpn-esquecer">
                  {t('writer.os.vpn.esquecer')}
                </button>
              </div>
              <label class="marcar">
                <input type="checkbox" checked={v.sozinha} disabled={ocupado} onChange={(e) => void sozinha(v, e.currentTarget.checked)} data-teste="os-vpn-sozinha" />
                {t('writer.os.vpn.sozinha')}
              </label>
              {v.sozinha && v.pedeSenha && !v.temSenha && <p class="dica">{t('writer.os.vpn.sozinha.sem-senha')}</p>}
            </li>
          ))}
        </ul>
      )}
      {vpns && (
        <div class="acoes-linha">
          <button
            type="button"
            class={vpns.length ? 'botao' : 'botao principal'}
            ref={botaoImportar}
            disabled={ocupado}
            aria-busy={ocupado}
            onClick={() => void importar()}
            data-teste="os-vpn-importar"
          >
            {t('writer.os.vpn.importar')}
          </button>
          <button
            type="button"
            class="botao"
            ref={botaoEmpresa}
            disabled={ocupado || nova}
            onClick={() => {
              setAviso(null);
              setUsuario('');
              setSenha('');
              setNova(true);
            }}
            data-teste="os-vpn-empresa"
          >
            {t('writer.os.vpn.empresa')}
          </button>
        </div>
      )}
      {aviso && (
        <p class={aviso.erro ? 'ekf-erro' : 'dica'} role={aviso.erro ? 'alert' : 'status'} data-teste={aviso.erro ? 'os-vpn-erro' : 'os-vpn-recado'}>
          {aviso.texto}
        </p>
      )}
    </section>
  );
}
