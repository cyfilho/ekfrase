// SPDX-License-Identifier: MPL-2.0

import {
  CoreError,
  MAX_LEVEL,
  cell,
  cellAt,
  cellCenter,
  cellKey,
  children,
  digit,
  parent,
  spacing,
  type Cell,
  type Point,
} from '@ekfrase/maker-core';
import { chaveNoEndereco, enderecoDaEntrega, entregar, identificar, podeAbrir, receber } from '@ekfrase/arquivo';
import { DocError, type Command } from '@ekfrase/maker-doc';
import { BIOMES, DEFAULT_GENERATOR, GenError, type BiomeId } from '@ekfrase/maker-gen';
import { BRUSHES, brushAvailable, layersOf, type Brush } from './brushes';
import {
  abrirMeusMundos,
  esquecerNuvem,
  guardarAntesDeTrocar,
  guardarJa,
  iniciarCasca,
  iniciarIdiomaETema,
  mudou,
  salvarNaNuvem,
  temNuvem,
  temPendencia,
  tr,
} from './casca';
import { DocumentSession, randomSeed } from './document';
import { TerrainView } from './terrain';
import { TileLayer } from './tiles';
import type { TileStyle } from '@ekfrase/maker-render';
import {
  BIOME_KEYS,
  CORE_ERROR_KEYS,
  DOC_ERROR_KEYS,
  GEN_ERROR_KEYS,
  formatDistance,
  formatNumber,
  getLocale,
  onLocaleChange,
  t,
  translateDom,
} from './i18n';
import { Renderer, readTheme, type LabelBox, type PlaceLabel, type StrokePreview, type Theme } from './render';
import {
  activeLevel,
  clampScale,
  lerpCamera,
  levelRotation,
  panBy,
  scaleForLevel,
  screenToWorld,
  zoomAt,
  type Camera,
} from './view';

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;

const stage = $('stage');
const canvas = $<HTMLCanvasElement>('map');
const slider = $<HTMLInputElement>('level-slider');
const ladder = $('level-ladder');
const optUpper = $<HTMLInputElement>('opt-upper');
const optDigits = $<HTMLInputElement>('opt-digits');
const optAlign = $<HTMLInputElement>('opt-align');
const optTerrain = $<HTMLInputElement>('opt-terrain');
const toast = $('toast');
const docName = $<HTMLInputElement>('doc-name');
const docFile = $<HTMLInputElement>('doc-file');
const worldSeed = $<HTMLInputElement>('world-seed');
const worldNs = $<HTMLInputElement>('world-ns');
const worldEw = $<HTMLInputElement>('world-ew');

const terrain = new TerrainView();
/** Visão do terreno: Mapa (ilustrado) ou Satélite (como um globo virtual). Só apresentação. */
let mapStyle: TileStyle = 'satellite';
/** Mapa em pixel art, desenhado em ladrilhos por Web Workers. */
const tileLayer = new TileLayer(() => requestDraw());

/** Limite do centro da câmera, para as coordenadas do nível 0 ficarem longe do limite de int32. */
const WORLD_LIMIT_M = 1e9;

/** Propriedade de edição usada pela marca de teste (DEC-041). Valor: cor 0–6. */
const MARK_PROP = 'mark';

let session: DocumentSession;

// ---------- preferências (só conveniência local; nada disso é dado do mapa) ----------

const PREFS_KEY = 'ekfrase.viewer.prefs';

interface Prefs {
  locale?: string;
  showUpper?: boolean;
  showDigits?: boolean;
  align?: boolean;
  showTerrain?: boolean;
  style?: TileStyle;
}

function loadPrefs(): Prefs {
  try {
    return JSON.parse(localStorage.getItem(PREFS_KEY) ?? '{}') as Prefs;
  } catch {
    return {};
  }
}

function savePrefs(): void {
  const prefs: Prefs = {
    locale: getLocale(),
    showUpper: optUpper.checked,
    showDigits: optDigits.checked,
    align: optAlign.checked,
    showTerrain: optTerrain.checked,
    style: mapStyle,
  };
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
  } catch {
    // Sem armazenamento (janela privada etc.): segue sem lembrar.
  }
}

// ---------- estado ----------

let width = 1;
let height = 1;
let camera: Camera = { cx: 0, cy: 0, scale: scaleForLevel(0), rotation: 0 };
let selected: Cell | null = null;
let hover: Cell | null = null;
let theme: Theme;
const renderer = new Renderer(canvas);

let animation: { from: Camera; to: Camera; start: number; duration: number } | null = null;
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

function clampCamera(c: Camera): Camera {
  const lim = (v: number): number => Math.min(WORLD_LIMIT_M, Math.max(-WORLD_LIMIT_M, v));
  return { ...c, cx: lim(c.cx), cy: lim(c.cy), scale: clampScale(c.scale) };
}

function setCamera(c: Camera): void {
  animation = null;
  camera = clampCamera(c);
  requestDraw();
}

function animateTo(target: Camera, duration = 450): void {
  const to = clampCamera(target);
  if (reducedMotion.matches) {
    setCamera(to);
    return;
  }
  animation = { from: camera, to, start: performance.now(), duration };
  requestDraw();
}

function desiredRotation(): number {
  if (!optAlign.checked) return 0;
  return levelRotation(selected ? selected.level : activeLevel(camera.scale));
}

// ---------- desenho ----------

let frame = 0;

function requestDraw(): void {
  if (!frame) frame = requestAnimationFrame(drawFrame);
}

function drawFrame(now: number): void {
  frame = 0;
  let again = false;
  if (animation) {
    const k = Math.min(1, (now - animation.start) / animation.duration);
    camera = lerpCamera(animation.from, animation.to, k);
    if (k >= 1) animation = null;
    else again = true;
  } else {
    // Giro suave quando a vista acompanha o nível.
    const target = desiredRotation();
    let dr = target - camera.rotation;
    while (dr > Math.PI) dr -= 2 * Math.PI;
    while (dr < -Math.PI) dr += 2 * Math.PI;
    if (Math.abs(dr) > 1e-4) {
      camera = { ...camera, rotation: reducedMotion.matches ? target : camera.rotation + dr * 0.18 };
      again = true;
    } else if (dr !== 0) {
      camera = { ...camera, rotation: target };
    }
  }

  const level = activeLevel(camera.scale);
  const tiles = optTerrain.checked && terrain.available ? tileLayer : null;
  tileLayer.setStyle(mapStyle);
  const stats = renderer.draw(
    {
      camera,
      width,
      height,
      level,
      selected,
      hover,
      showUpper: optUpper.checked,
      showDigits: optDigits.checked,
      markOf: markLookup(),
      tiles,
      editMode,
      stroke: strokePreview,
      labels,
      selectedLabel,
    },
    theme,
  );
  labelBoxes = stats.labelBoxes;
  updateHud(level, stats.visibleCells);
  // A prévia da pincelada some quando os ladrilhos redesenhados chegam.
  if (strokePreview && !stroke && (!tiles || !tileLayer.stale)) {
    strokePreview = null;
    requestDraw();
  }
  $('loading').hidden = !(tiles && tileLayer.pending);
  if (again) requestDraw();
}

