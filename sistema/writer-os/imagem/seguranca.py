# SPDX-License-Identifier: MPL-2.0
"""
O AVISO DE SEGURANÇA do Writer OS (Bloco F, item 1; 25/11/2026).

O Writer OS não tem `apt`: toda correção de segurança chega só numa imagem nova. Toda semana (e quando alguém
roda o workflow `writer-os-seguranca.yml`), este script confere a última imagem ESTÁVEL publicada:

  1. o Debian: a lista dos pacotes da imagem (`ekfrase-writer-os-<v>.pacotes.tsv`, que o `montar.sh` grava e o
     Release leva) contra o `trixie-security` (os alertas DSA) e o `trixie` + `trixie-updates` (as correções da
     versão de ponto), pelo pacote-FONTE (o kernel troca de nome a cada correção; a fonte `linux`, não);
  2. o Electron da casca daquela versão contra o npm: há versão mais nova da MESMA série (as correções do
     Chromium saem assim), ou a série saiu do suporte (o Electron cuida das 3 séries mais novas);
  3. a idade: a imagem tem 30 dias ou mais.

Se algo pede imagem nova, abre (ou atualiza) UM aviso no GitHub com o rótulo `seguranca-writer-os`, com a lista e a
linha pronta para colar num chat; se nada falta, fecha o aviso aberto. Nada é montado nem publicado sozinho: a
versão nova sai pela tag, depois de um chat ver (decisão do Alcy, 25/11/2026).

Rodar: python3 sistema/writer-os/imagem/seguranca.py [--repo dono/nome] [--sem-aviso] [--testar]
Precisa do `gh` (com GH_TOKEN no CI) e de internet (deb.debian.org e registry.npmjs.org).
"""
import argparse
import base64
import datetime as dt
import json
import lzma
import os
import re
import subprocess
import sys
import urllib.request

ROTULO = 'seguranca-writer-os'
TITULO = 'Writer OS: correção de segurança pendente (imagem nova)'
DIAS = 30
SERIES_COM_SUPORTE = 3
COMPONENTES = ['main', 'contrib', 'non-free-firmware']
SUITES = {
    'seguranca': 'https://deb.debian.org/debian-security/dists/trixie-security/{c}/binary-amd64/Packages.xz',
    'atualizacao': 'https://deb.debian.org/debian/dists/trixie-updates/{c}/binary-amd64/Packages.xz',
    'ponto': 'https://deb.debian.org/debian/dists/trixie/{c}/binary-amd64/Packages.xz',
}
AGENTE = 'ekfrase-writer-os-seguranca/1'


# ---------- as versões do Debian (a ordem do dpkg, Debian Policy §5.6.12) ----------

def _ordem(c):
    if c == '~':
        return -1
    if c.isalpha():
        return ord(c)
    return ord(c) + 256


def _parte(a, b):
    """Compara upstream ou revisão: trechos de não-dígitos (com ~ antes de tudo) e de dígitos, alternados."""
    while a or b:
        na = re.match(r'^[^0-9]*', a).group(0)
        nb = re.match(r'^[^0-9]*', b).group(0)
        a, b = a[len(na):], b[len(nb):]
        for i in range(max(len(na), len(nb))):
            ca = _ordem(na[i]) if i < len(na) else 0
            cb = _ordem(nb[i]) if i < len(nb) else 0
            if ca != cb:
                return -1 if ca < cb else 1
        da = re.match(r'^[0-9]*', a).group(0)
        db = re.match(r'^[0-9]*', b).group(0)
        a, b = a[len(da):], b[len(db):]
        ia, ib = int(da or 0), int(db or 0)
        if ia != ib:
            return -1 if ia < ib else 1
    return 0


def comparar(a, b):
    """-1, 0 ou 1, como `dpkg --compare-versions`."""
    def partes(v):
        epoca, _, resto = v.partition(':') if ':' in v else ('0', '', v)
        upstream, _, revisao = resto.rpartition('-') if '-' in resto else (resto, '', '0')
        return int(epoca or 0), upstream, revisao
    ea, ua, ra = partes(a)
    eb, ub, rb = partes(b)
    if ea != eb:
        return -1 if ea < eb else 1
    return _parte(ua, ub) or _parte(ra, rb)


def testar():
    casos = [('1.0', '1.0', 0), ('1.0', '1.1', -1), ('1.0~rc1', '1.0', -1), ('1:0.1', '2.0', 1), ('1.0-1', '1.0-1+deb13u1', -1),
             ('6.12.48-1', '6.12.57-1', -1), ('3.5.4-1~deb13u1', '3.5.4-1', -1), ('2.41-12', '2.41-12+deb13u1', -1),
             ('1.2.3', '1.2.3-0', 0), ('10', '9', 1), ('1.0a', '1.0', 1), ('1.0+', '1.0', 1)]
    for a, b, r in casos:
        assert comparar(a, b) == r, (a, b, comparar(a, b), r)
        assert comparar(b, a) == -r, (b, a)
    print('ok: as versões do Debian comparam como o dpkg')


# ---------- buscar ----------

