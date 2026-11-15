# SPDX-License-Identifier: MPL-2.0
"""
OS TESTES DO WRITER OS NO QEMU (PLANO §8). O CI roda (`.github/workflows/writer-os.yml`), com a
imagem de TESTE (a de entrega + o relato na serial e o agente de teste da casca).

    python3 tests/writer-os/qemu.py --imagem <ekfrase-writer-os-X-teste.img> --prints <pasta>

O pendrive de boot é um disco de 8 GB ligado como `usb-storage` (com -blockdev, para dar para tirar e
pôr de volta), ao lado de um 2º pendrive USB (FAT, rótulo OUTRO) e de um disco virtio "interno". O
roteiro lê a serial (linhas "EKFRASE …"), digita pelo QMP (send-key) e tira prints (screendump).

Com o Secure Boot LIGADO (OVMF com as chaves da Microsoft, como o notebook do Alcy, §10c):
  1. a partição de dados foi criada (e montada em /dados);
  2. o writer não tem sudo: nenhum su/sudo/pkexec/login/getty/apt/dpkg, nenhum SUID, os grupos só
     "writer", o root trancado e sem shell, e o Secure Boot ligado de verdade;
  3. o app abre: o primeiro uso (idioma → teclado → fuso, só com Enter) chega na senha nova;
  4. escrever → reiniciar (system_reset) → a senha → o texto está lá;
  e o de ARRANCAR: com o agente gravando em laço, depois de 20 gravações o pendrive sai (device_del),
  volta (device_add) e o computador reinicia: o banco abre, o integrity_check dá ok e a última
  gravação que a serial contou está lá. Mais: o OUTRO monta (usb ok) e o interno não (interno negado).
Com o Secure Boot DESLIGADO: liga e chega no primeiro uso.
"""
import argparse
import json
import os
import re
import shutil
import socket
import subprocess
import sys
import tempfile
import time

OVMF = '/usr/share/OVMF'
SENHA = 'escrever2026'
falhas = []


def ok(cond, msg):
    print(('ok  ' if cond else 'XX  ') + msg, flush=True)
    if not cond:
        falhas.append(msg)
    return cond