let lastHud = '';

function updateHud(level: number, visible: number): void {
  const key = `${level}|${visible}|${camera.scale}|${getLocale()}`;
  if (key === lastHud) return;
  lastHud = key;
  $('level-badge').textContent = t('level.badge', { level });
  $('level-spacing').textContent = t('level.spacing', { distance: formatDistance(spacing(level)) });
  $('visible-count').textContent = t('grid.visibleCells', { count: visible });
  slider.value = String(level);
  for (const el of ladder.children) el.classList.toggle('active', el.textContent === String(level));

  // Barra de escala com um valor "redondo" (1, 2 ou 5 × 10^n) de até ~140 px.
  const maxMetres = 140 / camera.scale;
  const pow = 10 ** Math.floor(Math.log10(maxMetres));
  const nice = [5, 2, 1].map((m) => m * pow).find((v) => v <= maxMetres) ?? pow;
  $('scale-bar').style.width = `${nice * camera.scale}px`;
  $('scale-label').textContent = formatDistance(nice);
  $('brush-info').textContent = t('brush.level', { level, size: formatDistance(spacing(level)) });
}

// ---------- seleção e painel ----------

function addressText(c: Cell): string {
  return t('cell.address', { level: c.level, q: c.q, r: c.r });
}

let toastTimer = 0;

function showToast(text: string): void {
  toast.textContent = text;
  toast.hidden = false;
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => (toast.hidden = true), 3200);
}

function showError(e: unknown): void {
  if (e instanceof CoreError) showToast(t(CORE_ERROR_KEYS[e.code]));
  else if (e instanceof DocError) showToast(t(DOC_ERROR_KEYS[e.code]));
  else if (e instanceof GenError) showToast(t(GEN_ERROR_KEYS[e.code]));
  else throw e;
}

/** Cor da marca que vale para a célula (própria ou do ancestral mais próximo). */
function markLookup(): ((c: Cell) => number | undefined) | null {
  if (!session || session.store.editCount() === 0) return null;
  const store = session.store;
  return (c) => {
    const v = store.effectiveEdit(c, MARK_PROP)?.value;
    return typeof v === 'number' && Number.isInteger(v) && v >= 0 && v < 7 ? v : undefined;
  };
}

function renderMarks(c: Cell): void {
  const box = $('mark-swatches');
  box.replaceChildren();
  const own = session.store.getEdit(c, MARK_PROP);
  for (let d = 0; d < 7; d++) {
    const b = document.createElement('button');
    b.className = 'mark-btn';
    b.style.background = `var(--kid-${d})`;
    const label = t('mark.set', { n: d + 1 });
    b.title = label;
    b.setAttribute('aria-label', label);
    b.setAttribute('aria-pressed', String(own === d));
    b.onclick = () => runCommand(() => session.apply({ type: 'edit.set', cell: c, prop: MARK_PROP, value: d }));
    box.append(b);
  }
  const clear = document.createElement('button');
  clear.className = 'chip';
  clear.textContent = t('mark.clear');
  clear.disabled = own === undefined;
  clear.onclick = () => runCommand(() => session.apply({ type: 'edit.clear', cell: c, prop: MARK_PROP }));
  box.append(clear);

  const eff = session.store.effectiveEdit(c, MARK_PROP);
  $('mark-status').textContent =
    own !== undefined ? t('mark.own') : eff ? t('mark.inherited', { address: addressText(eff.from) }) : '';
}

function runCommand(f: () => unknown): void {
  try {
    f();
  } catch (e) {
    showError(e);
  }
}

function select(c: Cell | null): void {
  selected = c;
  renderSelection();
  requestDraw();
}

/** Seleciona e enquadra a célula de modo que os 7 filhos fiquem bem visíveis. */
function focusCell(c: Cell): void {
  select(c);
  const center = cellCenter(c);
  const level = Math.max(0, c.level - 1);
  const rotation = optAlign.checked ? levelRotation(c.level) : 0;
  animateTo({ cx: center.x, cy: center.y, scale: scaleForLevel(level), rotation });
}

function renderSelection(): void {
  const empty = $('selection-empty');
  const body = $('selection-body');
  $('clear-selection').hidden = !selected;
  if (!selected) {
    empty.hidden = false;
    body.hidden = true;
    return;
  }
  const c = selected;
  empty.hidden = true;
  body.hidden = false;
  $('sel-address').textContent = addressText(c);
  $('sel-digit').textContent = c.level < MAX_LEVEL ? formatNumber(digit(c)) : '';
  const center = cellCenter(c);
  $('sel-center').textContent = t('selection.centerValue', {
    x: formatDistance(center.x),
    y: formatDistance(center.y),
  });
  renderMarks(c);
  renderTerrainInfo(c);

  const parentBtn = $<HTMLButtonElement>('sel-parent');
  const hasParent = c.level < MAX_LEVEL;
  parentBtn.hidden = !hasParent;
  $('sel-no-parent').hidden = hasParent;
  if (hasParent) {
    const p = parent(c);
    parentBtn.textContent = addressText(p);
    parentBtn.setAttribute('aria-label', t('selection.select', { address: addressText(p) }));
    parentBtn.onclick = () => focusCell(p);
  }

  const list = $('sel-children');
  list.replaceChildren();
  const hasChildren = c.level > 0;
  list.hidden = !hasChildren;
  $('sel-no-children').hidden = hasChildren;
  if (!hasChildren) return;
  children(c).forEach((k, d) => {
    const li = document.createElement('li');
    const btn = document.createElement('button');
    btn.className = 'chip';
    btn.setAttribute('aria-label', t('selection.select', { address: addressText(k) }));
    const sw = document.createElement('span');
    sw.className = 'swatch';
    sw.style.background = `var(--kid-${d})`;
    const label = document.createElement('span');
    label.textContent = addressText(k);
    const dig = document.createElement('span');
    dig.className = 'digit';
    dig.textContent = t('selection.childDigit', { digit: d });
    btn.append(sw, label, dig);
    btn.onclick = () => focusCell(k);
    li.append(btn);
    list.append(li);
  });
}

// ---------- mundo e terreno gerado ----------