def baixar(url, cabecalhos=None):
    req = urllib.request.Request(url, headers={'User-Agent': AGENTE, **(cabecalhos or {})})
    with urllib.request.urlopen(req, timeout=120) as r:
        return r.read()


def gh(*args):
    return subprocess.run(['gh', *args], check=True, capture_output=True, text=True).stdout


def fontes_do_indice(texto):
    """Packages → {pacote-fonte: a maior versão da fonte no índice}."""
    maior = {}
    for estrofe in texto.split('\n\n'):
        campos = {}
        for linha in estrofe.splitlines():
            if linha[:1] in (' ', '\t') or ':' not in linha:
                continue
            k, _, v = linha.partition(':')
            campos[k] = v.strip()
        if 'Package' not in campos or 'Version' not in campos:
            continue
        fonte, versao = campos['Package'], campos['Version']
        if 'Source' in campos:
            m = re.match(r'^(\S+)(?:\s+\((\S+)\))?$', campos['Source'])
            if m:
                fonte = m.group(1)
                versao = m.group(2) or versao
        if fonte not in maior or comparar(versao, maior[fonte]) > 0:
            maior[fonte] = versao
    return maior


def ultima_estavel(repo):
    lista = json.loads(gh('release', 'list', '-R', repo, '--exclude-pre-releases', '--limit', '100', '--json', 'tagName,publishedAt'))
    estaveis = [r for r in lista if r['tagName'].startswith('writer-os-v') and '-teste.' not in r['tagName']]
    if not estaveis:
        return None
    return max(estaveis, key=lambda r: r['publishedAt'])


def pacotes_da_imagem(repo, tag, versao, pasta, arquivo=None):
    nome = f'ekfrase-writer-os-{versao}.pacotes.tsv'
    if not arquivo:
        r = subprocess.run(['gh', 'release', 'download', tag, '-R', repo, '-p', nome, '-D', pasta, '--clobber'], capture_output=True, text=True)
        if r.returncode != 0:
            return None
        arquivo = os.path.join(pasta, nome)
    fontes = {}
    with open(arquivo, encoding='utf-8') as f:
        for linha in f:
            c = linha.rstrip('\n').split('\t')
            if len(c) >= 4 and c[2]:
                fontes[c[2]] = c[3]
    return fontes


def electron_da_versao(repo, tag):
    j = json.loads(gh('api', f'repos/{repo}/contents/sistema/writer-os/casca/package.json?ref={tag}'))
    pacote = json.loads(base64.b64decode(j['content']))
    return pacote.get('devDependencies', {}).get('electron') or pacote.get('dependencies', {}).get('electron')


def electron_no_npm():
    j = json.loads(baixar('https://registry.npmjs.org/electron', {'Accept': 'application/vnd.npm.install-v1+json'}))
    return [v for v in j['versions'] if re.fullmatch(r'\d+\.\d+\.\d+', v)]


def numeros(v):
    return tuple(int(x) for x in v.split('.'))


# ---------- o aviso ----------

def proxima(versao):
    a, b, c = numeros(versao)
    return f'{a}.{b}.{c + 1}'


def montar_texto(versao, tag, publicada, idade, seguranca, outras, electron, sem_lista):
    linhas = [f'A última imagem estável do Writer OS é a **{versao}** (`{tag}`, publicada em {publicada:%d/%m/%Y}, há {idade} dias).', '']
    motivos = []
    if sem_lista:
        motivos.append('a imagem é de antes da lista de pacotes (Bloco F): sem ela não dá para conferir o Debian; a próxima já leva')
    if seguranca:
        motivos.append(f'{len(seguranca)} pacote(s) com **alerta de segurança do Debian** (DSA)')
    if electron:
        motivos.append(electron)
    if idade >= DIAS:
        motivos.append(f'a imagem tem {idade} dias (a rotina é uma imagem nova pelo menos a cada {DIAS})')
    linhas += ['**Por que fazer uma imagem nova:**', ''] + [f'- {m}' for m in motivos] + ['']
    if seguranca:
        linhas += ['**Correções de segurança do Debian (trixie-security) que a imagem não tem:**', '', '| pacote-fonte | na imagem | corrigido |', '|---|---|---|']
        linhas += [f'| `{f}` | {a} | {n} |' for f, a, n in seguranca] + ['']
    if outras:
        linhas += [f'Também entram {len(outras)} correção(ões) da versão de ponto do Debian (trixie e trixie-updates): '
                   + ', '.join(f'`{f}`' for f, _, _ in outras[:40]) + (' …' if len(outras) > 40 else ''), '']
    nova = proxima(versao)
    extra = ' Antes, suba o Electron da casca (o aviso acima diz para qual).' if electron else ''
    linhas += [
        '**O que fazer:** a imagem nova sai pela tag, e toda imagem montada agora já pega as correções. Cole num chat:', '',
        '```',
        f'Leia o CLAUDE.md e sistema/writer-os/imagem/CLAUDE.md (a rotina de segurança). Saiu o aviso de segurança do Writer OS: '
        f'faça a versão {nova} (casca, Gravador e Writer OS), espelho, Merge no público e as tags writer-os-v{nova} e writer-v{nova}.{extra}',
        '```', '',
        '_Este aviso é do workflow `writer-os-seguranca.yml` (toda segunda-feira). Ele se fecha sozinho quando a imagem nova sair._',
    ]
    return '\n'.join(linhas), motivos


