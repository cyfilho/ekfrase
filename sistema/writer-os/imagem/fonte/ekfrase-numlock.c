// SPDX-License-Identifier: MPL-2.0
/*
 * ekfrase-numlock: o Num Lock LIGADO em toda sessão do Writer OS (pedido do Alcy em 18/11/2026).
 *
 * O Cage não tem opção de Num Lock e começa cada sessão com ele desligado. Quando a casca avisa que a
 * janela apareceu (/run/ekfrase/sessao/pronta → ekfrase-numlock.path → ekfrase-numlock.service, root),
 * este programa:
 *   1. cria um teclado virtual por uinput ("Ekfrase Num Lock");
 *   2. espera o Cage abrir esse teclado (um processo "cage" com o /dev/input/eventN dele aberto). O Cage
 *      junta todos os teclados com o mesmo mapa num grupo do wlroots, e o grupo divide entre todos as
 *      travas (Num Lock, Caps Lock): apertar o Num Lock no virtual liga o do teclado de verdade;
 *   3. aperta e solta o Num Lock uma vez, confere a luz do Num Lock dos teclados de verdade (EVIOCGLED) e
 *      some com o teclado virtual.
 * Não lê tecla nenhuma: só escreve a dele e pergunta ao kernel o estado das luzes.
 *
 * Sai sempre com 0 (o Writer segue sem o Num Lock se algo faltar) e conta o que houve no journal e em
 * /run/ekfrase/sessao/numlock: "ligado", "desligado", "sem-teclado" (nenhum teclado com luzes), "sem-cage"
 * (o Cage não abriu o teclado virtual a tempo) ou "sem-uinput". O relato do teste (QEMU) lê esse arquivo.
 */
#include <dirent.h>
#include <fcntl.h>
#include <linux/input.h>
#include <linux/uinput.h>
#include <stdio.h>
#include <string.h>
#include <sys/ioctl.h>
#include <time.h>
#include <unistd.h>

#define ESTADO "/run/ekfrase/sessao/numlock"

static void contar(const char *estado, int antes) {
  printf("ekfrase-numlock: %s (antes: %d)\n", estado, antes);
  fflush(stdout);
  FILE *f = fopen(ESTADO ".tmp", "w");
  if (!f) return;
  fprintf(f, "%s\n", estado);
  if (fclose(f) == 0 && rename(ESTADO ".tmp", ESTADO) != 0) unlink(ESTADO ".tmp");
}

static void dormir(long ms) {
  struct timespec t = {ms / 1000, (ms % 1000) * 1000000L};
  nanosleep(&t, NULL);
}

static int emitir(int fd, unsigned short tipo, unsigned short codigo, int valor) {
  struct input_event ev;
  memset(&ev, 0, sizeof ev);
  ev.type = tipo;
  ev.code = codigo;
  ev.value = valor;
  return write(fd, &ev, sizeof ev) == (ssize_t)sizeof ev ? 0 : -1;
}

/* O nó eventN do teclado virtual (/sys/devices/virtual/input/<sysname>/eventN). */
static int achar_no(int fd, char *no, size_t tam) {
  char sys[64] = "";
  if (ioctl(fd, UI_GET_SYSNAME(sizeof sys), sys) < 0) return -1;
  sys[sizeof sys - 1] = 0;
  char pasta[128];
  snprintf(pasta, sizeof pasta, "/sys/devices/virtual/input/%.63s", sys);
  DIR *d = opendir(pasta);
  if (!d) return -1;
  int achou = -1;
  struct dirent *e;
  while ((e = readdir(d))) {
    if (strncmp(e->d_name, "event", 5) == 0) {
      snprintf(no, tam, "%.31s", e->d_name);
      achou = 0;
      break;
    }
  }
  closedir(d);
  return achou;
}

/* O Cage (pelo logind) já abriu /dev/input/<no>? Um processo "cage" com esse arquivo entre os abertos. */
static int cage_abriu(const char *no) {
  char alvo[64];
  snprintf(alvo, sizeof alvo, "/dev/input/%.31s", no);
  DIR *proc = opendir("/proc");
  if (!proc) return 0;
  int achou = 0;
  struct dirent *p;
  while (!achou && (p = readdir(proc))) {
    if (p->d_name[0] < '0' || p->d_name[0] > '9') continue;
    char caminho[64], nome[32] = "";
    snprintf(caminho, sizeof caminho, "/proc/%.20s/comm", p->d_name);
    FILE *c = fopen(caminho, "r");
    if (!c) continue;
    char *lido = fgets(nome, sizeof nome, c);
    fclose(c);
    if (!lido || strcmp(nome, "cage\n") != 0) continue;
    snprintf(caminho, sizeof caminho, "/proc/%.20s/fd", p->d_name);
    DIR *fds = opendir(caminho);
    if (!fds) continue;
    struct dirent *f;
    while ((f = readdir(fds))) {
      char link[128], destino[128];
      snprintf(link, sizeof link, "%s/%.40s", caminho, f->d_name);
      ssize_t n = readlink(link, destino, sizeof destino - 1);
      if (n <= 0) continue;
      destino[n] = 0;
      if (strcmp(destino, alvo) == 0) {
        achou = 1;
        break;
      }
    }
    closedir(fds);
  }
  closedir(proc);
  return achou;
}