function renderTerrainInfo(c: Cell): void {
  const box = $('terrain-info');
  const s = terrain.sample(c);
  box.hidden = !s;
  if (!s) return;
  // Bioma pintado à mão (própria célula ou ancestral) vence o gerado (§4).
  const painted = session.store.effectiveEdit(c, 'biome');
  const paintedBiome =
    painted && typeof painted.value === 'string' && (BIOMES as readonly string[]).includes(painted.value)
      ? (painted.value as BiomeId)
      : null;
  const biome = paintedBiome ?? s.biome;
  $('terrain-swatch').style.background = `var(--biome-${biome})`;
  $('terrain-biome').textContent = t(BIOME_KEYS[biome]);
  $('terrain-painted').textContent = painted && paintedBiome ? t('terrain.painted', { address: addressText(painted.from) }) : '';
  $('terrain-elevation').textContent = formatNumber(s.elevationM, { style: 'unit', unit: 'meter', maximumFractionDigits: 0 });
  $('terrain-temperature').textContent = formatNumber(s.temperatureC, {
    style: 'unit',
    unit: 'celsius',
    maximumFractionDigits: 1,
  });
  $('terrain-moisture').textContent = formatNumber(s.moisture, { style: 'percent', maximumFractionDigits: 0 });
}

function renderWorld(): void {
  const w = session.store.world();
  if (document.activeElement !== worldSeed) worldSeed.value = w.seed;
  if (document.activeElement !== worldNs) worldNs.value = String(w.extentKm.ns);
  if (document.activeElement !== worldEw) worldEw.value = String(w.extentKm.ew);
  const none = w.generator.id === 'org.ekfrase.generator.none';
  $('world-generator').textContent = none
    ? t('world.noGenerator')
    : terrain.error
      ? t(GEN_ERROR_KEYS[terrain.error.code])
      : t('world.generator', { id: `${w.generator.id}@${w.generator.version}` });
  $('world-use-basic').hidden = !none;
}

/** Atualiza o amostrador quando semente, extensão ou gerador mudam. */
function syncTerrain(): void {
  const world = session.store.world();
  if (terrain.update(world)) {
    if (selected) renderSelection();
    requestDraw();
  }
  tileLayer.setWorld(terrain.available ? world : null);
  const layers = paintedLayers();
  tileLayer.setEdits(layers.paint, layers.relief);
}

/** Enquadra a extensão do mundo inteira, de norte para cima. */
function fitWorld(animate = true): void {
  const w = session.store.world();
  const scale = Math.min(width / (w.extentKm.ew * 1000), height / (w.extentKm.ns * 1000)) * 0.92;
  const target = { cx: 0, cy: 0, scale, rotation: optAlign.checked ? desiredRotation() : 0 };
  if (animate) animateTo(target, 600);
  else setCamera(target);
}

function applyWorld(seed: string): void {
  const ns = Number(worldNs.value);
  const ew = Number(worldEw.value);
  const before = session.store.world().extentKm;
  if (!(ns >= 1 && ns <= 20000 && ew >= 1 && ew <= 20000)) {
    showToast(t('error.gen.invalid-world'));
    renderWorld();
    return;
  }
  runCommand(() => session.apply({ type: 'world.update', patch: { seed, extentKm: { ns, ew } } }));
  if (before.ns !== ns || before.ew !== ew) fitWorld();
}

/**
 * "Gerar novo mundo" (e o globo do castelo). Um mundo com algo feito (pintura, nomes, nome próprio) não
 * é trocado: o atual fica salvo em Meus mundos e abre um documento novo, com outra semente (FB-0001).
 * Um mundo ainda intocado só troca de semente.
 */
async function gerarNovoMundo(): Promise<void> {
  const meta = session.store.getMeta();
  const temAlgo = session.store.editCount() > 0 || labels.length > 0 || meta.name !== t('doc.untitled');
  if (!temAlgo) {
    const seed = randomSeed();
    worldSeed.value = seed;
    applyWorld(seed);
    return;
  }
  if (!(await guardarAntesDeTrocar())) return;
  esquecerNuvem();
  session.newDocument(t('doc.untitled'));
  session.markDirty();
  select(null);
  fitWorld();
  showToast(t('world.newKept'));
}

function setupWorld(): void {
  $('world-apply').addEventListener('click', () => void gerarNovoMundo());
  worldSeed.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') applyWorld(worldSeed.value);
  });
  $('world-fit').addEventListener('click', () => fitWorld());
  $('world-use-basic').addEventListener('click', () =>
    runCommand(() =>
      session.apply({
        type: 'world.update',
        patch: { generator: { id: DEFAULT_GENERATOR.id, version: DEFAULT_GENERATOR.version, params: {} } },
      }),
    ),
  );
}

function buildBiomeLegend(): void {
  const list = $('biome-legend');
  list.replaceChildren();
  for (const b of BIOMES) {
    const li = document.createElement('li');
    const sw = document.createElement('span');
    sw.className = 'sw';
    sw.style.background = `var(--biome-${b})`;
    const label = document.createElement('span');
    label.textContent = t(BIOME_KEYS[b]);
    li.append(sw, label);
    list.append(li);
  }
}

// ---------- idioma ----------

function applyLocale(): void {
  document.documentElement.lang = getLocale();
  document.title = t('app.documentTitle');
  translateDom(document);
  lastHud = '';
  renderDocument();
  renderWorld();
  buildBiomeLegend();
  buildBrushPicker();
  renderSelection();
  requestDraw();
}

// ---------- documento ----------

function renderDocument(): void {
  const store = session.store;
  if (document.activeElement !== docName) docName.value = store.getMeta().name;
  const status = $('doc-status');
  status.textContent = t(session.dirty ? 'doc.unsaved' : 'doc.saved');
  status.classList.toggle('unsaved', session.dirty);
  $('doc-edits').textContent = t('doc.edits', { count: store.editCount() });
  $<HTMLButtonElement>('doc-undo').disabled = !store.canUndo();
  $<HTMLButtonElement>('doc-redo').disabled = !store.canRedo();
}

function confirmDiscard(): boolean {
  return !session.dirty || window.confirm(t('doc.confirmDiscard'));
}

/** Miniatura PNG da vista atual para o `preview.png` do arquivo. */
function makePreview(): Promise<Uint8Array | undefined> {
  const w = 320;
  const h = Math.max(1, Math.round((w * canvas.height) / Math.max(1, canvas.width)));
  const small = document.createElement('canvas');
  small.width = w;
  small.height = h;
  small.getContext('2d')?.drawImage(canvas, 0, 0, w, h);
  return new Promise((resolve) => {
    small.toBlob(async (blob) => resolve(blob ? new Uint8Array(await blob.arrayBuffer()) : undefined), 'image/png');
  });
}

