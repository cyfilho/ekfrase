// SPDX-License-Identifier: MPL-2.0

/**
 * A bateria ao lado da data e da hora e o alerta de carregar, como no Windows (FB-0031).
 * No Writer OS o nível vem do sistema (`os.bateria()`, a cada 30 s); no site, do `navigator.getBattery`
 * (só o Chromium o tem: sem ele, ou sem bateria, nada aparece). Um só leitor para a tela toda.
 */
import type { Bateria } from '@ekfrase/writer-nucleo';
import { useEffect, useState } from 'preact/hooks';
import { sistemaOS } from './computador/casca.ts';
import { alertaDaBateria, NIVEL_FRACA, NIVEL_MUITO_FRACA, type Alerta } from './bateria-regras.ts';
import { t } from './textos.ts';
import { avisar } from './ui.tsx';

interface BateriaDoNavegador extends EventTarget {
  level: number;
  charging: boolean;
  dischargingTime: number;
}
type ComBateria = Navigator & { getBattery?: () => Promise<BateriaDoNavegador> };

/** `undefined` = ainda lendo; `null` = este aparelho não tem bateria. */
let atual: Bateria | null | undefined;
const ouvintes = new Set<() => void>();
let parar: (() => void) | null = null;

function mudar(b: Bateria | null): void {
  if (atual !== undefined && atual?.nivel === b?.nivel && atual?.carregando === b?.carregando) return;
  atual = b;
  for (const f of [...ouvintes]) f();
}

function iniciar(): () => void {
  if (sistemaOS) {
    const ler = () => void sistemaOS?.bateria().then(mudar, () => mudar(null));
    ler();
    const i = setInterval(ler, 30_000);
    return () => clearInterval(i);
  }
  const g = (navigator as ComBateria).getBattery;
  if (!g) {
    mudar(null);
    return () => undefined;
  }
  let fechado = false;
  let bat: BateriaDoNavegador | null = null;
  const ler = () => bat && mudar({ nivel: Math.round(bat.level * 100), carregando: bat.charging });
  void g.call(navigator).then(
    (b) => {
      if (fechado) return;
      bat = b;
      // computador de mesa: o navegador diz 100% carregando, sempre (não dá para distinguir de um notebook cheio na tomada)
      if (b.level === 1 && b.charging && b.dischargingTime === Infinity) mudar(null);
      else ler();
      b.addEventListener('levelchange', ler);
      b.addEventListener('chargingchange', ler);
    },
    () => mudar(null),
  );
  return () => {
    fechado = true;
    bat?.removeEventListener('levelchange', ler);
    bat?.removeEventListener('chargingchange', ler);
  };
}

/** A bateria agora: `undefined` lendo, `null` sem bateria. */
export function useBateria(): Bateria | null | undefined {
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

/** O nível ao lado da hora ("73%"; "73% +" carregando); some sem bateria. */
export function NivelDeBateria() {
  const b = useBateria();
  if (!b) return null;
  const rotulo = t(b.carregando ? 'writer.os.bateria.carregando' : 'writer.os.bateria.nivel', { n: b.nivel });
  const baixa = !b.carregando && b.nivel <= NIVEL_FRACA;
  return (
    <span class={`bateria-nivel${baixa ? ' baixa' : ''}${b.carregando ? ' carregando' : ''}`} title={rotulo} aria-label={rotulo} data-teste="bateria-nivel" data-nivel={b.nivel}>
      <span class="bateria-icone" aria-hidden="true">
        <span style={{ width: `${Math.max(8, b.nivel)}%` }} />
      </span>
      {b.nivel}%
    </span>
  );
}

let alertado: Alerta = 0;

/** Monte uma vez só (no App): avisa para carregar a 20% e a 10%, sem repetir. */
export function AlertaDeBateria() {
  const b = useBateria();
  useEffect(() => {
    if (!b) return;
    const agora = alertaDaBateria(b, alertado);
    if (agora !== 0 && agora !== alertado) {
      avisar(t(agora === NIVEL_MUITO_FRACA ? 'writer.bateria.muito-fraca' : 'writer.bateria.fraca', { n: b.nivel }), agora === NIVEL_MUITO_FRACA ? 'erro' : 'ok');
    }
    alertado = agora;
  }, [b?.nivel, b?.carregando]);
  return null;
}
