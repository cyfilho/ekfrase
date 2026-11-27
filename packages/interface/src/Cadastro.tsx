// SPDX-License-Identifier: MPL-2.0

/**
 * Criar conta pelo e-mail (X2c-2, `docs/revisao/seguranca-chaves.md` §5), as telas sobre o `chaves.ts`:
 * - `PassosDoCadastro`: depois do passo 1 (nome e e-mail), a espera "enviamos um link para <e-mail>" com o campo do
 *   código de 8 letras e, com o código certo, a senha (o `FormConta` mostra no lugar do formulário);
 * - `TelaDoCadastro`: a página do link do e-mail (`cadastro/<código>`, no site e no Vernákula), por tipo: a conta
 *   nova (a senha e o kit), o e-mail confirmado, o e-mail trocado e o "não fui eu" (o e-mail voltou);
 * - `ConfirmarEmail`: em Minha conta, a conta de antes do e-mail confirmado manda o link "Confirme o seu e-mail".
 */
import { useEffect, useRef, useState } from 'preact/hooks';
import { ambienteFechado } from './ambiente.ts';
import { entradaDoApp, site } from './enderecos.ts';
import { modoDoCadastro, pedirCadastro, pedirConfirmacaoDoEmail, terminarCadastro, verCadastro, type Cadastro, type CodigoDoCadastro } from './chaves.ts';
import { mostrarSituacao } from './Chaves.tsx';
import { BarraDaSenha, textoDoErro } from './Conta.tsx';
import { esqueciSenha, type Conta } from './ponte.ts';
import type { T } from './tipos.ts';

type Falha = { readonly erro: string; readonly [k: string]: unknown };

/** O texto de um erro do cadastro: o código errado ou vencido tem o texto daqui; o resto, o da conta. */
export function erroDoCadastro(t: T, r: Falha): string {
  if (r.erro === 'codigo_invalido') {
    return typeof r['restam'] === 'number' ? t('nucleo.cadastro.erro.codigo_errado', { restam: r['restam'] }) : t('nucleo.cadastro.erro.codigo_invalido');
  }
  if (r.erro === 'codigo_recusado') return t('nucleo.cadastro.erro.codigo_recusado');
  return textoDoErro(t, r.erro, r);
}

/** Os apps que têm o botão "Abrir o <app>" no fim do cadastro (os outros: "Continuar"). */
const APPS_DO_FIM = ['ekfrase', 'writer', 'maker', 'biblioteca', 'vernakula'];

/** Para onde vai o "Abrir o <app>": a entrada do app de onde a pessoa veio (o site, se veio do castelo). */
function destinoDoApp(app: string): { href: string; chave: string } {
  const conhecido = APPS_DO_FIM.includes(app);
  if (!conhecido || app === 'ekfrase') return { href: site.inicio, chave: conhecido ? 'nucleo.cadastro.abrir.ekfrase' : 'nucleo.cadastro.abrir' };
  return { href: entradaDoApp(app), chave: `nucleo.cadastro.abrir.${app}` };
}

/** O campo do código de 8 letras (`KQ7M-3XPA`): maiúsculas, o hífen é opcional. */
function CampoDoCodigo({ t, valor, aoMudar }: { t: T; valor: string; aoMudar: (v: string) => void }) {
  return (
    <label class="ekf-campo">
      <span>{t('nucleo.cadastro.codigo')}</span>
      <input
        name="codigo"
        class="ekf-codigo-campo ekf-codigo-cadastro"
        autoComplete="one-time-code"
        autoCapitalize="characters"
        spellcheck={false}
        maxLength={12}
        required
        value={valor}
        onInput={(e) => aoMudar(e.currentTarget.value.toUpperCase())}
      />
      <small>{t('nucleo.cadastro.codigo.ajuda')}</small>
    </label>
  );
}

/** A senha do passo 2 (a mesma na espera e na página do link). */
function CampoDaSenha({ t, valor, aoMudar }: { t: T; valor: string; aoMudar: (v: string) => void }) {
  return (
    <label class="ekf-campo">
      <span>{t('nucleo.conta.senha')}</span>
      <input name="senha" type="password" autoComplete="new-password" required minLength={8} value={valor} onInput={(e) => aoMudar(e.currentTarget.value)} />
      <small>{t('nucleo.conta.senha.ajuda')}</small>
    </label>
  );
}