async function saveDocument(): Promise<void> {
  try {
    // com a nuvem, exportar não marca como salvo: a nuvem ainda precisa receber as mudanças
    const file = session.save(await makePreview(), !temNuvem());
    showToast(t('doc.savedAs', { file }));
  } catch (e) {
    showError(e);
  }
}

function undo(): void {
  session.store.undo();
}

function redo(): void {
  session.store.redo();
}

/**
 * Abre um arquivo do aparelho ou entregue por outro app (`#/abrir/<chave>`). Antes, o envelope do
 * `.ekfr` diz de que app ele é (docs/formato-ekfr.md): se é de outro app da família, oferece abrir lá.
 */
async function abrirArquivo(bytes: Uint8Array, nome: string): Promise<void> {
  const id = identificar(bytes);
  if (id.ok) {
    const v = podeAbrir('maker', id.envelope);
    if (!v.abre && v.motivo === 'outro-app') {
      const app = tr.t(`nucleo.app.${v.app.id}`);
      if (confirm(t('file.otherApp', { app }))) location.href = enderecoDaEntrega(v.app.endereco, await entregar(bytes, nome));
      return;
    }
    if (!v.abre && v.motivo === 'app-desconhecido') {
      showToast(t('file.unknownApp', { app: id.envelope.app }));
      return;
    }
  }
  // o mundo aberto vai para a nuvem antes de dar lugar ao do arquivo
  if (!(await guardarAntesDeTrocar())) return;
  try {
    session.open(bytes);
    esquecerNuvem();
    // o mundo importado ainda não está na nuvem: o salvamento automático o leva
    session.markDirty();
    showToast(t('doc.opened', { name: session.store.getMeta().name }));
    select(null);
    fitWorld();
  } catch (e) {
    showError(e);
  }
}

function setupDocument(): void {
  session = new DocumentSession(t('doc.untitled'));
  session.onChange(() => {
    // toda mudança vai para o rascunho e, depois, para a nuvem (FB-0001)
    if (session.dirty) mudou();
    refreshLabels();
    renderLabelCard();
    syncTerrain();
    renderDocument();
    renderWorld();
    renderSelection();
    requestDraw();
  });
  syncTerrain();

  docName.addEventListener('change', () => {
    const name = docName.value.trim() || t('doc.untitled');
    if (name !== session.store.getMeta().name) runCommand(() => session.apply({ type: 'meta.rename', name }));
    docName.value = session.store.getMeta().name;
  });
  $('doc-new').addEventListener('click', async () => {
    if (!(await guardarAntesDeTrocar())) return;
    esquecerNuvem();
    session.newDocument(t('doc.untitled'));
    // o mundo novo já é "o da última vez": vai para a nuvem e é ele que abre ao recarregar
    session.markDirty();
    select(null);
    fitWorld();
  });
  // Abrir e Salvar são da nuvem (a conta Ekfrase); Importar e Exportar, do arquivo .ekfr
  $('doc-open').addEventListener('click', abrirMeusMundos);
  // o seletor de arquivo precisa do clique direto (sem esperar a nuvem): o mundo atual é guardado depois
  $('doc-import').addEventListener('click', () => {
    if (temNuvem() || confirmDiscard()) docFile.click();
  });
  docFile.addEventListener('change', async () => {
    const file = docFile.files?.[0];
    docFile.value = '';
    if (!file) return;
    await abrirArquivo(new Uint8Array(await file.arrayBuffer()), file.name);
  });
  $('doc-save').addEventListener('click', () => void salvarNaNuvem());
  $('doc-export').addEventListener('click', () => void saveDocument());
  $('doc-json').addEventListener('click', () => runCommand(() => session.exportJson()));
  $('doc-undo').addEventListener('click', undo);
  $('doc-redo').addEventListener('click', redo);

  // Atalhos: Ctrl+Z desfaz, Ctrl+Y ou Ctrl+Shift+Z refaz, Ctrl+S salva na nuvem, Ctrl+O abre Meus mundos.
  window.addEventListener('keydown', (e) => {
    if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
    const key = e.key.toLowerCase();
    const typing = e.target instanceof HTMLInputElement && e.target.type === 'text';
    if ((key === 'z' || key === 'y') && typing) return; // o campo de texto tem o próprio desfazer
    if (key === 'z' && !e.shiftKey) undo();
    else if (key === 'y' || (key === 'z' && e.shiftKey)) redo();
    else if (key === 's') void salvarNaNuvem();
    else if (key === 'o') abrirMeusMundos();
    else return;
    e.preventDefault();
  });

  // Algo ainda não chegou à nuvem: o navegador pergunta antes de fechar ou recarregar a página
  // (o rascunho deste navegador já guardou tudo). Ao sair da aba, manda para a nuvem já.
  window.addEventListener('beforeunload', (e) => {
    guardarJa();
    if (temPendencia()) e.preventDefault();
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') guardarJa();
  });
}


// ---------- modo, ferramentas, pincéis e nomes de lugares ----------

type Tool = 'select' | 'brush' | 'eraser' | 'label';
let editMode = false;
let tool: Tool = 'select';
let brush: Brush = BRUSHES.find((b) => b.id === 'trees:broadleaf')!;
/** Pincelada em andamento: células tocadas e as já gravadas (a gravação acontece aos poucos). */
let stroke: {
  readonly cells: Map<string, Cell>;
  readonly flushed: Set<string>;
  last: Point | null;
  readonly pointer: number;
  lastFlush: number;
} | null = null;
/** Prévia que fica na tela até os ladrilhos redesenhados chegarem. */
let strokePreview: StrokePreview | null = null;
let spaceHeld = false;
/** Intervalo entre gravações durante a pincelada: as árvores vão surgindo enquanto se arrasta. */
const FLUSH_MS = 120;

const PREVIEW_BIOME: Readonly<Record<Brush['group'], BiomeId>> = {
  biome: 'plain',
  vegetation: 'forest',
  relief: 'tundra',
  building: 'desert',
};

function painting(): boolean {
  return editMode && (tool === 'brush' || tool === 'eraser');
}

function setMode(edit: boolean): void {
  editMode = edit;
  if (!edit) {
    endStroke(true);
    if (tool !== 'select') tool = 'select';
    hideLabelForm();
  }
  renderTools();
  requestDraw();
}

function setTool(next: Tool): void {
  tool = next;
  if (next !== 'select') editMode = true;
  if (next !== 'label') hideLabelForm();
  renderTools();
  requestDraw();
}

