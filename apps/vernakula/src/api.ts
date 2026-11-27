// SPDX-License-Identifier: MPL-2.0

/**
 * Conversa com a ponte (ekfrase.com/api/v1). Toda resposta é `{ ok: true, … }`
 * ou `{ ok: false, erro: '<código>', … }`. O código do erro vira texto pelos
 * arquivos de idioma, nunca pela mensagem do servidor.
 */

export interface Conta {
  id: number;
  nome: string;
  email: string;
  /** X2c-2: o e-mail foi confirmado (as contas de antes, não, até abrirem o link "Confirme o seu e-mail"). */
  email_confirmado?: boolean;
  papeis: string[];
  organizacoes: { id: number; nome: string; papeis: string[] }[];
}

/** Textos da escola: idioma → chave → texto (só o que a escola trocou). */
export type TextosEscola = Record<string, Record<string, string>>;

/** Um arquivo guardado na ponte (PDF, áudio, vídeo, slides, imagem…). */
export interface Arquivo {
  id: number;
  nome: string;
  mime: string;
  grupo: 'documento' | 'apresentacao' | 'planilha' | 'audio' | 'video' | 'imagem' | 'outro';
  tamanho: number;
  url: string;
}

/** Um pedido de cadastro de escola (DEC-P059). */
export interface PedidoEscola {
  id: number;
  nome: string;
  cidade: string;
  mensagem: string;
  situacao: 'aberto' | 'aprovado' | 'recusado';
  motivo: string | null;
  escola: number | null;
  criado_em: string;
  decidido_em: string | null;
}

/** Cadastro pendente: a pessoa ainda não abriu o convite do e-mail. */
export interface Convite {
  id: number;
  nome: string;
  email: string;
  papel: 'docente' | 'discente';
  turma: number | null;
  turma_nome: string | null;
  curso_nome: string | null;
  enviado_em: string;
  expira_em: string;
  vencido: boolean;
  /** Em "convites para você" e no link do e-mail. */
  escola?: string;
  /** Só no link do e-mail: o e-mail convidado já tem conta Ekfrase? */
  tem_conta?: boolean;
}

export interface Turma {
  id: number;
  nome: string;
  pessoas: { id: number; nome: string; papel: 'docente' | 'discente' }[];
  pendentes: Convite[];
}

/** A administração da escola por dentro. */
export interface PainelEscola {
  escola: { id: number; nome: string };
  cursos: { id: number; nome: string; turmas: Turma[] }[];
  pessoas: { id: number; nome: string; email: string; papeis: string[] }[];
  convites: Convite[];
}

/** Uma escola em que a pessoa está, com os papéis dela lá. */
export type Escola = Conta['organizacoes'][number];

export type Resultado<T> = ({ ok: true } & T) | { ok: false; erro: string; [extra: string]: unknown };

let csrf = '';

/**
 * Pede; se o token CSRF venceu (a sessão mudou por outro caminho: entrar e trocar a senha agora passam pelo
 * `chaves` de `@ekfrase/interface`, que tem o token dele), pega outro e tenta de novo uma vez.
 */
async function pedir<T>(metodo: 'GET' | 'POST', caminho: string, corpo?: unknown): Promise<Resultado<T>> {
  const r = await pedirUmaVez<T>(metodo, caminho, corpo);
  if (metodo === 'POST' && !r.ok && r.erro === 'csrf') {
    await pedirUmaVez('GET', 'conta/eu');
    return pedirUmaVez<T>(metodo, caminho, corpo);
  }
  return r;
}

async function pedirUmaVez<T>(metodo: 'GET' | 'POST', caminho: string, corpo?: unknown): Promise<Resultado<T>> {
  let resposta: Response;
  try {
    resposta = await fetch(`/api/v1/${caminho}`, {
      method: metodo,
      credentials: 'same-origin',
      headers: {
        Accept: 'application/json',
        ...(corpo === undefined ? {} : { 'Content-Type': 'application/json' }),
        ...(metodo === 'POST' ? { 'X-CSRF-Token': csrf } : {}),
      },
      ...(corpo === undefined ? {} : { body: JSON.stringify(corpo) }),
    });
  } catch {
    return { ok: false, erro: 'rede' };
  }
  let dados: unknown;
  try {
    dados = await resposta.json();
  } catch {
    return { ok: false, erro: 'servidor' };
  }
  if (typeof dados !== 'object' || dados === null || !('ok' in dados)) return { ok: false, erro: 'servidor' };
  const d = dados as Resultado<T> & { csrf?: string };
  if (typeof d.csrf === 'string') csrf = d.csrf;
  return d;
}

/**
 * Envia um arquivo com barra de progresso (por isso XMLHttpRequest, e não
 * fetch: o fetch ainda não informa o progresso do envio).
 */
