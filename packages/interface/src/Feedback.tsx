// SPDX-License-Identifier: MPL-2.0

/**
 * Feedback, no modelo do Persis (0.8): o balão do topo tira um PRINT da tela
 * ANTES de abrir a janela (senão a janela sairia no print). O print fica só na
 * memória da página e só vai se a pessoa marcar "Enviar o print desta tela".
 * Se não der para tirar (imagem de outro site, vídeo), a janela diz e segue.
 * O html2canvas-pro (MIT) é carregado só no primeiro uso.
 *
 * Quem não entrou também manda (e pode deixar um e-mail para resposta).
 * Envia para `POST /api/v1/feedback` (multipart).
 */
import { useEffect, useRef, useState } from 'preact/hooks';
import { IconeBalao } from './icones.tsx';
import { Janela } from './Janela.tsx';
import { contaAtual, enviarFeedback, limiteFeedback } from './ponte.ts';
import type { T } from './tipos.ts';

const MAX_ANEXOS = 5;

/** O print da parte da tela que a pessoa está vendo (JPEG), ou null. */
async function tirarPrint(): Promise<Blob | null> {
  const lib = await import('html2canvas-pro');
  const h2c = lib.default;
  const fundo = getComputedStyle(document.body).backgroundColor;
  const tela = await h2c(document.body, {
    x: scrollX,
    y: scrollY,
    width: innerWidth,
    height: innerHeight,
    windowWidth: document.documentElement.clientWidth,
    windowHeight: innerHeight,
    scale: Math.min(devicePixelRatio || 1, 2),
    backgroundColor: fundo && fundo !== 'rgba(0, 0, 0, 0)' ? fundo : '#26222e',
    logging: false,
    useCORS: false,
    ignoreElements: (no: Element) => no.classList.contains('ekf-fundo'),
  });
  return new Promise((ok) => tela.toBlob((b) => ok(b), 'image/jpeg', 0.88));
}

/** Espera a tela se desenhar sem os menus abertos (o clique fora já os fechou). */
const semMenus = () => new Promise<void>((ok) => setTimeout(() => requestAnimationFrame(() => requestAnimationFrame(() => ok())), 180));

const instalado = () => {
  try {
    return matchMedia('(display-mode: standalone)').matches || Boolean((navigator as { standalone?: boolean }).standalone);
  } catch {
    return false;
  }
};

export function BotaoFeedback({ t, app }: { t: T; app: string }) {
  const [ocupado, setOcupado] = useState(false);
  const [janela, setJanela] = useState<{ print: Blob | null; falhou: boolean } | null>(null);
  const rotulo = t('nucleo.feedback.botao');
  return (
    <>
      <button
        type="button"
        class="ekf-icone"
        title={rotulo}
        aria-label={rotulo}
        aria-busy={ocupado}
        disabled={ocupado}
        onClick={async () => {
          setOcupado(true);
          document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
          let print: Blob | null = null;
          let falhou = false;
          try {
            await semMenus();
            print = await tirarPrint();
            falhou = !print;
          } catch {
            falhou = true;
          }
          setOcupado(false);
          setJanela({ print, falhou });
        }}
      >
        <IconeBalao />
      </button>
      {janela && <JanelaFeedback t={t} app={app} {...janela} fechar={() => setJanela(null)} />}
    </>
  );
}