function renderTools(): void {
  $('mode-explore').setAttribute('aria-pressed', String(!editMode));
  $('mode-edit').setAttribute('aria-pressed', String(editMode));
  $('toolbar').hidden = !editMode;
  for (const [id, t2] of [['tool-select', 'select'], ['tool-brush', 'brush'], ['tool-eraser', 'eraser'], ['tool-label', 'label']] as const) {
    $(id).setAttribute('aria-pressed', String(tool === t2));
  }
  const level = activeLevel(camera.scale);
  for (const b of $('brush-pick').querySelectorAll<HTMLButtonElement>('button')) {
    const def = BRUSHES.find((x) => x.id === b.dataset['brush']);
    if (!def) continue;
    const ok = brushAvailable(def, level);
    b.disabled = !ok;
    b.setAttribute('aria-pressed', String((tool === 'brush' || tool === 'eraser') && def.id === brush.id));
    b.title = ok ? t('tool.paintWith', { name: t(def.nameKey) }) : t('brush.zoomIn', { name: t(def.nameKey), level: def.maxLevel ?? 0 });
  }
  canvas.classList.toggle('painting', (painting() || tool === 'label') && !spaceHeld);
}

const GROUP_KEYS: Readonly<Record<Brush['group'], string>> = {
  biome: 'brush.group.biome',
  vegetation: 'brush.group.vegetation',
  relief: 'brush.group.relief',
  building: 'brush.group.building',
};

function buildBrushPicker(): void {
  const box = $('brush-pick');
  box.replaceChildren();
  let group = '';
  for (const b of BRUSHES) {
    if (b.group !== group) {
      const head = document.createElement('span');
      head.className = 'brush-group';
      head.textContent = t(GROUP_KEYS[b.group]);
      box.append(head);
    }
    group = b.group;
    const btn = document.createElement('button');
    btn.className = 'brush-btn';
    btn.dataset['brush'] = b.id;
    btn.style.background = b.swatch;
    if (b.icon) {
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svg.setAttribute('viewBox', '0 0 24 24');
      svg.setAttribute('aria-hidden', 'true');
      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      path.setAttribute('d', b.icon);
      svg.append(path);
      btn.append(svg);
    }
    const name = document.createElement('span');
    name.className = 'brush-name';
    name.textContent = t(b.shortKey ?? b.nameKey);
    btn.append(name);
    btn.setAttribute('aria-label', t(b.nameKey));
    btn.onclick = () => {
      brush = b;
      if (tool !== 'eraser') setTool('brush');
      else renderTools();
    };
    box.append(btn);
  }
  renderTools();
}

function startStroke(screen: Point, pointer: number): boolean {
  const level = activeLevel(camera.scale);
  if (!brushAvailable(brush, level)) {
    showToast(t('brush.zoomIn', { name: t(brush.nameKey), level: brush.maxLevel ?? 0 }));
    return false;
  }
  session.beginGroup();
  stroke = { cells: new Map(), flushed: new Set(), last: null, pointer, lastFlush: performance.now() };
  addStrokePoint(screen);
  return true;
}

/** Acrescenta à pincelada as células sob o ponteiro, sem deixar buracos entre dois eventos. */
function addStrokePoint(screen: Point): void {
  if (!stroke) return;
  const level = activeLevel(camera.scale);
  const world = screenToWorld(camera, width, height, screen);
  const from = stroke.last ?? world;
  const step = spacing(level) * 0.35;
  const n = Math.max(1, Math.ceil(Math.hypot(world.x - from.x, world.y - from.y) / step));
  for (let i = 0; i <= n; i++) {
    const p = { x: from.x + ((world.x - from.x) * i) / n, y: from.y + ((world.y - from.y) * i) / n };
    try {
      const c = cellAt(level, p);
      stroke.cells.set(cellKey(c), c);
    } catch {
      // fora do alcance das coordenadas: ignora
    }
  }
  stroke.last = world;
  strokePreview = {
    cells: [...stroke.cells.values()],
    biome: tool === 'eraser' ? null : brush.layer === 'biome' ? (brush.value as BiomeId) : PREVIEW_BIOME[brush.group]!,
  };
  if (performance.now() - stroke.lastFlush > FLUSH_MS) flushStroke();
  requestDraw();
}

/** Grava as células novas da pincelada (dentro do grupo: tudo vira um só passo de desfazer). */
function flushStroke(): void {
  if (!stroke) return;
  const prop = brush.layer;
  const store = session.store;
  const commands: Command[] = [];
  for (const [key, c] of stroke.cells) {
    if (stroke.flushed.has(key)) continue;
    stroke.flushed.add(key);
    const own = store.getEdit(c, prop);
    if (tool === 'brush' && own !== brush.value) commands.push({ type: 'edit.set', cell: c, prop, value: brush.value });
    if (tool === 'eraser' && own !== undefined) commands.push({ type: 'edit.clear', cell: c, prop });
  }
  stroke.lastFlush = performance.now();
  if (commands.length) runCommand(() => session.applyAll(commands));
}

function endStroke(commit: boolean): void {
  if (!stroke) return;
  if (commit) flushStroke();
  stroke = null;
  session.endGroup();
  if (!commit) strokePreview = null;
  requestDraw();
}

/** Camadas pintadas do documento, para os Workers. */
function paintedLayers(): ReturnType<typeof layersOf> {
  return layersOf((prop) => session.store.editsOf(prop));
}

// ---------- nomes de lugares (entidades "label") ----------

const LABEL_CATEGORIES = ['region', 'sea', 'lake', 'river', 'forest', 'mountain', 'range', 'city', 'building'] as const;
type LabelCategory = (typeof LABEL_CATEGORIES)[number];
const LABEL_KEYS: Readonly<Record<LabelCategory, string>> = {
  region: 'label.category.region',
  sea: 'label.category.sea',
  lake: 'label.category.lake',
  river: 'label.category.river',
  forest: 'label.category.forest',
  mountain: 'label.category.mountain',
  range: 'label.category.range',
  city: 'label.category.city',
  building: 'label.category.building',
};
let labels: PlaceLabel[] = [];
let selectedLabel: string | null = null;
let labelBoxes: readonly LabelBox[] = [];
let pendingLabel: Point | null = null;
let lastCategory: LabelCategory = 'region';

function isCategory(v: unknown): v is LabelCategory {
  return typeof v === 'string' && (LABEL_CATEGORIES as readonly string[]).includes(v);
}

function refreshLabels(): void {
  labels = session.store.entitiesOfType('label').map(({ id, entity }) => ({
    id,
    x: entity.posKm.x * 1000,
    y: entity.posKm.y * 1000,
    name: String(entity.components['name'] ?? ''),
    category: isCategory(entity.components['category']) ? entity.components['category'] : 'region',
    level: Number(entity.components['level'] ?? 0),
  }));
  if (selectedLabel && !labels.some((l) => l.id === selectedLabel)) selectedLabel = null;
}