class Qemu:
    def dispositivo_boot(self):
        """O disco de boot: USB (o pendrive de verdade) no setor 512; NVMe no de 4096. Em 14/11/2026 o CI mostrou que
        o OVMF do QEMU não liga NENHUM disco USB de setor 4096, nem um feito do zero pelo mkfs.vfat -S 4096 (Boot0001
        "Not Found"), e que o mesmo disco do Gravador liga por NVMe e virtio-blk (Secure Boot ligado, app abre).
        Então o defeito é do USB 4096 emulado, não do disco. EKFRASE_QEMU_BARRAMENTO=usb|nvme|virtio força um."""
        tam = f',logical_block_size={self.setor},physical_block_size={self.setor}' if self.setor != 512 else ''
        bus = os.environ.get('EKFRASE_QEMU_BARRAMENTO', 'nvme' if self.setor == 4096 else 'usb')
        if bus == 'nvme':
            return 'nvme,drive=boot,serial=ekfrase,bootindex=1' + tam
        if bus == 'virtio':
            return 'virtio-blk-pci,drive=boot,bootindex=1' + tam
        return 'usb-storage,bus=xhci.0,drive=boot,id=pendrive,bootindex=1' + tam

    def __init__(self, imagem, pasta, secure, nome, disco_pronto=None, setor=512, gpu=False):
        self.pasta = pasta
        self.nome = nome
        self.secure = secure
        self.setor = setor
        self.gpu = gpu
        os.makedirs(pasta, exist_ok=True)
        self.trab = tempfile.mkdtemp(prefix=f'ekfrase-qemu-{nome}-')
        if disco_pronto:
            # um disco que o Gravador já gravou (tests/gravador/disco-virtual.ts)
            self.disco = disco_pronto
        else:
            self.disco = os.path.join(self.trab, 'pendrive.img')
            shutil.copyfile(imagem, self.disco)
            with open(self.disco, 'r+b') as f:
                f.truncate(8 * 1024 ** 3)
        self.outro = os.path.join(self.trab, 'outro.img')
        self.interno = os.path.join(self.trab, 'interno.img')
        subprocess.run(['mkfs.vfat', '-C', '-n', 'OUTRO', self.outro, '65536'], check=True, stdout=subprocess.DEVNULL)
        subprocess.run(['mkfs.vfat', '-C', '-n', 'INTERNO', self.interno, '65536'], check=True, stdout=subprocess.DEVNULL)
        self.vars = os.path.join(self.trab, 'vars.fd')
        shutil.copyfile(os.path.join(OVMF, 'OVMF_VARS_4M.ms.fd' if secure else 'OVMF_VARS_4M.fd'), self.vars)
        self.serial = os.path.join(pasta, f'serial-{nome}.log')
        self.sock = os.path.join(self.trab, 'qmp.sock')
        self.proc = None
        self.qmp_s = None
        self.buf = b''
        self.n_print = 0

    def telas(self):
        """O vídeo: sem GPU, o virtio-vga (a sessão de teste usa o pixman). Com --gpu, o virtio-vga-gl (virgl: o Mesa do
        computador que roda o QEMU faz a GPU, por software no CI) e a imagem sabe pelo fw_cfg que NÃO deve forçar o pixman.
        O egl-headless precisa de um /dev/dri/renderD* no computador; sem ele, o sdl com gl numa tela virtual (xvfb-run).
        EKFRASE_QEMU_TELA força uma."""
        if not self.gpu:
            return [['-device', 'virtio-vga', '-display', 'none']]
        sinal = ['-fw_cfg', 'name=opt/ekfrase/gpu,string=1', '-device', 'virtio-vga-gl']
        opcoes = [os.environ['EKFRASE_QEMU_TELA']] if os.environ.get('EKFRASE_QEMU_TELA') else ['egl-headless', 'sdl,gl=on', 'gtk,gl=on']
        return [sinal + ['-display', t] for t in opcoes]

    def ligar(self):
        codigo = os.path.join(OVMF, 'OVMF_CODE_4M.secboot.fd' if self.secure else 'OVMF_CODE_4M.fd')
        kvm = os.access('/dev/kvm', os.R_OK | os.W_OK)
        for tela in self.telas():
            if self._ligar(codigo, kvm, tela):
                return
        raise RuntimeError(f'{self.nome}: o QEMU não ligou com nenhuma tela (ver {self.pasta}/qemu-{self.nome}.log)')

    def _ligar(self, codigo, kvm, tela):
        cmd = [
            'qemu-system-x86_64', '-name', 'ekfrase-writer-os',
            '-machine', f'q35,smm=on,accel={"kvm" if kvm else "tcg"}',
            '-cpu', 'host' if kvm else 'max', '-m', '3072', '-smp', '2',
            '-global', 'driver=cfi.pflash01,property=secure,value=on',
            '-drive', f'if=pflash,format=raw,unit=0,file={codigo},readonly=on',
            '-drive', f'if=pflash,format=raw,unit=1,file={self.vars}',
            '-device', 'qemu-xhci,id=xhci',
            '-blockdev', f'driver=file,filename={self.disco},node-name=boot-arquivo',
            '-blockdev', 'driver=raw,file=boot-arquivo,node-name=boot',
            '-device', self.dispositivo_boot(),
            '-blockdev', f'driver=file,filename={self.outro},node-name=outro-arquivo',
            '-blockdev', 'driver=raw,file=outro-arquivo,node-name=outro',
            '-device', 'usb-storage,bus=xhci.0,drive=outro,id=outro',
            '-drive', f'file={self.interno},if=virtio,format=raw',
            *tela, '-nic', 'none',
            '-serial', f'file:{self.serial}',
            '-qmp', f'unix:{self.sock},server=on,wait=off',
        ]
        print(f'-- QEMU ({self.nome}; {"KVM" if kvm else "SEM KVM: lento"}; Secure Boot {"ligado" if self.secure else "desligado"}; {" ".join(tela[-3:])})', flush=True)
        if os.path.exists(self.sock):
            os.remove(self.sock)
        log = open(os.path.join(self.pasta, f'qemu-{self.nome}.log'), 'a')
        self.proc = subprocess.Popen(cmd, stderr=log, stdout=log)
        time.sleep(3)
        if self.proc.poll() is not None:
            log.flush()
            with open(log.name, encoding='utf-8', errors='replace') as f:
                print('   o QEMU não ligou assim: ' + ' | '.join(f.read().strip().splitlines()[-3:]), flush=True)
            return False
        for _ in range(100):
            try:
                self.qmp_s = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
                self.qmp_s.connect(self.sock)
                break
            except OSError:
                time.sleep(0.2)
        self._ler()  # a saudação
        self.qmp('qmp_capabilities')
        return True

    def fotos_do_boot(self, tempo=60):
        """A tela do boot (o Plymouth com a cara Ekfrase, PLANO §6.3): um print a cada 1,5 s até a serial dizer "boot"."""
        fim = time.time() + tempo
        n = 0
        while time.time() < fim and n < 14 and 'boot' not in self.linhas():
            time.sleep(1.5)
            self.foto(f'plymouth-{n:02d}')
            n += 1

    def _ler(self):
        while b'\n' not in self.buf:
            parte = self.qmp_s.recv(65536)
            if not parte:
                raise RuntimeError('o QMP fechou')
            self.buf += parte
        linha, self.buf = self.buf.split(b'\n', 1)
        return json.loads(linha)

    def qmp(self, comando, **args):
        self.qmp_s.sendall(json.dumps({'execute': comando, 'arguments': args} if args else {'execute': comando}).encode() + b'\n')
        while True:
            r = self._ler()
            if 'return' in r:
                return r['return']
            if 'error' in r:
                raise RuntimeError(f'{comando}: {r["error"]}')

    def tecla(self, *codigos):
        self.qmp('send-key', keys=[{'type': 'qcode', 'data': c} for c in codigos], **{'hold-time': 80})
        time.sleep(0.12)

    def digitar(self, texto):
        for c in texto:
            self.tecla({' ': 'spc'}.get(c, c))

    def foto(self, nome):
        self.n_print += 1
        destino = os.path.join(self.pasta, f'{self.nome}-{self.n_print:02d}-{nome}.png')
        try:
            self.qmp('screendump', filename=destino, format='png')
        except RuntimeError as e:
            print(f'   (sem print: {e})')

    def linhas(self):
        try:
            with open(self.serial, 'rb') as f:
                bruto = f.read().decode('utf-8', 'replace')
        except FileNotFoundError:
            return []
        return [l[len('EKFRASE '):].strip() for l in bruto.splitlines() if l.startswith('EKFRASE ')]

    def esperar(self, alvo, desde=0, tempo=180):
        """Espera uma linha da serial (texto exato ou regex) depois da linha `desde`. Devolve o índice ou None."""
        fim = time.time() + tempo
        while time.time() < fim:
            ls = self.linhas()
            for i in range(desde, len(ls)):
                if (ls[i] == alvo) if isinstance(alvo, str) else alvo.search(ls[i]):
                    return i
            if self.proc.poll() is not None:
                return None
            time.sleep(0.5)
        return None

    def boot(self, desde=0, tempo=300):
        i = self.esperar('boot', desde, tempo)
        ok(i is not None, f'{self.nome}: o sistema ligou (a serial disse "boot")')
        return i if i is not None else len(self.linhas())

    def tela(self, teste, desde, tempo=180):
        i = self.esperar(f'tela {teste}', desde, tempo)
        ok(i is not None, f'{self.nome}: a tela "{teste}" abriu')
        if i is not None:
            time.sleep(1.5)  # o foco chega na opção padrão
        return i

    def desligar(self):
        try:
            self.qmp('quit')
        except Exception:
            pass
        if self.proc:
            try:
                self.proc.wait(20)
            except subprocess.TimeoutExpired:
                self.proc.kill()
        shutil.rmtree(self.trab, ignore_errors=True)


