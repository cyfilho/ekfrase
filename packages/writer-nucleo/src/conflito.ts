// SPDX-License-Identifier: MPL-2.0

/**
 * CONFLITOS (docs/writer/PLANO.md §4.3; especificação em docs/writer/protocolo/README.md §4 e §5).
 * Tudo aqui é função PURA: as mesmas entradas dão a mesma saída em qualquer aparelho e em qualquer
 * linguagem (os casos de conformidade ficam em docs/writer/protocolo/cliente/).
 *
 * - Campo a campo, vence a versão maior (`dados._v`); no empate, o lado do servidor.
 * - Lápide: `apagado` também tem versão (`_v.apagado`). Uma edição MAIS NOVA que a lápide traz o
 *   registro de volta (ninguém perde o que escreveu depois de outro aparelho apagar).
 * - Texto de cena: se os dois lados mudaram o texto desde a base comum (em aparelhos diferentes) e os textos diferem, o de
 *   versão maior fica na cena e o outro vira uma cena irmã nova (a "cópia de conflito"), com id,
 *   versão e conteúdo que dependem SÓ do registro que perdeu: todo aparelho gera a mesma cópia,
 *   e resolver o mesmo conflito duas vezes não cria cópias em cascata.
 */
import { ehHlc, partesHlc } from './hlc.ts';
import { iguais, versoesDe, type Dados, type Registro, type VersoesDeCampo } from './modelo.ts';
import { logoDepois } from './ordem.ts';
import { idDeterministico } from './uuid.ts';

export interface EntradaMescla {
  /** O registro deste aparelho, com mudanças que o servidor ainda não tem. */
  local: Registro;
  /** O registro que o servidor tem. */
  servidor: Registro;
  /**
   * As versões de campo (`dados._v`) do registro do servidor que este aparelho conhecia quando
   * fez as mudanças (a "base comum"). `null` = o aparelho não conhecia nenhuma.
   */
  baseV: VersoesDeCampo | null;
}

export interface SaidaMescla {
  /** Os dados mesclados (chaves em ordem alfabética, `_v` por último). */
  dados: Dados;
  apagado: boolean;
  /** O resultado é igual ao do servidor: não há o que enviar; adota-se a versão do servidor. */
  igualAoServidor: boolean;
  /** A cópia de conflito a criar (se ainda não existir), ou `null`. */
  copia: Registro | null;
}

/** Os campos da cena que a cópia de conflito leva do registro que perdeu. */
const CAMPOS_DA_COPIA = ['capitulo', 'historia', 'palavras', 'status', 'texto', 'titulo'] as const;

const texto = (v: unknown): string => (typeof v === 'string' ? v : '');

/**
 * A lápide depois de juntar as versões: apagado só continua apagado se nenhum campo tiver versão
 * MAIOR que a da lápide.
 */
export function lapide(apagado: boolean, v: VersoesDeCampo): boolean {
  if (!apagado) return false;
  const va = v['apagado'] ?? '';
  for (const [campo, versao] of Object.entries(v)) if (campo !== 'apagado' && versao > va) return false;
  return true;
}

/** O id da cópia de conflito: depende só da cena e da versão do texto que perdeu. */
export function idDaCopia(cena: string, versaoDoTexto: string): string {
  return idDeterministico(partesHlc(versaoDoTexto).tempo, `ekfrase-writer:conflito:${cena}:${versaoDoTexto}`);
}

/** A cópia de conflito feita a partir do registro (uma cena) cujo texto perdeu. */
export function copiaDeConflito(perdedor: Registro): Registro {
  const v = versoesDe(perdedor.dados)['texto'] ?? perdedor.versao;
  const { tempo, aparelho } = partesHlc(v);
  const campos: Dados = {};
  for (const c of CAMPOS_DA_COPIA) if (perdedor.dados[c] !== undefined) campos[c] = perdedor.dados[c];
  campos['conflito_aparelho'] = aparelho;
  campos['conflito_de'] = perdedor.id;
  campos['conflito_em'] = tempo;
  campos['ordem'] = logoDepois(texto(perdedor.dados['ordem']));
  const dados = ordenar(campos, Object.fromEntries(Object.keys(campos).map((c) => [c, v])));
  return { id: idDaCopia(perdedor.id, v), colecao: 'cenas', versao: v, apagado: false, dados };
}