function fillCategories(select: HTMLSelectElement, value: LabelCategory): void {
  select.replaceChildren();
  for (const c of LABEL_CATEGORIES) {
    const opt = document.createElement('option');
    opt.value = c;
    opt.textContent = t(LABEL_KEYS[c]);
    opt.selected = c === value;
    select.append(opt);
  }
}

/** Nome sendo editado no formulário flutuante (null = criando um novo). */
let editingLabel: string | null = null;

function placeLabelForm(screen: Point): void {
  const form = $('label-form');
  form.hidden = false;
  form.style.left = `${Math.min(Math.max(8, screen.x - 140), width - 360)}px`;
  form.style.top = `${Math.min(Math.max(8, screen.y + 16), height - 64)}px`;
}

function openLabelForm(screen: Point, world: Point): void {
  pendingLabel = world;
  editingLabel = null;
  placeLabelForm(screen);
  const input = $<HTMLInputElement>('label-new-name');
  input.value = '';
  input.placeholder = t('label.placeholder');
  fillCategories($<HTMLSelectElement>('label-new-category'), lastCategory);
  $('label-submit').textContent = t('label.create');
  $('label-form-delete').hidden = true;
  input.focus();
}

/** Abre o formulário flutuante já preenchido, junto do nome clicado, para renomear ou mudar o tipo. */
function openLabelEditor(id: string, screen: Point): void {
  const l = labels.find((x) => x.id === id);
  if (!l) return;
  pendingLabel = null;
  editingLabel = id;
  placeLabelForm(screen);
  const input = $<HTMLInputElement>('label-new-name');
  input.value = l.name;
  fillCategories($<HTMLSelectElement>('label-new-category'), isCategory(l.category) ? l.category : 'region');
  $('label-submit').textContent = t('label.save');
  $('label-form-delete').hidden = false;
  input.focus();
  input.select();
}

function hideLabelForm(): void {
  $('label-form').hidden = true;
  pendingLabel = null;
  editingLabel = null;
}

function createLabel(): void {
  const name = $<HTMLInputElement>('label-new-name').value.trim();
  const category = $<HTMLSelectElement>('label-new-category').value;
  if (editingLabel) {
    const id = editingLabel;
    const l = labels.find((x) => x.id === id);
    hideLabelForm();
    if (!l || !isCategory(category)) return;
    const commands: Command[] = [];
    if (name && name !== l.name) commands.push({ type: 'entity.setComponent', id, name: 'name', value: name });
    if (category !== l.category) commands.push({ type: 'entity.setComponent', id, name: 'category', value: category });
    if (commands.length) runCommand(() => session.applyAll(commands));
    lastCategory = category;
    return;
  }
  if (!pendingLabel || !name || !isCategory(category)) {
    hideLabelForm();
    return;
  }
  lastCategory = category;
  const at = pendingLabel;
  hideLabelForm();
  runCommand(() => {
    const { id } = session.apply({
      type: 'entity.add',
      entity: {
        type: 'label',
        posKm: { x: at.x / 1000, y: at.y / 1000 },
        components: { name, category, level: activeLevel(camera.scale) },
      },
    });
    if (id) selectLabel(id);
  });
}

function selectLabel(id: string | null): void {
  selectedLabel = id;
  if (id) selected = null;
  renderSelection();
  renderLabelCard();
  requestDraw();
}

function renderLabelCard(): void {
  const card = $('label-card');
  const l = labels.find((x) => x.id === selectedLabel);
  card.hidden = !l;
  if (!l) return;
  const name = $<HTMLInputElement>('label-edit-name');
  if (document.activeElement !== name) name.value = l.name;
  fillCategories($<HTMLSelectElement>('label-edit-category'), isCategory(l.category) ? l.category : 'region');
}

function setupLabels(): void {
  $('label-form').addEventListener('submit', (e) => {
    e.preventDefault();
    createLabel();
  });
  $('label-form').addEventListener('keydown', (e) => {
    if (e.key === 'Escape') hideLabelForm();
  });
  $('label-form-delete').addEventListener('click', () => {
    const id = editingLabel;
    hideLabelForm();
    if (!id) return;
    selectLabel(null);
    runCommand(() => session.apply({ type: 'entity.remove', id }));
  });
  $('label-edit-name').addEventListener('change', () => {
    const name = $<HTMLInputElement>('label-edit-name').value.trim();
    if (selectedLabel && name) runCommand(() => session.apply({ type: 'entity.setComponent', id: selectedLabel!, name: 'name', value: name }));
  });
  $('label-edit-category').addEventListener('change', () => {
    const v = $<HTMLSelectElement>('label-edit-category').value;
    if (selectedLabel && isCategory(v)) runCommand(() => session.apply({ type: 'entity.setComponent', id: selectedLabel!, name: 'category', value: v }));
  });
  $('label-delete').addEventListener('click', () => {
    if (!selectedLabel) return;
    const id = selectedLabel;
    selectLabel(null);
    runCommand(() => session.apply({ type: 'entity.remove', id }));
  });
}

/** Nome de lugar sob o ponto da tela (o último desenhado fica por cima). */
function labelAt(p: Point): string | null {
  for (let i = labelBoxes.length - 1; i >= 0; i--) {
    const b = labelBoxes[i]!;
    if (p.x >= b.x0 && p.x <= b.x1 && p.y >= b.y0 && p.y <= b.y1) return b.id;
  }
  return null;
}

// ---------- entrada: arrastar, zoom, clique, pincel, teclado ----------

const pointers = new Map<number, Point>();
let dragDistance = 0;
let pinchDistance = 0;

function localPoint(e: MouseEvent): Point {
  const r = canvas.getBoundingClientRect();
  return { x: e.clientX - r.left, y: e.clientY - r.top };
}

canvas.addEventListener('contextmenu', (e) => e.preventDefault());

canvas.addEventListener('pointerdown', (e) => {
  try {
    canvas.setPointerCapture(e.pointerId);
  } catch {
    // ponteiro sintético (testes): segue sem captura
  }
  const p = localPoint(e);
  if (stroke) {
    // segundo dedo durante a pincelada: encerra a pincelada e vira gesto de zoom
    endStroke(false);
  } else if (painting() && e.button === 0 && !spaceHeld && startStroke(p, e.pointerId)) {
    return;
  }
  pointers.set(e.pointerId, p);
  dragDistance = 0;
  if (pointers.size === 2) {
    const [a, b] = [...pointers.values()];
    pinchDistance = Math.hypot(a!.x - b!.x, a!.y - b!.y);
  }
  canvas.classList.add('dragging');
});