/**
 * Depois do passo 1, no lugar do formulário de criar conta: a espera com o campo do código e, com o código certo, a
 * senha. Termina com a conta criada (o kit por cima). `aoVoltar` = "Usar outro e-mail".
 */
export function PassosDoCadastro({
  t,
  app,
  idioma,
  nome,
  email,
  aoEntrar,
  aoVoltar,
}: {
  t: T;
  app: string;
  idioma: string;
  nome: string;
  email: string;
  aoEntrar: (c: Conta) => void;
  aoVoltar: () => void;
}) {
  const [passo, setPasso] = useState<'espera' | 'senha'>('espera');
  const [codigo, setCodigo] = useState('');
  const [senha, setSenha] = useState('');
  const [quem, setQuem] = useState(nome);
  const [erro, setErro] = useState('');
  const [aviso, setAviso] = useState('');
  const [ocupado, setOcupado] = useState(false);
  const [progresso, setProgresso] = useState<number | null>(null);
  const c: CodigoDoCadastro = { email, codigo };

  async function conferir(e: Event) {
    e.preventDefault();
    setErro('');
    setAviso('');
    setOcupado(true);
    const r = await verCadastro(c);
    setOcupado(false);
    if (!r.ok) return setErro(erroDoCadastro(t, r));
    if (r.cadastro.tipo !== 'conta') return setErro(t('nucleo.cadastro.erro.codigo_invalido'));
    setQuem(r.cadastro.nome || nome);
    setPasso('senha');
  }

  async function terminar(e: Event) {
    e.preventDefault();
    const s = String(new FormData(e.currentTarget as HTMLFormElement).get('senha') ?? senha);
    setErro('');
    setOcupado(true);
    const r = await terminarCadastro(c, s, { idioma, aoProgredir: setProgresso });
    setOcupado(false);
    setProgresso(null);
    if (!r.ok) {
      // o código venceu entre um passo e outro: volta a pedir
      if (r.erro === 'codigo_invalido' || r.erro === 'codigo_recusado') setPasso('espera');
      return setErro(erroDoCadastro(t, r));
    }
    aoEntrar(r.conta);
    mostrarSituacao(t, r.situacao, idioma);
  }

  async function mandarDeNovo() {
    setErro('');
    setAviso('');
    setOcupado(true);
    const r = await pedirCadastro({ nome, email, idioma, app });
    setOcupado(false);
    if (r.ok) setAviso(t('nucleo.cadastro.de_novo.enviado'));
    else setErro(textoDoErro(t, r.erro, r));
  }

  const mensagens = (
    <>
      {erro && (
        <p class="ekf-erro" role="alert">
          {erro}
        </p>
      )}
      {aviso && (
        <p class="ekf-ok" role="status">
          {aviso}
        </p>
      )}
    </>
  );

  if (passo === 'senha') {
    return (
      <form class="ekf-form" data-ekf-cadastro="senha" onSubmit={terminar} noValidate>
        <p class="ekf-dica">{t('nucleo.cadastro.senha.texto', { nome: quem, email })}</p>
        {/* para o gerenciador de senhas guardar a senha com o e-mail certo */}
        <input type="email" name="email" autoComplete="username" value={email} readOnly hidden />
        <CampoDaSenha t={t} valor={senha} aoMudar={setSenha} />
        <BarraDaSenha t={t} fracao={progresso} />
        {mensagens}
        <div class="ekf-linha">
          <button type="submit" class="ekf-botao principal" disabled={ocupado} aria-busy={ocupado}>
            {t('nucleo.conta.criar.botao')}
          </button>
        </div>
      </form>
    );
  }

  return (
    <form class="ekf-form" data-ekf-cadastro="espera" onSubmit={conferir} noValidate>
      <p class="ekf-ok" role="status">
        {t(ambienteFechado() ? 'nucleo.cadastro.espera.fechado' : 'nucleo.cadastro.espera', { email })}
      </p>
      <p class="ekf-dica">{t(ambienteFechado() ? 'nucleo.cadastro.espera.dica_fechado' : 'nucleo.cadastro.espera.dica')}</p>
      <CampoDoCodigo t={t} valor={codigo} aoMudar={setCodigo} />
      {mensagens}
      <div class="ekf-linha">
        <button type="submit" class="ekf-botao principal" disabled={ocupado} aria-busy={ocupado}>
          {t('nucleo.cadastro.conferir')}
        </button>
      </div>
      <p class="ekf-trocar">
        <button type="button" class="ekf-link" disabled={ocupado} onClick={() => void mandarDeNovo()}>
          {t('nucleo.cadastro.de_novo')}
        </button>
        <button type="button" class="ekf-link" onClick={aoVoltar}>
          {t('nucleo.cadastro.outro_email')}
        </button>
      </p>
    </form>
  );
}