/** Chaves em ordem alfabética e `_v` (também ordenado) por último: a mesma saída em todo lugar. */
function ordenar(campos: Dados, v: VersoesDeCampo): Dados {
  const saida: Dados = {};
  for (const c of Object.keys(campos).sort()) saida[c] = campos[c];
  const vs: VersoesDeCampo = {};
  for (const c of Object.keys(v).sort()) vs[c] = v[c]!;
  saida['_v'] = vs;
  return saida;
}

/** Junta o registro local com o do servidor. Não mexe nas entradas. */
export function mesclar(e: EntradaMescla): SaidaMescla {
  const { local, servidor } = e;
  const vl = versoesDe(local.dados);
  const vs = versoesDe(servidor.dados);
  const campos: Dados = {};
  const v: VersoesDeCampo = {};

  const nomes = new Set([...Object.keys(local.dados), ...Object.keys(servidor.dados), ...Object.keys(vl), ...Object.keys(vs)]);
  nomes.delete('_v');
  nomes.delete('apagado');
  /** De que lado veio o valor de cada campo. */
  const lado: Record<string, 'local' | 'servidor'> = {};
  for (const campo of nomes) {
    const a = vl[campo] ?? '';
    const b = vs[campo] ?? '';
    // vence a versão maior; no empate o servidor, a não ser que só o local tenha o campo
    const doLocal = a > b || (a === b && servidor.dados[campo] === undefined);
    const origem = doLocal ? local : servidor;
    lado[campo] = doLocal ? 'local' : 'servidor';
    if (origem.dados[campo] !== undefined) campos[campo] = origem.dados[campo];
    const maior = a > b ? a : b;
    if (maior) v[campo] = maior;
  }

  let copia: Registro | null = null;
  if (local.colecao === 'cenas') {
    // `palavras` acompanha o texto que ficou
    const vencedor = lado['texto'] === 'local' ? local : servidor;
    if (lado['texto'] && vencedor.dados['palavras'] !== undefined) campos['palavras'] = vencedor.dados['palavras'];
    const tl = vl['texto'] ?? '';
    const ts = vs['texto'] ?? '';
    const tb = e.baseV?.['texto'] ?? '';
    const osDoisMudaram = tl !== ts && tl !== tb && ts !== tb;
    // dois textos escritos no MESMO aparelho não brigam: o mais novo foi escrito por cima do mais
    // antigo (é o que acontece quando a resposta de um envio se perde e a pessoa segue escrevendo)
    const mesmoAparelho = ehHlc(tl) && ehHlc(ts) && partesHlc(tl).aparelho === partesHlc(ts).aparelho;
    if (osDoisMudaram && !mesmoAparelho && texto(local.dados['texto']) !== texto(servidor.dados['texto'])) {
      const perdedor = lado['texto'] === 'local' ? servidor : local;
      // texto vazio ou de um registro que o próprio autor apagou não vira cópia
      if (!perdedor.apagado && texto(perdedor.dados['texto']).trim() !== '') copia = copiaDeConflito(perdedor);
    }
  }

  // a lápide: a versão maior de `apagado` decide; no empate, apagado
  const al = vl['apagado'] ?? '';
  const as = vs['apagado'] ?? '';
  const va = al > as ? al : as;
  if (va) v['apagado'] = va;
  const apagado = lapide(al > as ? local.apagado : as > al ? servidor.apagado : local.apagado || servidor.apagado, v);

  const dados = ordenar(campos, v);
  const igualAoServidor = apagado === servidor.apagado && iguais(v, vs) && iguais({ ...dados, _v: undefined }, { ...servidor.dados, _v: undefined });
  return { dados, apagado, igualAoServidor, copia };
}