def gravados(ls, desde):
    return [int(m.group(1)) for l in ls[desde:] if (m := re.fullmatch(r'gravado (\d+)', l))]


def teste_completo(imagem, pasta):
    q = Qemu(imagem, pasta, secure=True, nome='sb-ligado')
    q.ligar()
    try:
        # ---------- boot 1: os testes 1, 2 e 3, e o primeiro uso ----------
        q.fotos_do_boot()
        b = q.boot()
        q.foto('boot')
        ok(q.esperar(re.compile(r'^particao ok '), b, 60) is not None, '1. a partição de dados foi criada e montada')
        conf = q.esperar('binarios conferidos', b, 60)
        ls = q.linhas()
        do_boot = ls[b:conf] if conf is not None else ls[b:]
        ok(conf is not None and not [l for l in do_boot if l.startswith('sobrou ')], '2. nenhum sudo, su, doas, pkexec, login, getty, apt, dpkg: ' + ', '.join(l for l in do_boot if l.startswith('sobrou ')))
        ok(not [l for l in do_boot if l.startswith('suid ')], '2. nenhum programa SUID: ' + ', '.join(l for l in do_boot if l.startswith('suid ')))
        ok(q.esperar('grupos writer', b, 30) is not None, '2. o writer só está no grupo dele (sem sudo, wheel, adm, disk)')
        ok(q.esperar('shell-root /usr/sbin/nologin', b, 30) is not None, '2. o root não tem shell')
        ok(q.esperar('root L', b, 30) is not None, '2. a senha do root está trancada')
        ok(q.esperar('secureboot 1', b, 30) is not None, '2. o Secure Boot está LIGADO (shim e GRUB do Debian passaram)')

        for teste in ['os-idioma', 'os-teclado', 'os-fuso']:
            if q.tela(teste, b, 240) is None:
                q.foto(f'sem-{teste}')
                return
            q.foto(teste)
            q.tecla('ret')
        if q.tela('casca-criar-senha', b, 60) is None:
            q.foto('sem-senha')
            return
        ok(True, '3. o app abre (a senha nova do primeiro uso)')
        q.foto('senha')
        q.digitar(SENHA)
        q.tecla('tab')
        q.digitar(SENHA)
        q.tecla('ret')
        for teste in ['casca-espelho', 'os-wifi']:
            if q.tela(teste, b, 60) is not None:
                q.foto(teste)
                q.tecla('ret')
        ok(q.esperar('texto falta', b, 60) is not None, 'no primeiro boot, o texto de teste ainda não existe')
        ok(q.esperar('usb ok', b, 60) is not None, 'o 2º pendrive (OUTRO) monta e aceita um arquivo')
        ok(q.esperar('interno negado', b, 60) is not None, 'o disco interno (virtio) NÃO monta')
        ok(q.esperar('gravado 5', b, 60) is not None, 'o agente grava')
        ok(q.esperar('diagnostico ok', b, 240) is not None, 'o diagnóstico foi gravado na EKFRASE-DADOS (Ekfrase Writer/.diagnostico)')
        ok(q.esperar('quedas 0', b, 5) is not None, 'a sessão não caiu nenhuma vez')
        time.sleep(2)
        q.foto('conta')

        # ---------- boot 2: o teste 4 (escrever → reiniciar → o texto está lá) ----------
        q.qmp('system_reset')
        b = q.boot(b + 1)
        if q.tela('casca-abrir', b, 240) is None:
            q.foto('sem-abrir')
            return
        q.foto('senha-de-novo')
        q.digitar(SENHA)
        q.tecla('ret')
        ok(q.esperar('texto ok', b, 60) is not None, '4. escrever → reiniciar → a senha → o texto está lá')
        ok(q.esperar('integridade ok', b, 60) is not None, '4. o banco está íntegro')

        # ---------- arrancar o pendrive no meio de uma gravação ----------
        inicio = len(q.linhas())
        fim = time.time() + 60
        while time.time() < fim and len(gravados(q.linhas(), inicio)) < 20:
            time.sleep(0.3)
        ok(len(gravados(q.linhas(), inicio)) >= 20, 'o agente gravou 20 vezes antes de arrancar o pendrive')
        q.qmp('device_del', id='pendrive')
        time.sleep(4)
        contados = gravados(q.linhas(), inicio)
        ultimo_contado = max(contados) if contados else 0
        print(f'   o pendrive saiu; a última gravação contada foi a {ultimo_contado}')
        q.qmp('device_add', driver='usb-storage', bus='xhci.0', drive='boot', id='pendrive', bootindex=1)
        time.sleep(2)
        q.qmp('system_reset')

        b = q.boot(len(q.linhas()))
        if q.tela('casca-abrir', b, 240) is None:
            q.foto('sem-abrir-depois-de-arrancar')
            return
        q.digitar(SENHA)
        q.tecla('ret')
        ok(q.esperar('texto ok', b, 60) is not None, 'arrancar: o banco abre e o texto está lá')
        ok(q.esperar('integridade ok', b, 60) is not None, 'arrancar: integrity_check = ok')
        i = q.esperar(re.compile(r'^ultimo \d+$'), b, 30)
        ultimo = int(q.linhas()[i].split()[1]) if i is not None else -1
        ok(ultimo >= ultimo_contado, f'arrancar: a última gravação contada ({ultimo_contado}) está no banco (lá: {ultimo})')
        time.sleep(3)
        q.foto('depois-de-arrancar')
    finally:
        q.desligar()