function JanelaFeedback({ t, app, print, falhou, fechar }: { t: T; app: string; print: Blob | null; falhou: boolean; fechar: () => void }) {
  const [tipo, setTipo] = useState<'erro' | 'ideia'>('erro');
  const [mensagem, setMensagem] = useState('');
  const [comPrint, setComPrint] = useState(false);
  const [contato, setContato] = useState('');
  const [erro, setErro] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [pronto, setPronto] = useState('');
  const [limite, setLimite] = useState<{ restam: number | null; volta_em: string | null } | null>(null);
  const anexos = useRef<HTMLInputElement>(null);
  const [urlPrint] = useState(() => (print ? URL.createObjectURL(print) : ''));
  const anonimo = (() => {
    const e = contaAtual();
    return e.carregando || !e.conta;
  })();

  useEffect(() => {
    void limiteFeedback().then((r) => r.ok && setLimite({ restam: r.restam, volta_em: r.volta_em }));
    return () => {
      if (urlPrint) URL.revokeObjectURL(urlPrint);
    };
  }, []);

  async function enviar(e: Event) {
    e.preventDefault();
    setErro('');
    if (!mensagem.trim()) return setErro(t('nucleo.feedback.erro.vazio'));
    const arqs = [...(anexos.current?.files ?? [])];
    if (arqs.length > MAX_ANEXOS) return setErro(t('nucleo.feedback.erro.muitos', { n: MAX_ANEXOS }));
    const d = new FormData();
    d.append('tipo', tipo);
    d.append('mensagem', mensagem.trim());
    d.append('app', app);
    d.append('pagina', location.pathname + location.hash);
    d.append('tela', `${innerWidth}x${innerHeight}`);
    d.append('instalado', instalado() ? '1' : '0');
    if (anonimo && contato.trim()) d.append('contato', contato.trim());
    if (print && comPrint) d.append('print', print, 'print.jpg');
    for (const f of arqs) d.append('anexo[]', f);
    setEnviando(true);
    const r = await enviarFeedback(d);
    setEnviando(false);
    if (r.ok) return setPronto(r.numero);
    if (r.erro === 'limite') return setErro(t('nucleo.feedback.erro.limite', { hora: String(r['volta_em'] ?? '') }));
    const conhecidos = ['vazio', 'tipo', 'grande', 'email', 'muitos', 'rede'];
    setErro(t(conhecidos.includes(r.erro) ? `nucleo.feedback.erro.${r.erro}` : 'nucleo.erro.servidor', { n: MAX_ANEXOS }));
  }

  if (pronto) {
    return (
      <Janela titulo={t('nucleo.feedback.titulo')} fechar={fechar} t={t}>
        <p class="ekf-ok" role="status">
          {t('nucleo.feedback.obrigado', { numero: pronto })}
        </p>
        <div class="ekf-linha">
          <button type="button" class="ekf-botao principal" onClick={fechar}>
            {t('nucleo.fechar')}
          </button>
        </div>
      </Janela>
    );
  }

  return (
    <Janela titulo={t('nucleo.feedback.titulo')} fechar={fechar} t={t}>
      <form class="ekf-form" onSubmit={enviar} noValidate>
        <div class="ekf-tipos" role="radiogroup" aria-label={t('nucleo.feedback.tipo')}>
          {(['erro', 'ideia'] as const).map((v) => (
            <label key={v} class="ekf-tipo">
              <input type="radio" name="tipo" value={v} checked={tipo === v} onChange={() => setTipo(v)} />
              <span>{t(`nucleo.feedback.tipo.${v}`)}</span>
            </label>
          ))}
        </div>
        <label class="ekf-campo">
          <span>{t(tipo === 'erro' ? 'nucleo.feedback.pergunta.erro' : 'nucleo.feedback.pergunta.ideia')}</span>
          <textarea
            rows={5}
            maxLength={5000}
            required
            value={mensagem}
            placeholder={t(tipo === 'erro' ? 'nucleo.feedback.exemplo.erro' : 'nucleo.feedback.exemplo.ideia')}
            onInput={(e) => setMensagem(e.currentTarget.value)}
          />
        </label>
        {urlPrint ? (
          <label class="ekf-print">
            <input type="checkbox" checked={comPrint} onChange={(e) => setComPrint(e.currentTarget.checked)} />
            <img src={urlPrint} alt={t('nucleo.feedback.print.alt')} />
            <span>
              <b>{t('nucleo.feedback.print.enviar')}</b>
              <small>{t('nucleo.feedback.print.aviso')}</small>
            </span>
          </label>
        ) : (
          <p class="ekf-aviso">{t(falhou ? 'nucleo.feedback.print.falhou' : 'nucleo.feedback.print.sem')}</p>
        )}
        <label class="ekf-campo">
          <span>{t('nucleo.feedback.anexos')}</span>
          <input ref={anexos} type="file" accept="image/png,image/jpeg,image/webp" multiple />
          <small>{t('nucleo.feedback.anexos.ajuda', { n: MAX_ANEXOS })}</small>
        </label>
        {anonimo && (
          <label class="ekf-campo">
            <span>{t('nucleo.feedback.contato')}</span>
            <input type="email" autoComplete="email" value={contato} onInput={(e) => setContato(e.currentTarget.value)} />
            <small>{t('nucleo.feedback.contato.ajuda')}</small>
          </label>
        )}
        <p class="ekf-dica">{t('nucleo.feedback.vai_junto')}</p>
        {limite && limite.restam !== null && (
          <p class="ekf-dica">
            {limite.restam === 0 ? t('nucleo.feedback.erro.limite', { hora: limite.volta_em ?? '' }) : t('nucleo.feedback.restam', { count: limite.restam })}
          </p>
        )}
        {erro && (
          <p class="ekf-erro" role="alert">
            {erro}
          </p>
        )}
        <div class="ekf-linha">
          <button type="submit" class="ekf-botao principal" disabled={enviando} aria-busy={enviando}>
            {t(enviando ? 'nucleo.feedback.enviando' : 'nucleo.feedback.enviar')}
          </button>
          <button type="button" class="ekf-botao" onClick={fechar}>
            {t('nucleo.cancelar')}
          </button>
        </div>
      </form>
    </Janela>
  );
}