type Estado =
  | { readonly fase: 'abrindo' }
  | { readonly fase: 'invalido'; readonly texto: string }
  | { readonly fase: 'pronto'; readonly cadastro: Cadastro }
  | { readonly fase: 'criada'; readonly app: string };

/**
 * A página do link do e-mail (`ekfrase.com/cadastro/<código>`, `ekfrase.com/vernakula/cadastro/<código>`). Desenha o
 * título e o conteúdo; quem chama põe a moldura. `aoEntrar` = a conta nasceu e entrou (o app relê a conta dele).
 * `app` = o app desta página (o "esqueci a senha" do "não fui eu" sai com a cara dele).
 */
export function TelaDoCadastro({ t, codigo, idioma, app, aoEntrar }: { t: T; codigo: string; idioma: string; app: string; aoEntrar?: (c: Conta) => void }) {
  const [estado, setEstado] = useState<Estado>({ fase: 'abrindo' });
  const [senha, setSenha] = useState('');
  const [erro, setErro] = useState('');
  const [aviso, setAviso] = useState('');
  const [ocupado, setOcupado] = useState(false);
  const [progresso, setProgresso] = useState<number | null>(null);
  // o confirmar, o trocar e o desfazer terminam ao abrir: uma vez só, mesmo se a tela desenhar de novo
  const aberto = useRef(false);

  useEffect(() => {
    if (aberto.current) return;
    aberto.current = true;
    void verCadastro({ codigo }).then((r) => {
      if (r.ok) setEstado({ fase: 'pronto', cadastro: r.cadastro });
      else setEstado({ fase: 'invalido', texto: r.erro === 'codigo_invalido' || r.erro === 'codigo_recusado' ? t('nucleo.cadastro.link.invalido') : erroDoCadastro(t, r) });
    });
  }, [codigo]);

  if (estado.fase === 'abrindo') return <p class="ekf-dica">{t('nucleo.carregando')}</p>;
  if (estado.fase === 'invalido') {
    return (
      <div data-ekf-cadastro="invalido">
        <h1>{t('nucleo.cadastro.link.invalido.titulo')}</h1>
        <p>{estado.texto}</p>
      </div>
    );
  }
  if (estado.fase === 'criada') {
    const d = destinoDoApp(estado.app);
    return (
      <div data-ekf-cadastro="criada">
        <h1>{t('nucleo.cadastro.criada.titulo')}</h1>
        <p class="ekf-ok" role="status">
          {t('nucleo.cadastro.criada.texto')}
        </p>
        <div class="ekf-linha">
          <a class="ekf-botao principal" href={d.href}>
            {t(d.chave)}
          </a>
        </div>
      </div>
    );
  }

  const cad = estado.cadastro;
  if (cad.tipo === 'conta') {
    const terminar = async (e: Event) => {
      e.preventDefault();
      const s = String(new FormData(e.currentTarget as HTMLFormElement).get('senha') ?? senha);
      setErro('');
      setOcupado(true);
      const r = await terminarCadastro({ codigo }, s, { idioma, aoProgredir: setProgresso });
      setOcupado(false);
      setProgresso(null);
      if (!r.ok) {
        if (r.erro === 'codigo_invalido' || r.erro === 'codigo_recusado') return setEstado({ fase: 'invalido', texto: t('nucleo.cadastro.link.invalido') });
        return setErro(erroDoCadastro(t, r));
      }
      aoEntrar?.(r.conta);
      setEstado({ fase: 'criada', app: cad.app });
      mostrarSituacao(t, r.situacao, idioma); // o kit, por cima de tudo
    };
    return (
      <div data-ekf-cadastro="conta">
        <h1>{t('nucleo.cadastro.titulo')}</h1>
        <form class="ekf-form" onSubmit={terminar} noValidate>
          <p class="ekf-dica">{t('nucleo.cadastro.senha.texto', { nome: cad.nome, email: cad.email })}</p>
          <input type="email" name="email" autoComplete="username" value={cad.email} readOnly hidden />
          <CampoDaSenha t={t} valor={senha} aoMudar={setSenha} />
          <BarraDaSenha t={t} fracao={progresso} />
          {erro && (
            <p class="ekf-erro" role="alert">
              {erro}
            </p>
          )}
          <div class="ekf-linha">
            <button type="submit" class="ekf-botao principal" disabled={ocupado} aria-busy={ocupado}>
              {t('nucleo.conta.criar.botao')}
            </button>
          </div>
        </form>
      </div>
    );
  }

  if (cad.tipo === 'desfazer') {
    const novaSenha = async () => {
      setErro('');
      setOcupado(true);
      const r = await esqueciSenha(cad.email, app, idioma);
      setOcupado(false);
      if (r.ok) setAviso(t('nucleo.conta.esqueci.enviado'));
      else setErro(textoDoErro(t, r.erro, r));
    };
    return (
      <div data-ekf-cadastro="desfazer">
        <h1>{t('nucleo.cadastro.desfazer.titulo')}</h1>
        <p>{t('nucleo.cadastro.desfazer.texto', { email: cad.email })}</p>
        {erro && (
          <p class="ekf-erro" role="alert">
            {erro}
          </p>
        )}
        {aviso ? (
          <p class="ekf-ok" role="status">
            {aviso}
          </p>
        ) : (
          <div class="ekf-linha">
            <button type="button" class="ekf-botao principal" disabled={ocupado} aria-busy={ocupado} onClick={() => void novaSenha()}>
              {t('nucleo.cadastro.desfazer.botao')}
            </button>
          </div>
        )}
      </div>
    );
  }

  // confirmar (a conta de antes) e email (o e-mail novo): já terminou
  return (
    <div data-ekf-cadastro={cad.tipo}>
      <h1>{t(`nucleo.cadastro.${cad.tipo}.titulo`)}</h1>
      <p class="ekf-ok" role="status">
        {t(`nucleo.cadastro.${cad.tipo}.texto`, { email: cad.email })}
      </p>
      <div class="ekf-linha">
        <a class="ekf-botao principal" href={app === 'ekfrase' ? site.conta : entradaDoApp(app)}>
          {t('nucleo.cadastro.abrir')}
        </a>
      </div>
    </div>
  );
}