function enviarArquivo(
  arquivo: File,
  organizacao: number,
  aoProgredir?: (fracao: number) => void,
): Promise<Resultado<{ arquivo: Arquivo }>> {
  return new Promise((resolver) => {
    const dados = new FormData();
    dados.append('arquivo', arquivo);
    dados.append('organizacao', String(organizacao));
    const x = new XMLHttpRequest();
    x.open('POST', '/api/v1/arquivos');
    x.setRequestHeader('X-CSRF-Token', csrf);
    x.setRequestHeader('Accept', 'application/json');
    x.upload.onprogress = (e) => {
      if (e.lengthComputable) aoProgredir?.(e.loaded / e.total);
    };
    x.onerror = () => resolver({ ok: false, erro: 'rede' });
    x.onload = () => {
      try {
        const d = JSON.parse(x.responseText) as Resultado<{ arquivo: Arquivo }> & { csrf?: string };
        if (typeof d.csrf === 'string') csrf = d.csrf;
        // O servidor web (não a ponte) recusa arquivo grande demais sem JSON: 413 vira "grande".
        resolver(d);
      } catch {
        resolver({ ok: false, erro: x.status === 413 ? 'grande' : 'servidor' });
      }
    };
    x.send(dados);
  });
}

/**
 * A senha nunca vai à ponte por aqui (X2): entrar, o primeiro acesso, a senha nova pelo e-mail, trocar a senha e a
 * prova da senha são do `chaves` de `@ekfrase/interface` (a ponte recebe a chave de entrar, não a senha).
 */
export const api = {
  eu: () => pedir<{ conta: Conta | null; instalacao?: true }>('GET', 'conta/eu'),
  sair: () => pedir<object>('POST', 'conta/sair', {}),
  /** Manda o link de senha nova (a ponte responde igual tenha ou não conta). */
  esqueci: (email: string, idioma: string) => pedir<object>('POST', 'conta/esqueci', { email, idioma, app: 'vernakula' }),
  /**
   * Trocar o e-mail pede a prova da senha (`chaves.provaDaSenha`: `entrar_atual`). Num servidor com e-mail, o novo só
   * vale depois do link que chega nele (`email_pendente`, X2c-2/M6).
   */
  perfil: (dados: { nome: string; email: string; app: string; idioma: string; entrar_atual?: string }) =>
    pedir<{ conta: Conta; email_pendente?: string }>('POST', 'conta/perfil', dados),
  renomearEscola: (id: number, nome: string) => pedir<{ conta: Conta }>('POST', `organizacoes/${id}`, { nome }),
  /** As trocas de texto da escola (idioma → chave → texto). */
  textos: (organizacao: number) => pedir<{ textos: TextosEscola }>('GET', `textos?organizacao=${organizacao}`),
  /** Texto vazio volta ao padrão. */
  salvarTexto: (dados: { organizacao: number; idioma: string; chave: string; texto: string }) => pedir<object>('POST', 'textos', dados),
  enviarArquivo,

  // Escolas pedidas pelos usuários (DEC-P059)
  pedirEscola: (dados: { nome: string; cidade: string; mensagem: string; idioma: string }) =>
    pedir<{ pedido: PedidoEscola }>('POST', 'escolas/pedir', dados),
  meusPedidos: () => pedir<{ pedidos: PedidoEscola[] }>('GET', 'escolas/pedidos'),
  convitesMeus: () => pedir<{ convites: Convite[] }>('GET', 'convites/meus'),
  verConvite: (codigo: string) => pedir<{ convite: Convite }>('GET', `convites/ver?codigo=${encodeURIComponent(codigo)}`),
  /** Pelo código do e-mail (qualquer conta) ou pelo número (a conta do e-mail convidado). */
  aceitarConvite: (de: { codigo: string } | { id: number }) => pedir<{ escola: number; conta: Conta }>('POST', 'convites/aceitar', de),
  recusarConvite: (de: { codigo: string } | { id: number }) => pedir<object>('POST', 'convites/recusar', de),
  painel: (escola: number) => pedir<PainelEscola>('GET', `escolas/${escola}`),
  criarCurso: (escola: number, nome: string) => pedir<{ curso: { id: number } }>('POST', `escolas/${escola}/cursos`, { nome }),
  renomearCurso: (curso: number, nome: string) => pedir<object>('POST', `cursos/${curso}`, { nome }),
  apagarCurso: (curso: number) => pedir<object>('POST', `cursos/${curso}/apagar`, {}),
  criarTurma: (curso: number, nome: string) => pedir<{ turma: { id: number } }>('POST', `cursos/${curso}/turmas`, { nome }),
  renomearTurma: (turma: number, nome: string) => pedir<object>('POST', `turmas/${turma}`, { nome }),
  apagarTurma: (turma: number) => pedir<object>('POST', `turmas/${turma}/apagar`, {}),
  matricular: (turma: number, conta: number, papel: string) => pedir<object>('POST', `turmas/${turma}/matricular`, { conta, papel }),
  desmatricular: (turma: number, conta: number, papel: string) => pedir<object>('POST', `turmas/${turma}/desmatricular`, { conta, papel }),
  convidar: (escola: number, dados: { nome: string; email: string; papel: string; turma: number | null; idioma: string }) =>
    pedir<{ convite?: Convite; matriculado?: true }>('POST', `escolas/${escola}/convites`, dados),
  reenviarConvite: (id: number) => pedir<object>('POST', `convites/${id}/reenviar`, {}),
  cancelarConvite: (id: number) => pedir<object>('POST', `convites/${id}/cancelar`, {}),
  mudarPapeis: (escola: number, conta: number, papeis: string[]) => pedir<object>('POST', `escolas/${escola}/papeis`, { conta, papeis }),
};