/* A luz do Num Lock dos teclados de verdade (os /dev/input/event* com luzes, menos o virtual):
 * 1 = alguma acesa, 0 = todas apagadas, -1 = nenhum teclado com luzes. */
static int luz_dos_teclados(const char *meu) {
  DIR *d = opendir("/dev/input");
  if (!d) return -1;
  int r = -1;
  struct dirent *e;
  while ((e = readdir(d))) {
    if (strncmp(e->d_name, "event", 5) != 0 || strcmp(e->d_name, meu) == 0) continue;
    char caminho[64];
    snprintf(caminho, sizeof caminho, "/dev/input/%.40s", e->d_name);
    int f = open(caminho, O_RDONLY | O_NONBLOCK | O_CLOEXEC);
    if (f < 0) continue;
    unsigned char tipos[(EV_MAX + 8) / 8];
    unsigned char luzes[(LED_MAX + 8) / 8];
    memset(tipos, 0, sizeof tipos);
    memset(luzes, 0, sizeof luzes);
    if (ioctl(f, EVIOCGBIT(0, sizeof tipos), tipos) >= 0 && (tipos[EV_LED / 8] & (1 << (EV_LED % 8))) && ioctl(f, EVIOCGLED(sizeof luzes), luzes) >= 0) {
      if (luzes[LED_NUML / 8] & (1 << (LED_NUML % 8))) r = 1;
      else if (r < 0) r = 0;
    }
    close(f);
  }
  closedir(d);
  return r;
}

int main(void) {
  int fd = open("/dev/uinput", O_WRONLY | O_NONBLOCK | O_CLOEXEC);
  if (fd < 0) {
    contar("sem-uinput", -1);
    return 0;
  }
  /* um teclado comum (as teclas de 1 a 127): é o que o udev e o libinput tratam como teclado */
  int falhou = ioctl(fd, UI_SET_EVBIT, EV_KEY) < 0;
  for (int k = 1; k < 128 && !falhou; k++) falhou = ioctl(fd, UI_SET_KEYBIT, k) < 0;
  struct uinput_setup u;
  memset(&u, 0, sizeof u);
  u.id.bustype = BUS_VIRTUAL;
  u.id.vendor = 0x454b; /* "EK" */
  u.id.product = 0x0001;
  u.id.version = 1;
  snprintf(u.name, UINPUT_MAX_NAME_SIZE, "Ekfrase Num Lock");
  if (!falhou) falhou = ioctl(fd, UI_DEV_SETUP, &u) < 0 || ioctl(fd, UI_DEV_CREATE) < 0;
  if (falhou) {
    contar("sem-uinput", -1);
    close(fd);
    return 0;
  }

  /* até 20 s para o Cage abrir o teclado novo (o QEMU do CI, sem KVM, é lento) */
  char no[32] = "";
  int pronto = 0;
  for (int i = 0; i < 200 && !pronto; i++) {
    dormir(100);
    if (!no[0]) achar_no(fd, no, sizeof no);
    pronto = no[0] && cage_abriu(no);
  }
  if (!pronto) {
    contar("sem-cage", -1);
    ioctl(fd, UI_DEV_DESTROY);
    close(fd);
    return 0;
  }
  dormir(300); /* o wlroots põe o teclado no grupo logo depois de abrir */

  int antes = luz_dos_teclados(no);
  int ok = emitir(fd, EV_KEY, KEY_NUMLOCK, 1) == 0 && emitir(fd, EV_SYN, SYN_REPORT, 0) == 0;
  dormir(40);
  ok = emitir(fd, EV_KEY, KEY_NUMLOCK, 0) == 0 && emitir(fd, EV_SYN, SYN_REPORT, 0) == 0 && ok;

  /* a luz do Num Lock que o Cage acende em todos os teclados do grupo (até 2 s) */
  int depois = -1;
  for (int i = 0; i < 20; i++) {
    dormir(100);
    depois = luz_dos_teclados(no);
    if (depois == 1) break;
  }
  contar(!ok ? "sem-uinput" : depois == 1 ? "ligado" : depois == 0 ? "desligado" : "sem-teclado", antes);
  dormir(200);
  ioctl(fd, UI_DEV_DESTROY);
  close(fd);
  return 0;
}