canvas.addEventListener('pointermove', (e) => {
  const p = localPoint(e);
  if (stroke && e.pointerId === stroke.pointer) {
    addStrokePoint(p);
  }
  const prev = pointers.get(e.pointerId);
  if (!prev) {
    try {
      const h = cellAt(activeLevel(camera.scale), screenToWorld(camera, width, height, p));
      if (!hover || h.q !== hover.q || h.r !== hover.r || h.level !== hover.level) {
        hover = h;
        if (editMode) requestDraw();
      }
    } catch {
      hover = null;
    }
    return;
  }
  pointers.set(e.pointerId, p);
  if (pointers.size === 1) {
    dragDistance += Math.hypot(p.x - prev.x, p.y - prev.y);
    setCamera(panBy(camera, p.x - prev.x, p.y - prev.y));
  } else if (pointers.size === 2) {
    const [a, b] = [...pointers.values()];
    const dist = Math.hypot(a!.x - b!.x, a!.y - b!.y);
    const mid = { x: (a!.x + b!.x) / 2, y: (a!.y + b!.y) / 2 };
    if (pinchDistance > 0) setCamera(zoomAt(camera, width, height, mid, dist / pinchDistance));
    pinchDistance = dist;
    dragDistance = Infinity;
  }
});

function endPointer(e: PointerEvent): void {
  if (stroke && e.pointerId === stroke.pointer) {
    endStroke(e.type === 'pointerup');
    return;
  }
  const wasSingle = pointers.size === 1;
  pointers.delete(e.pointerId);
  if (pointers.size === 0) canvas.classList.remove('dragging');
  if (e.type === 'pointerup' && wasSingle && dragDistance < 5 && e.button === 0) {
    const p = localPoint(e);
    const world = screenToWorld(camera, width, height, p);
    // Clicar num nome (em qualquer ferramenta) seleciona e abre a edição no próprio mapa.
    const hit = labelAt(p);
    if (hit) {
      selectLabel(hit);
      openLabelEditor(hit, p);
      return;
    }
    if (tool === 'label') {
      openLabelForm(p, world);
      return;
    }
    try {
      selectLabel(null);
      select(cellAt(activeLevel(camera.scale), world));
    } catch (err) {
      showError(err);
    }
  }
}

canvas.addEventListener('pointerup', endPointer);
canvas.addEventListener('pointercancel', endPointer);
canvas.addEventListener('pointerleave', () => {
  if (pointers.size === 0 && hover) {
    hover = null;
    requestDraw();
  }
});

// Atalhos de ferramenta: E alterna o modo, V seleciona, B pincel, X borracha, N nomes; Espaço segurado move o mapa.
window.addEventListener('keydown', (e) => {
  const typing = e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement;
  if (typing || e.ctrlKey || e.metaKey || e.altKey) return;
  if (e.key === ' ') {
    if (!spaceHeld) {
      spaceHeld = true;
      renderTools();
    }
    if (e.target === canvas || e.target === document.body) e.preventDefault();
    return;
  }
  const key = e.key.toLowerCase();
  if (key === 'e') setMode(!editMode);
  else if (key === 'v') setTool('select');
  else if (key === 'b') setTool('brush');
  else if (key === 'x') setTool('eraser');
  else if (key === 'n') setTool('label');
});

window.addEventListener('keyup', (e) => {
  if (e.key === ' ' && spaceHeld) {
    spaceHeld = false;
    renderTools();
  }
});

canvas.addEventListener(
  'wheel',
  (e) => {
    e.preventDefault();
    const delta = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
    setCamera(zoomAt(camera, width, height, localPoint(e), Math.exp(-delta * 0.0015)));
  },
  { passive: false },
);

const SQRT7 = Math.sqrt(7);

function zoomStep(factor: number): void {
  const target = animation ? animation.to : camera;
  animateTo(zoomAt(target, width, height, { x: width / 2, y: height / 2 }, factor), 320);
}

canvas.addEventListener('keydown', (e) => {
  const step = 80;
  const actions: Record<string, () => void> = {
    ArrowLeft: () => setCamera(panBy(camera, step, 0)),
    ArrowRight: () => setCamera(panBy(camera, -step, 0)),
    ArrowUp: () => setCamera(panBy(camera, 0, step)),
    ArrowDown: () => setCamera(panBy(camera, 0, -step)),
    '+': () => zoomStep(SQRT7),
    '=': () => zoomStep(SQRT7),
    '-': () => zoomStep(1 / SQRT7),
    Escape: () => select(null),
  };
  const action = actions[e.key];
  if (action) {
    e.preventDefault();
    action();
  }
});

$('zoom-in').addEventListener('click', () => zoomStep(SQRT7));
$('zoom-out').addEventListener('click', () => zoomStep(1 / SQRT7));
$('clear-selection').addEventListener('click', () => select(null));

slider.addEventListener('input', () => {
  const target = animation ? animation.to : camera;
  animateTo({ ...target, scale: scaleForLevel(Number(slider.value)) }, 300);
});

for (const opt of [optUpper, optDigits, optAlign, optTerrain]) {
  opt.addEventListener('change', () => {
    savePrefs();
    requestDraw();
  });
}

/** Mesma cena do diagrama: uma célula do nível 1, de pé, com os 7 filhos. */
function showDiagram(): void {
  setMode(true);
  optAlign.checked = true;
  savePrefs();
  const c = cell(1, 0, 0);
  select(c);
  const center = cellCenter(c);
  const fit = (Math.min(width, height) * 0.62) / spacing(1);
  animateTo({ cx: center.x, cy: center.y, scale: fit, rotation: levelRotation(1) }, 600);
}

$('btn-diagram').addEventListener('click', showDiagram);

// ---------- início ----------

function resize(): void {
  const r = stage.getBoundingClientRect();
  width = Math.max(1, r.width);
  height = Math.max(1, r.height);
  renderer.resize(width, height, window.devicePixelRatio || 1);
  lastHud = '';
  requestDraw();
}