def aviso_aberto(repo):
    lista = json.loads(gh('issue', 'list', '-R', repo, '--label', ROTULO, '--state', 'open', '--json', 'number', '--limit', '5'))
    return lista[0]['number'] if lista else None


def publicar_aviso(repo, texto):
    subprocess.run(['gh', 'label', 'create', ROTULO, '-R', repo, '--color', 'B60205', '--description', 'Writer OS: imagem nova pendente', '--force'], check=True, capture_output=True)
    n = aviso_aberto(repo)
    if n:
        gh('issue', 'edit', str(n), '-R', repo, '--body', texto)
        print(f'aviso #{n} atualizado')
    else:
        print(gh('issue', 'create', '-R', repo, '--title', TITULO, '--label', ROTULO, '--body', texto).strip())


def fechar_aviso(repo, versao):
    n = aviso_aberto(repo)
    if n:
        gh('issue', 'close', str(n), '-R', repo, '--comment', f'A imagem {versao} está em dia: nada pendente.')
        print(f'aviso #{n} fechado')


def main():
    p = argparse.ArgumentParser()
    p.add_argument('--repo', default=os.environ.get('GITHUB_REPOSITORY', 'cyfilho/ekfrase'))
    p.add_argument('--sem-aviso', action='store_true', help='só mostra o relatório (não abre nem fecha o aviso)')
    p.add_argument('--testar', action='store_true')
    p.add_argument('--pacotes', help='uma lista de pacotes local no lugar da do Release (para conferir o script)')
    a = p.parse_args()
    testar()
    if a.testar:
        return 0

    r = ultima_estavel(a.repo)
    if r is None:
        print('nenhum Release estável do Writer OS ainda')
        return 0
    tag = r['tagName']
    versao = tag.removeprefix('writer-os-v')
    publicada = dt.datetime.fromisoformat(r['publishedAt'].replace('Z', '+00:00'))
    idade = (dt.datetime.now(dt.timezone.utc) - publicada).days

    pasta = os.environ.get('RUNNER_TEMP') or os.path.join(os.path.dirname(os.path.abspath(__file__)), 'saida')
    os.makedirs(pasta, exist_ok=True)
    nossos = pacotes_da_imagem(a.repo, tag, versao, pasta, a.pacotes)

    seguranca, outras = [], []
    if nossos:
        vistos = set()
        for suite in ['seguranca', 'atualizacao', 'ponto']:
            indice = {}
            for c in COMPONENTES:
                for f, v in fontes_do_indice(lzma.decompress(baixar(SUITES[suite].format(c=c))).decode('utf-8', 'replace')).items():
                    if f not in indice or comparar(v, indice[f]) > 0:
                        indice[f] = v
            for fonte, nossa in sorted(nossos.items()):
                if fonte in vistos or fonte not in indice or comparar(indice[fonte], nossa) <= 0:
                    continue
                vistos.add(fonte)
                (seguranca if suite == 'seguranca' else outras).append((fonte, nossa, indice[fonte]))

    electron = None
    nossa_e = electron_da_versao(a.repo, tag)
    if nossa_e and re.fullmatch(r'\d+\.\d+\.\d+', nossa_e):
        npm = electron_no_npm()
        serie = numeros(nossa_e)[0]
        da_serie = max((v for v in npm if numeros(v)[0] == serie), key=numeros, default=nossa_e)
        mais_nova = max(numeros(v)[0] for v in npm)
        if serie <= mais_nova - SERIES_COM_SUPORTE:
            electron = f'o **Electron {nossa_e}** saiu do suporte (a série {serie}; o Electron cuida da {mais_nova - SERIES_COM_SUPORTE + 1} à {mais_nova}): suba para a série {mais_nova}'
        elif numeros(da_serie) > numeros(nossa_e):
            electron = f'o **Electron** tem correção: {nossa_e} → **{da_serie}** (mesma série)'

    texto, motivos = montar_texto(versao, tag, publicada, idade, seguranca, outras, electron, nossos is None)
    pendente = bool(seguranca or electron or idade >= DIAS or nossos is None)
    resumo = texto if pendente else f'A imagem {versao} está em dia (Debian, Electron {nossa_e}, {idade} dias).'
    print(resumo)
    if os.environ.get('GITHUB_STEP_SUMMARY'):
        with open(os.environ['GITHUB_STEP_SUMMARY'], 'a', encoding='utf-8') as f:
            f.write(resumo + '\n')
    for m in motivos if pendente else []:
        print(f'::warning title=Writer OS: imagem nova pendente::{re.sub(r"[*`]", "", m)}')
    if not a.sem_aviso:
        (publicar_aviso(a.repo, texto) if pendente else fechar_aviso(a.repo, versao))
    return 0


if __name__ == '__main__':
    sys.exit(main())