/**
 * Minha conta: "Confirme o seu e-mail" para a conta de antes do e-mail confirmado (só num servidor que manda e-mail).
 * `classe` = o painel do app. Some quando o e-mail está confirmado.
 */
export function ConfirmarEmail({ t, app, idioma, conta, classe = 'ekf-secao' }: { t: T; app: string; idioma: string; conta: { email: string; email_confirmado?: boolean }; classe?: string }) {
  const [modo, setModo] = useState<'email' | 'direto' | null>(null);
  const [enviado, setEnviado] = useState(false);
  const [confirmado, setConfirmado] = useState(false);
  const [erro, setErro] = useState('');
  const [ocupado, setOcupado] = useState(false);
  const pendente = conta.email_confirmado === false;
  useEffect(() => {
    if (pendente) void modoDoCadastro().then((r) => setModo(r.ok ? r.modo : 'direto'));
  }, [pendente]);
  if (!pendente || modo !== 'email' || confirmado) return null;
  const mandar = async () => {
    setErro('');
    setOcupado(true);
    const r = await pedirConfirmacaoDoEmail(app, idioma);
    setOcupado(false);
    if (!r.ok) return setErro(textoDoErro(t, r.erro, r));
    if (r.confirmado) setConfirmado(true);
    else setEnviado(true);
  };
  return (
    <section class={classe} data-ekf-secao="confirmar-email">
      <h2>{t('nucleo.cadastro.confirmar_email.titulo')}</h2>
      <p class="ekf-dica">{t('nucleo.cadastro.confirmar_email.texto', { email: conta.email })}</p>
      {erro && (
        <p class="ekf-erro" role="alert">
          {erro}
        </p>
      )}
      {enviado ? (
        <p class="ekf-ok" role="status">
          {t('nucleo.cadastro.confirmar_email.enviado', { email: conta.email })}
        </p>
      ) : (
        <div class="ekf-linha">
          <button type="button" class="ekf-botao principal" disabled={ocupado} aria-busy={ocupado} onClick={() => void mandar()}>
            {t('nucleo.cadastro.confirmar_email.botao')}
          </button>
        </div>
      )}
    </section>
  );
}