function init(): void {
  const prefs = loadPrefs();
  // o idioma e o tema do Ekfrase (os mesmos em todo o site) mandam: src/casca.tsx
  iniciarIdiomaETema();
  optUpper.checked = prefs.showUpper ?? true;
  optDigits.checked = prefs.showDigits ?? true;
  optAlign.checked = prefs.align ?? false;
  optTerrain.checked = prefs.showTerrain ?? true;

  for (let l = 0; l <= MAX_LEVEL; l += 2) {
    const s = document.createElement('span');
    s.textContent = String(l);
    ladder.append(s);
  }

  theme = readTheme(document.documentElement);
  const lerTema = (): void => {
    theme = readTheme(document.documentElement);
    lastHud = '';
    requestDraw();
  };
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', lerTema);
  // o botão de tema do topo troca o atributo data-tema da página
  new MutationObserver(lerTema).observe(document.documentElement, { attributes: true, attributeFilter: ['data-tema'] });

  setupDocument();
  setupWorld();
  setupLabels();
  mapStyle = prefs.style === 'map' ? 'map' : 'satellite';
  const renderStyle = (): void => {
    $('style-map').setAttribute('aria-pressed', String(mapStyle === 'map'));
    $('style-satellite').setAttribute('aria-pressed', String(mapStyle === 'satellite'));
  };
  const chooseStyle = (s: TileStyle): void => {
    mapStyle = s;
    renderStyle();
    savePrefs();
    requestDraw();
  };
  renderStyle();
  $('style-map').addEventListener('click', () => chooseStyle('map'));
  $('style-satellite').addEventListener('click', () => chooseStyle('satellite'));
  $('mode-explore').addEventListener('click', () => setMode(false));
  $('mode-edit').addEventListener('click', () => setMode(true));
  $('tool-select').addEventListener('click', () => setTool('select'));
  $('tool-brush').addEventListener('click', () => setTool('brush'));
  $('tool-eraser').addEventListener('click', () => setTool('eraser'));
  $('tool-label').addEventListener('click', () => setTool('label'));
  onLocaleChange(applyLocale);
  applyLocale();

  new ResizeObserver(resize).observe(stage);
  resize();

  // Começa mostrando o mundo inteiro; "Ver como no diagrama" leva à célula de 7 filhos da Fase 1.
  fitWorld(false);
  requestDraw();

  // Pedidos que chegam do passeio do castelo (DEC-P040): cada objeto do salão do cartógrafo abre
  // uma parte do Maker. /maker/#/novo (globo), #/mapa (quadro), #/satelite (luneta), #/editar (escrivaninha).
  const pedido = (): void => {
    const p = location.hash.replace(/^#\/?/, '');
    if (!p) return;
    // um .ekfr entregue por outro app ou pelo roteador do site (#/abrir/<chave>)
    const chave = chaveNoEndereco(location.hash);
    history.replaceState(null, '', location.pathname + location.search);
    if (chave) {
      void receber(chave).then((e) => (e ? abrirArquivo(e.bytes, e.nome) : showToast(t('file.handoffExpired'))));
      return;
    }
    if (p === 'novo') void gerarNovoMundo();
    else if (p === 'mapa') chooseStyle('map');
    else if (p === 'satelite') chooseStyle('satellite');
    else if (p === 'editar') setMode(true);
  };

  setupPainelETelaCheia();

  // a casca do Ekfrase: topo, rodapé, a entrada (login) e a nuvem. Os pedidos do endereço esperam o
  // mundo da última vez abrir (senão o "mundo novo" do globo cairia por baixo dele).
  void iniciarCasca({
    nome: () => session.store.getMeta().name,
    bytes: async () => session.bytes(await makePreview()),
    bytesRapido: () => session.bytes(),
    abrir: (bytes, avisar = true) => {
      session.open(bytes);
      if (avisar) showToast(t('doc.opened', { name: session.store.getMeta().name }));
      select(null);
      fitWorld(false);
    },
    marcarSalvo: () => session.markSaved(),
    marcarSujo: () => session.markDirty(),
    sujo: () => session.dirty,
    aviso: showToast,
    erro: showError,
    estadoNuvem: (texto) => ($('doc-cloud').textContent = texto),
    pronto: () => {
      pedido();
      addEventListener('hashchange', pedido);
    },
  });
}

// ---------- painel retrátil e tela cheia (FB-0001) ----------

const PAINEL_KEY = 'ekfrase.maker.painel';

/**
 * O painel da direita se recolhe (mais espaço para o mapa; lembrado neste aparelho) e a tela cheia
 * esconde topo, painel e rodapé: só o mapa e os controles dele (zoom, ferramentas, pincéis). F liga e
 * desliga a tela cheia; Esc sai.
 */
function setupPainelETelaCheia(): void {
  const app = document.querySelector<HTMLElement>('.app')!;
  const botaoPainel = $<HTMLButtonElement>('toggle-panel');
  const botaoTela = $<HTMLButtonElement>('toggle-fullscreen');
  const rotular = (b: HTMLElement, chave: string): void => {
    b.title = t(chave);
    b.setAttribute('aria-label', t(chave));
  };
  const mostrar = (): void => {
    const recolhido = app.classList.contains('painel-recolhido');
    const cheia = app.classList.contains('tela-cheia');
    botaoPainel.setAttribute('aria-pressed', String(recolhido));
    botaoTela.setAttribute('aria-pressed', String(cheia));
    rotular(botaoPainel, recolhido ? 'view.panelShow' : 'view.panelHide');
    rotular(botaoTela, cheia ? 'view.fullscreenExit' : 'view.fullscreen');
    dispatchEvent(new Event('resize'));
  };
  let recolhido = false;
  try {
    recolhido = localStorage.getItem(PAINEL_KEY) === 'recolhido';
  } catch {
    // sem armazenamento
  }
  app.classList.toggle('painel-recolhido', recolhido);
  botaoPainel.addEventListener('click', () => {
    const r = app.classList.toggle('painel-recolhido');
    try {
      localStorage.setItem(PAINEL_KEY, r ? 'recolhido' : 'aberto');
    } catch {
      // sem armazenamento
    }
    mostrar();
  });
  const telaCheia = (ligar: boolean): void => {
    app.classList.toggle('tela-cheia', ligar);
    if (ligar && !document.fullscreenElement) document.documentElement.requestFullscreen?.().catch(() => undefined);
    if (!ligar && document.fullscreenElement) void document.exitFullscreen?.().catch(() => undefined);
    mostrar();
  };
  botaoTela.addEventListener('click', () => telaCheia(!app.classList.contains('tela-cheia')));
  // o Esc do navegador sai da tela cheia: o editor acompanha
  document.addEventListener('fullscreenchange', () => {
    if (!document.fullscreenElement && app.classList.contains('tela-cheia')) telaCheia(false);
  });
  window.addEventListener('keydown', (e) => {
    const typing = e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement || e.target instanceof HTMLTextAreaElement;
    if (typing || e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key.toLowerCase() === 'f') telaCheia(!app.classList.contains('tela-cheia'));
    else if (e.key === 'Escape' && app.classList.contains('tela-cheia')) telaCheia(false);
  });
  onLocaleChange(mostrar);
  mostrar();
}

init();