def teste_sem_secure_boot(imagem, pasta):
    q = Qemu(imagem, pasta, secure=False, nome='sb-desligado')
    q.ligar()
    try:
        b = q.boot()
        ok(q.esperar(re.compile(r'^secureboot (0|\?)$'), b, 60) is not None, 'sem Secure Boot: o firmware diz desligado')
        if q.tela('os-idioma', b, 240) is not None:
            ok(True, 'sem Secure Boot: o app abre no primeiro uso')
            q.foto('idioma')
    finally:
        q.desligar()


def teste_gpu(imagem, pasta):
    """A PLACA DE VÍDEO (15/11/2026: a tela preta no notebook). O teste comum força o pixman (sem GPU) e não via que faltava
    o EGL do Mesa. Aqui a máquina tem GPU (virtio-vga-gl, virgl) e a sessão NÃO força o pixman: o Cage tem de abrir com o
    EGL do Mesa (libEGL_mesa carregada no processo dele), sem cair, e a casca tem de chegar no primeiro uso."""
    q = Qemu(imagem, pasta, secure=True, nome='gpu', gpu=True)
    q.ligar()
    try:
        q.fotos_do_boot()
        b = q.boot()
        ok(q.esperar('gpu pedido', b, 30) is not None, 'gpu: a imagem soube pelo fw_cfg que é o teste da placa de vídeo')
        if q.tela('os-idioma', b, 300) is not None:
            ok(True, 'gpu: o app abre no primeiro uso, desenhado pela placa de vídeo')
            q.foto('idioma')
        else:
            q.foto('sem-idioma')
        i = q.esperar(re.compile(r'^cage '), b, 120)
        ok(i is not None and q.linhas()[i] == 'cage egl-mesa', f'gpu: o Cage abriu com o EGL do Mesa ({q.linhas()[i] if i is not None else "sem resposta"})')
        i = q.esperar(re.compile(r'^renderer '), b, 10)
        ok(i is not None and q.linhas()[i] == 'renderer auto', f'gpu: sem cair para o pixman ({q.linhas()[i] if i is not None else "sem resposta"})')
        i = q.esperar(re.compile(r'^quedas '), b, 10)
        ok(i is not None and q.linhas()[i] == 'quedas 0', f'gpu: o Cage não caiu ({q.linhas()[i] if i is not None else "sem resposta"})')
        ok(q.esperar('diagnostico ok', b, 240) is not None, 'gpu: o diagnóstico foi gravado')
    finally:
        q.desligar()


