// SPDX-License-Identifier: MPL-2.0

/**
 * O kit de recuperação na tela (X2, `docs/ARQUITETURA.md` §5.2): as 12 palavras numeradas, imprimir, conferir 3 e
 * "Depois". As palavras vêm do `situacao.kit` (a pessoa nasceu agora) ou do `verKit` (com a senha) e ficam só na memória
 * desta tela: ao fechar, somem. Quem mostra decide a moldura (a `Janela`, uma página); `aoTerminar(true)` = conferido.
 */
import { useState } from 'preact/hooks';
import { ambienteFechado } from './ambiente.ts';
import { conferirPalavras, marcarKitConferido, posicoesParaConferir, type KitParaMostrar } from './chaves.ts';
import { textoDoErro } from './Conta.tsx';
import { contaAtual } from './ponte.ts';
import type { T } from './tipos.ts';

/** De quem é o kit e quando foi impresso (só no papel: o kit sozinho não diz de que conta é). */
function legendaDoPapel(t: T): string {
  const c = contaAtual();
  const email = !c.carregando && c.conta ? c.conta.email : '';
  let data = '';
  try {
    data = new Intl.DateTimeFormat(document.documentElement.lang || 'pt-BR', { dateStyle: 'long' }).format(new Date());
  } catch {
    data = new Date().toLocaleDateString();
  }
  return email ? t('nucleo.kit.papel', { email, data }) : data;
}

/** O HTML da página do kit no papel: só o título, a legenda e as 12 palavras numeradas, preto no branco. */
export function paginaDoKit(t: T, kit: KitParaMostrar): string {
  const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
  const lang = esc(document.documentElement.lang || 'pt-BR');
  const palavras = kit.palavras.map((p) => `<li>${esc(p)}</li>`).join('');
  return (
    `<!doctype html><html lang="${lang}"><head><meta charset="utf-8"><title>${esc(t('nucleo.kit.titulo'))}</title><style>` +
    '@page{margin:2cm}' +
    'html,body{margin:0;background:#fff;color:#000;font-family:"Atkinson Hyperlegible Next","Atkinson Hyperlegible",Arial,sans-serif}' +
    'h1{font-family:"Cormorant Garamond",Georgia,serif;font-size:24pt;margin:0 0 6pt}' +
    'p{margin:0 0 18pt;font-size:11pt}' +
    'ol{display:grid;grid-template-columns:repeat(3,1fr);gap:10pt 36pt;margin:0;padding-left:36pt;font-size:15pt}' +
    'li::marker{font-variant-numeric:tabular-nums}' +
    `</style></head><body><h1>${esc(t('nucleo.kit.titulo'))}</h1><p>${esc(legendaDoPapel(t))}</p>` +
    `<ol lang="${esc(kit.idioma)}">${palavras}</ol></body></html>`
  );
}

/**
 * A4: imprime o kit numa página só dele, num iframe escondido da mesma origem, e não a página do app (a janela por
 * cima e a tela da conta, de altura presa, saíam em branco no papel). O iframe some depois de imprimir.
 */
export function imprimirKit(t: T, kit: KitParaMostrar): void {
  document.querySelector('iframe.ekf-kit-papel')?.remove();
  const f = document.createElement('iframe');
  f.className = 'ekf-kit-papel';
  f.setAttribute('aria-hidden', 'true');
  f.tabIndex = -1;
  // fora da vista, mas com tamanho de página (com display:none, alguns navegadores imprimem vazio)
  f.style.cssText = 'position:fixed;right:0;bottom:0;width:21cm;height:29.7cm;border:0;opacity:0;pointer-events:none;z-index:-1';
  document.body.appendChild(f);
  const d = f.contentDocument;
  const w = f.contentWindow;
  if (!d || !w) {
    f.remove();
    return;
  }
  d.open();
  d.write(paginaDoKit(t, kit));
  d.close();
  const tirar = () => setTimeout(() => f.remove(), 1000);
  w.addEventListener('afterprint', tirar, { once: true });
  w.focus();
  w.print();
  // o print() espera a pessoa no Chrome e no Firefox; onde não espera, o afterprint tira o iframe
}

/** `semTitulo` = quem mostra já tem o título (a janela). No papel, o título e a legenda saem sempre (`imprimirKit`). */
export function TelaDoKit({ t, kit, aoTerminar, semTitulo = false }: { t: T; kit: KitParaMostrar; aoTerminar: (conferido: boolean) => void; semTitulo?: boolean }) {
  const [passo, setPasso] = useState<'ver' | 'conferir'>('ver');
  const [posicoes, setPosicoes] = useState<number[]>(() => posicoesParaConferir());
  const [respostas, setRespostas] = useState<string[]>([]);
  const [erro, setErro] = useState('');
  const [ocupado, setOcupado] = useState(false);

  const irConferir = () => {
    setPosicoes(posicoesParaConferir());
    setRespostas([]);
    setErro('');
    setPasso('conferir');
  };

  async function conferir(e: Event) {
    e.preventDefault();
    if (!conferirPalavras(kit, posicoes, respostas)) {
      setErro(textoDoErro(t, 'kit_conferencia'));
      return;
    }
    setOcupado(true);
    const r = await marcarKitConferido();
    setOcupado(false);
    if (r.ok) aoTerminar(true);
    else setErro(textoDoErro(t, r.erro));
  }

  if (passo === 'conferir') {
    return (
      <form class="ekf-form ekf-kit" onSubmit={conferir} noValidate>
        <p class="ekf-dica">{t('nucleo.kit.conferir.explicacao')}</p>
        {posicoes.map((p, i) => (
          <label class="ekf-campo" key={p}>
            <span>{t('nucleo.kit.conferir.palavra', { n: p + 1 })}</span>
            <input
              autoComplete="off"
              autoCapitalize="none"
              spellcheck={false}
              value={respostas[i] ?? ''}
              onInput={(ev) => {
                const v = ev.currentTarget.value;
                setRespostas((a) => {
                  const n = [...a];
                  n[i] = v;
                  return n;
                });
              }}
            />
          </label>
        ))}
        {erro && (
          <p class="ekf-erro" role="alert">
            {erro}
          </p>
        )}
        <div class="ekf-linha">
          <button type="submit" class="ekf-botao principal" disabled={ocupado} aria-busy={ocupado}>
            {t('nucleo.kit.conferir.botao')}
          </button>
          <button type="button" class="ekf-botao" onClick={() => setPasso('ver')}>
            {t('nucleo.kit.voltar')}
          </button>
        </div>
      </form>
    );
  }

  return (
    <div class="ekf-kit">
      {!semTitulo && <h2 class="ekf-kit-titulo">{t('nucleo.kit.titulo')}</h2>}
      <p class="ekf-dica">{t('nucleo.kit.explicacao')}</p>
      <ol class="ekf-kit-palavras" lang={kit.idioma}>
        {kit.palavras.map((p, i) => (
          <li key={i}>{p}</li>
        ))}
      </ol>
      <div class="ekf-linha ekf-kit-botoes">
        <button type="button" class="ekf-botao principal" onClick={irConferir}>
          {t('nucleo.kit.anotei')}
        </button>
        {/* no Writer OS não há impressora: só anotar */}
        {!ambienteFechado() && (
          <button type="button" class="ekf-botao" onClick={() => imprimirKit(t, kit)}>
            {t('nucleo.kit.imprimir')}
          </button>
        )}
        <button type="button" class="ekf-link" onClick={() => aoTerminar(false)}>
          {t('nucleo.kit.depois')}
        </button>
      </div>
    </div>
  );
}