def teste_disco_4k(disco, pasta):
    """O disco de setor 4096 que o Gravador montou (PLANO §6.1b, item 2): liga com Secure Boot e abre o app."""
    q = Qemu(None, pasta, secure=True, nome='disco-4k', disco_pronto=disco, setor=4096)
    q.ligar()
    try:
        b = q.boot()
        # Sem "a EKFRASE-DADOS monta": o ekfrase-dados.sh só age em disco USB (motivo "nao-usb"), e o disco de 4096
        # liga por NVMe (ver dispositivo_boot). A EKFRASE-DADOS em 4096 é conferida por tests/gravador/disco-virtual.ts.
        ok(q.esperar('secureboot 1', b, 30) is not None, 'disco 4096: com o Secure Boot LIGADO')
        if q.tela('os-idioma', b, 240) is not None:
            ok(True, 'disco 4096: o app abre no primeiro uso')
            q.foto('idioma')
        else:
            q.foto('sem-idioma')
    finally:
        q.desligar()


def main():
    a = argparse.ArgumentParser()
    a.add_argument('--imagem')
    a.add_argument('--prints', default='prints-writer-os')
    a.add_argument('--disco-4k', help='só o boot de um disco de setor 4096 já gravado pelo Gravador')
    a.add_argument('--gpu', action='store_true', help='só o teste da placa de vídeo (virtio-vga-gl; rodar com xvfb-run)')
    args = a.parse_args()
    if args.gpu:
        teste_gpu(args.imagem, args.prints)
    elif args.disco_4k:
        teste_disco_4k(args.disco_4k, args.prints)
    else:
        teste_completo(args.imagem, args.prints)
        teste_sem_secure_boot(args.imagem, args.prints)
    print()
    if falhas:
        print(f'{len(falhas)} falha(s):')
        for f in falhas:
            print(f'  - {f}')
        sys.exit(1)
    print('Writer OS no QEMU: tudo certo.')


if __name__ == '__main__':
    main()
