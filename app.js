/* History Atlas — Skyline view engine
   - 横向时间轴: 年 → px (pxPerYear)
   - 区域作为横向 swimlane, 文明块从 baseline 向上生长, 高度 = 影响力
   - 滚轮+拖动平移, Ctrl/Cmd+滚轮缩放 (以鼠标为中心)
*/

(() => {
'use strict';

// ———————————— CONFIG ————————————
const START_YEAR = -3500;
const END_YEAR   = 2025;
const SPAN       = END_YEAR - START_YEAR;

const DENSITY_MAP = {
  compact: 0.22,   // px per year
  normal:  0.42,
  open:    3.50,   // matches the zoom-in hard cap (see zoomStep / wheel zoom)
};

const BAND_HEIGHT = 190;   // each region band height (px)
const CIV_MAX_H   = 150;   // tallest civ block (w=5)
const CIV_MIN_H   = 46;    // shortest civ block (w=1)
const BASE_PAD    = 24;    // left/right padding inside stage
const EVENTS_BAND_H = 56;

// Ridgeline config
const RIDGE_BAND_H = 160;       // each region ridge band height
const RIDGE_STEP   = 5;          // sample every N years for curve
const RIDGE_MAX_H  = 130;        // max ridge height (when sum of w ~= 12)
const RIDGE_SCALE  = 10;         // scale denominator: pixel_h = (sumW / RIDGE_SCALE) * RIDGE_MAX_H (clamped)

// Spine config (vertical time axis, regions left/right)
const SPINE_DENSITY_MAP = {
  compact: 0.14,   // ~770px total
  normal:  0.28,   // ~1540px total
  open:    3.50,   // matches the zoom-in hard cap (see zoomStep / wheel zoom)
};
const SPINE_WIDTH      = 64;       // center spine track width (for ticks + events)
const SPINE_EVENT_GUTTER = 200;    // dedicated event-label zone between spine and civ columns
const SPINE_COL_W      = 170;      // each region column width
const SPINE_LANE_W     = 42;       // a civ leaf's base width unit; scaled by influence
// Sub-region (country/regime) columns — near-to-far from spine.
// `subs` lists which sub.zh values feed this column. China sits nearest the spine on the left.
const SPINE_SUBS_LEFT = [
  { key: 'china',    zh: '中国',     en: 'China',          subs: ['中国'],         region: 'eastasia', weight: 2 },
  { key: 'japan',    zh: '日本',     en: 'Japan',          subs: ['日本'],         region: 'eastasia', weight: 1 },
  { key: 'mongol',   zh: '蒙古',     en: 'Mongol',         subs: ['蒙古'],         region: 'eastasia', weight: 1 },
  { key: 'india',    zh: '印度',     en: 'India',          subs: ['印度'],         region: 'southasia', weight: 1 },
  { key: 'meso',     zh: '两河',     en: 'Mesopotamia',    subs: ['两河'],         region: 'westasia', weight: 1 },
  { key: 'egypt',    zh: '埃及',     en: 'Egypt',          subs: ['埃及'],         region: 'westasia', weight: 1 },
  { key: 'persia',   zh: '波斯',     en: 'Persia',         subs: ['波斯'],         region: 'westasia', weight: 1 },
  { key: 'islam',    zh: '伊斯兰',   en: 'Islamic',        subs: ['伊斯兰'],       region: 'westasia', weight: 1 },
  { key: 'byzanto',  zh: '拜占庭·奥斯曼', en: 'Byzantium · Ottoman', subs: ['拜占庭','奥斯曼'], region: 'westasia', weight: 1 },
  { key: 'wafrica',  zh: '西非',     en: 'West Africa',    subs: ['西非'],         region: 'africa', weight: 1 },
  { key: 'eafrica',  zh: '东非',     en: 'East Africa',    subs: ['东非'],         region: 'africa', weight: 1 },
  { key: 'safrica',  zh: '中南非',   en: 'Central · Southern Africa', subs: ['非洲'], region: 'africa', weight: 1 },
];
const SPINE_SUBS_RIGHT = [
  { key: 'rome',     zh: '罗马',     en: 'Rome',           subs: ['罗马'],         region: 'europe',  weight: 1 },
  { key: 'greece',   zh: '希腊',     en: 'Greece',         subs: ['希腊'],         region: 'europe',  weight: 1 },
  { key: 'france',   zh: '法国',     en: 'France',         subs: ['法国'],         region: 'europe',  weight: 1 },
  { key: 'germany',  zh: '德国',     en: 'Germany',        subs: ['德国'],         region: 'europe',  weight: 1 },
  { key: 'britain',  zh: '英国',     en: 'Britain',        subs: ['英国'],         region: 'europe',  weight: 1 },
  { key: 'spain',    zh: '西班牙',   en: 'Spain',          subs: ['西班牙'],       region: 'europe',  weight: 1 },
  { key: 'russia',   zh: '俄罗斯·苏联', en: 'Russia · USSR', subs: ['俄罗斯','苏联'], region: 'europe',  weight: 1 },
  { key: 'usa',      zh: '北美',     en: 'North America',  subs: ['北美'],         region: 'americas', weight: 1 },
  { key: 'meso-am',  zh: '中美洲',   en: 'Mesoamerica',    subs: ['中美洲'],       region: 'americas', weight: 1 },
  { key: 'south-am', zh: '南美',     en: 'South America',  subs: ['南美'],         region: 'americas', weight: 1 },
];

// Palette lookup -> solid + gradient variant
const PALETTE = () => window.HA_PALETTE;

// ———————————— STATE ————————————
const initView = window.TWEAKS.view || 'spine';
const initDensity = window.TWEAKS.density || 'normal';
const state = {
  pxPerYear: (initView === 'spine' ? SPINE_DENSITY_MAP : DENSITY_MAP)[initDensity] || 0.42,
  offsetX: 0,           // stage pan offset (px), negative = pushed left
  offsetY: 0,           // for spine view (vertical)
  theme: window.TWEAKS.theme || 'archival',
  density: initDensity,
  events: window.TWEAKS.events || 'on',
  lang: window.TWEAKS.lang || 'en',
  view: initView,  // 'spine' | 'ridge' | 'swimlane'
  regionFilter: 'all',
  search: '',
  dragging: false,
  dragStart: 0,
  dragStartOffset: 0,
};

// ———————————— I18N ————————————
const STR = {
  en: {
    hero_kicker: 'A Visual Almanac of Civilizations',
    hero_title_a: 'History', hero_title_b: 'Atlas',
    hero_title_zh_sub: 'W O R L D   H I S T O R Y   S K Y L I N E',
    hero_desc: 'Fifty civilizations rising and falling in parallel across five thousand years. Not a timeline, but a skyline — of kingdoms whose lives overlapped, whose peaks rose and faded together.',
    hero_cta: 'Enter the Atlas',
    mm_a: 'History', mm_b: 'Atlas',
    mm_sub: 'Skyline of Civilizations · 3500 BC — 2025',
    search_ph: 'Search civilizations…',
    tweaks_title: 'Tweaks',
    tw_theme: 'Visual Mode', tw_archival: 'Archival', tw_modern: 'Modern',
    tw_density: 'Time Density', tw_compact: 'Compact', tw_normal: 'Normal', tw_open: 'Open',
    tw_events: 'Global Events', tw_on: 'On', tw_off: 'Off',
    tw_view: 'View', tw_spine: 'Spine', tw_ridge: 'Ridgeline', tw_swim: 'Swimlane',
    dp_dates: 'Dates', dp_duration: 'Duration', dp_region: 'Region', dp_influence: 'Influence',
    dp_overview: 'Overview', dp_ach: 'Defining Achievements', dp_concurrent: 'Meanwhile, Elsewhere…',
    yrs: 'years',
    all: 'All',
    influence: ['—','minor','regional','major','dominant','world-defining'],
    bc: 'BC', ad: 'AD',
    kbd_hint_scroll_y: 'scroll',
    kbd_hint_scroll_x: 'pan sideways',
    kbd_hint_zoom: 'zoom',
    kbd_hint_drag: 'drag to pan',
    kbd_hint_arrows: 'arrow pan',
  },
  zh: {
    hero_kicker: '世界文明影像年鉴',
    hero_title_a: '历史', hero_title_b: '天际线',
    hero_title_zh_sub: '世 界 历 史 天 际 线',
    hero_desc: '五千年间，五十个文明并肩起落。这不是一条时间线，而是一道天际线——彼此交叠的王朝，各自攀上又褪下的巅峰。',
    hero_cta: '进入图册',
    mm_a: '历史', mm_b: '天际线',
    mm_sub: '世界文明之天际 · 公元前 3500 — 2025',
    search_ph: '搜索文明 / 王朝…',
    tweaks_title: '微调',
    tw_theme: '视觉风格', tw_archival: '古籍风', tw_modern: '现代风',
    tw_density: '时间密度', tw_compact: '紧凑', tw_normal: '标准', tw_open: '舒展',
    tw_events: '全球事件', tw_on: '开', tw_off: '关',
    tw_view: '视图', tw_spine: '脊椎', tw_ridge: '山脉', tw_swim: '泳道',
    dp_dates: '年代', dp_duration: '持续', dp_region: '区域', dp_influence: '影响力',
    dp_overview: '概述', dp_ach: '代表成就', dp_concurrent: '此时此刻的世界',
    yrs: '年',
    all: '全部',
    influence: ['—','局部','区域','重要','支配','定义时代'],
    bc: '公元前', ad: '公元',
    kbd_hint_scroll_y: '上下滚动',
    kbd_hint_scroll_x: '横向滚动',
    kbd_hint_zoom: '缩放',
    kbd_hint_drag: '拖拽移动',
    kbd_hint_arrows: '方向平移',
  }
};
const t = k => (STR[state.lang] && STR[state.lang][k]) || k;

function fmtYear(y) {
  if (y < 0) return state.lang === 'zh' ? `${t('bc')} ${Math.abs(y)}` : `${Math.abs(y)} BC`;
  return state.lang === 'zh' ? `${y}` : `${y}`;
}

// ———————————— DOM ————————————
const el = id => document.getElementById(id);
const stage = el('stage');
const stageInner = el('stageInner');
const axisScroll = el('axisScroll');
const regionLabels = el('regionLabels');
const tooltip = el('tooltip');
const detailPanel = el('detailPanel');
const searchInput = el('searchInput');
const searchResults = el('searchResults');
const regionFilterEl = el('regionFilter');
const tweaksEl = el('tweaks');
const nowIndicator = el('nowIndicator');
const nowYear = el('nowYear');

// ———————————— HELPERS ————————————
function yearToX(y) { return (y - START_YEAR) * state.pxPerYear; }
function xToYear(x) { return START_YEAR + x / state.pxPerYear; }
function yearToY(y) { return (y - START_YEAR) * state.pxPerYear; }
function yToYear(y) { return START_YEAR + y / state.pxPerYear; }
function civHeight(w) {
  const t = (w - 1) / 4;  // 0..1
  return CIV_MIN_H + (CIV_MAX_H - CIV_MIN_H) * t;
}
function clampOffset() {
  if (state.view === 'spine') {
    const h = stage.getBoundingClientRect().height;
    const maxY = 60;
    const minY = -(SPAN * state.pxPerYear - h + 60);
    if (state.offsetY > maxY) state.offsetY = maxY;
    if (state.offsetY < minY) state.offsetY = minY;
    const stageW = parseFloat(stageInner.style.width) || 0;
    const vpW = stage.getBoundingClientRect().width;
    const overflow = Math.max(0, stageW - vpW);
    const halfOverflow = overflow / 2;
    if (state.offsetX > halfOverflow) state.offsetX = halfOverflow;
    if (state.offsetX < -halfOverflow) state.offsetX = -halfOverflow;
    return;
  }
  const maxX = 0;
  const minX = -(SPAN * state.pxPerYear - window.innerWidth + BASE_PAD * 2);
  if (state.offsetX > maxX) state.offsetX = maxX;
  if (state.offsetX < minX) state.offsetX = minX;
}

// ———————————— RENDER ————————————
function renderRegionLabels() {
  regionLabels.innerHTML = '';
  if (state.view === 'spine') return;   // headers are inline in spine view
  const regions = window.HA_REGIONS;
  const stageTop = 66;
  const bh = state.view === 'ridge' ? RIDGE_BAND_H : BAND_HEIGHT;
  regions.forEach((r, i) => {
    const top = stageTop + EVENTS_BAND_H + i * bh + 10;
    const div = document.createElement('div');
    div.className = 'region-label';
    div.style.top = top + 'px';
    div.innerHTML = `<span class="rl-zh">${state.lang === 'zh' ? r.zh : r.en}</span><span class="rl-en">${state.lang === 'zh' ? r.en : r.zh}</span>`;
    regionLabels.appendChild(div);
  });
}

function renderAxis() {
  axisScroll.innerHTML = '';
  const width = SPAN * state.pxPerYear;
  axisScroll.style.width = width + 'px';

  // decide tick step based on density
  const ppY = state.pxPerYear;
  const majorStep = ppY >= 0.7 ? 100 : (ppY >= 0.35 ? 200 : 500);
  const minorStep = majorStep / 5;
  const eraStep   = 500;

  // minor ticks
  for (let y = Math.ceil(START_YEAR / minorStep) * minorStep; y <= END_YEAR; y += minorStep) {
    if (y % majorStep === 0) continue;
    const tick = document.createElement('div');
    tick.className = 'axis-tick minor';
    tick.style.left = yearToX(y) + 'px';
    axisScroll.appendChild(tick);
  }
  // major ticks + labels
  for (let y = Math.ceil(START_YEAR / majorStep) * majorStep; y <= END_YEAR; y += majorStep) {
    const tick = document.createElement('div');
    tick.className = 'axis-tick major';
    tick.style.left = yearToX(y) + 'px';
    axisScroll.appendChild(tick);

    const lb = document.createElement('div');
    lb.className = 'axis-label';
    lb.style.left = yearToX(y) + 'px';
    lb.textContent = fmtYear(y);
    axisScroll.appendChild(lb);
  }
  // era labels (italic, above)
  const eras = [
    { y: -3000, zh: '青铜时代', en: 'Bronze Age' },
    { y: -500,  zh: '轴心时代', en: 'Axial Age' },
    { y: 100,   zh: '古典帝国', en: 'Classical Empires' },
    { y: 900,   zh: '中世纪',   en: 'Middle Ages' },
    { y: 1500,  zh: '大航海',   en: 'Age of Exploration' },
    { y: 1850,  zh: '工业化',   en: 'Industrial Age' },
    { y: 1980,  zh: '数字时代', en: 'Digital Age' },
  ];
  eras.forEach(e => {
    const lb = document.createElement('div');
    lb.className = 'axis-label era';
    lb.style.left = yearToX(e.y) + 'px';
    lb.textContent = state.lang === 'zh' ? e.zh : e.en;
    axisScroll.appendChild(lb);
  });
}

// ———————————— MINIMAP + DENSITY HEATMAP ————————————
// A vertical strip (fixed top-left of stage) that doubles as:
//   1. A navigation minimap (click or drag the viewport box to scroll)
//   2. A density heatmap — each year's total weighted civ influence painted
//      as a gold glow: the more concurrent civilizations, the brighter/wider
//      the bar. Medieval and industrial eras glow like a skyline at night.
const MINIMAP_W = 46;
let _densityCache = null;
function getDensity() {
  if (_densityCache) return _densityCache;
  const d = new Float32Array(SPAN + 1);
  window.HA_CIVS.forEach(c => {
    const s = Math.max(0, Math.floor(c.s - START_YEAR));
    const e = Math.min(SPAN, Math.ceil(c.e - START_YEAR));
    const weight = c.w || 1;
    for (let i = s; i <= e; i++) d[i] += weight;
  });
  _densityCache = d;
  return d;
}

function buildMinimap() {
  let mm = document.getElementById('minimap');
  if (mm) return mm;
  mm = document.createElement('div');
  mm.id = 'minimap';
  mm.className = 'minimap';
  mm.innerHTML = `
    <div class="mm-label">DENSITY · ${state.lang === 'zh' ? '文明密度' : 'CIVILIZATIONS'}</div>
    <canvas class="mm-canvas" aria-label="Civilization density and navigation minimap"></canvas>
    <div class="mm-viewport" aria-hidden="true"></div>
    <div class="mm-tooltip" aria-hidden="true"></div>
  `;
  document.body.appendChild(mm);

  let dragging = false;
  const jumpToEvent = e => {
    const rect = mm.getBoundingClientRect();
    const inner = mm.querySelector('.mm-canvas').getBoundingClientRect();
    const rel = Math.max(0, Math.min(1, (e.clientY - inner.top) / inner.height));
    const year = START_YEAR + rel * SPAN;
    if (state.view === 'spine') {
      const sRect = stage.getBoundingClientRect();
      state.offsetY = sRect.height / 2 - yearToY(year);
    } else {
      const target = yearToX(year);
      state.offsetX = -(target - window.innerWidth / 2);
    }
    clampOffset();
    applyTransform();
    updateMinimap();
  };
  const showTooltip = e => {
    const inner = mm.querySelector('.mm-canvas').getBoundingClientRect();
    const rel = Math.max(0, Math.min(1, (e.clientY - inner.top) / inner.height));
    const year = Math.round(START_YEAR + rel * SPAN);
    const tip = mm.querySelector('.mm-tooltip');
    const d = getDensity();
    const idx = Math.max(0, Math.min(SPAN, Math.round(year - START_YEAR)));
    const count = window.HA_CIVS.filter(c => year >= c.s && year <= c.e).length;
    tip.innerHTML = `<b>${fmtYear(year)}</b><em>${count} ${state.lang === 'zh' ? '个并行文明' : 'parallel civs'}</em>`;
    tip.style.top = (e.clientY - inner.top) + 'px';
    tip.classList.add('open');
  };
  // Pointer events → one path for mouse + touch. On touch the minimap is hidden
  // anyway at ≤900px, but this keeps behavior consistent on tablets/trackpads.
  mm.addEventListener('pointerdown', e => {
    dragging = true;
    jumpToEvent(e);
    showTooltip(e);
    e.preventDefault();
  });
  mm.addEventListener('pointermove', e => { showTooltip(e); });
  mm.addEventListener('pointerleave', () => { mm.querySelector('.mm-tooltip').classList.remove('open'); });
  window.addEventListener('pointermove', e => { if (dragging) { jumpToEvent(e); showTooltip(e); } });
  window.addEventListener('pointerup', () => { dragging = false; });
  window.addEventListener('pointercancel', () => { dragging = false; });

  return mm;
}

function renderMinimapCanvas() {
  const mm = document.getElementById('minimap');
  if (!mm) return;
  const canvas = mm.querySelector('.mm-canvas');
  const rect = mm.getBoundingClientRect();
  // Reserve vertical room for the label (20px) + a small bottom margin
  const H = Math.max(120, rect.height - 30);
  const W = MINIMAP_W;
  canvas.style.width = W + 'px';
  canvas.style.height = H + 'px';
  const dpr = window.devicePixelRatio || 1;
  canvas.width = W * dpr;
  canvas.height = H * dpr;
  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);

  // Bin density into H rows
  const d = getDensity();
  const rows = new Float32Array(H);
  const bin = SPAN / H;
  for (let r = 0; r < H; r++) {
    const a = Math.floor(r * bin);
    const b = Math.floor((r + 1) * bin);
    let sum = 0, cnt = 0;
    for (let i = a; i < b && i < d.length; i++) { sum += d[i]; cnt++; }
    rows[r] = cnt ? sum / cnt : 0;
  }
  const max = Math.max(...rows) || 1;

  ctx.clearRect(0, 0, W, H);

  // Dark track
  ctx.fillStyle = 'rgba(10,8,4,0.35)';
  ctx.fillRect(0, 0, W, H);

  // Era bands (subtle horizontal tinting so you can sense "medieval" vs "modern")
  const eras = [
    { y0: -3500, y1: -1200, col: 'rgba(180,120,70,0.04)' },    // Bronze
    { y0: -1200, y1: -300,  col: 'rgba(200,170,90,0.04)' },    // Axial
    { y0: -300,  y1: 500,   col: 'rgba(200,160,80,0.06)' },    // Classical
    { y0: 500,   y1: 1400,  col: 'rgba(130,150,180,0.05)' },   // Medieval
    { y0: 1400,  y1: 1800,  col: 'rgba(170,140,200,0.05)' },   // Exploration
    { y0: 1800,  y1: 2025,  col: 'rgba(200,100,100,0.06)' },   // Modern
  ];
  eras.forEach(e => {
    const yA = (e.y0 - START_YEAR) / SPAN * H;
    const yB = (e.y1 - START_YEAR) / SPAN * H;
    ctx.fillStyle = e.col;
    ctx.fillRect(0, yA, W, yB - yA);
  });

  // Theme-aware canvas palette — archival uses warm gold, modern uses cool blue.
  const isModern = document.body.dataset.theme === 'modern';
  const bar      = isModern ? '111,179,217' : '200,162,76';
  const axisBar  = isModern ? '111,179,217' : '200,162,76';
  const tickBar  = isModern ? '190,210,230' : '220,200,150';
  const labelBar = isModern ? '170,195,225' : '200,180,130';

  // Density bars — drawn from LEFT edge of the strip toward the right.
  // Gamma curve so moderate-density eras don't flatten out.
  for (let r = 0; r < H; r++) {
    const v = rows[r] / max;  // 0..1
    const gv = Math.pow(v, 0.55);
    const barW = Math.max(1, Math.round(gv * (W - 4)));
    const alpha = 0.18 + gv * 0.78;
    ctx.fillStyle = `rgba(${bar}, ${alpha.toFixed(3)})`;
    ctx.fillRect(2, r, barW, 1);
  }

  // Era demarcation ticks (thin horizontal lines + abbreviated markers)
  const eraMarks = [
    { y: -3000, label: 'BRZ' },
    { y: -500,  label: 'AXL' },
    { y: 0,     label: '0'   },
    { y: 500,   label: 'MED' },
    { y: 1500,  label: 'EXP' },
    { y: 1850,  label: 'IND' },
  ];
  ctx.font = '8px "JetBrains Mono", monospace';
  eraMarks.forEach(m => {
    const y = (m.y - START_YEAR) / SPAN * H;
    ctx.strokeStyle = m.y === 0 ? `rgba(${axisBar},0.75)` : `rgba(${tickBar},0.20)`;
    ctx.lineWidth = 1;
    if (m.y === 0) { ctx.setLineDash([2, 2]); } else { ctx.setLineDash([]); }
    ctx.beginPath();
    ctx.moveTo(0, y + 0.5);
    ctx.lineTo(W, y + 0.5);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = m.y === 0 ? `rgba(${axisBar},0.85)` : `rgba(${labelBar},0.42)`;
    ctx.fillText(m.label, 2, y - 1.5);
  });
}

function updateMinimap() {
  const mm = document.getElementById('minimap');
  if (!mm) return;
  if (state.view !== 'spine') {
    mm.classList.add('hidden');
    return;
  }
  mm.classList.remove('hidden');
  const viewport = mm.querySelector('.mm-viewport');
  const canvas = mm.querySelector('.mm-canvas');
  const canvasRect = canvas.getBoundingClientRect();
  const mmRect = mm.getBoundingClientRect();
  const sRect = stage.getBoundingClientRect();
  const totalH = SPAN * state.pxPerYear;
  // what year range is visible?
  const topYear = Math.max(START_YEAR, (-state.offsetY) / state.pxPerYear + START_YEAR);
  const botYear = Math.min(END_YEAR, (-state.offsetY + sRect.height) / state.pxPerYear + START_YEAR);
  const relT = (topYear - START_YEAR) / SPAN;
  const relB = (botYear - START_YEAR) / SPAN;
  // offset viewport within the canvas area (canvas top relative to mm top)
  const canvasTopOffset = canvasRect.top - mmRect.top;
  viewport.style.top  = (canvasTopOffset + relT * canvasRect.height) + 'px';
  viewport.style.height = Math.max(6, (relB - relT) * canvasRect.height) + 'px';
}

function refreshMinimap() {
  buildMinimap();
  renderMinimapCanvas();
  updateMinimap();
  // Update label text for current language
  const lb = document.querySelector('#minimap .mm-label');
  if (lb) lb.textContent = 'DENSITY · ' + (state.lang === 'zh' ? '文明密度' : 'CIVILIZATIONS');
}

function renderGrid() {
  const grid = document.createElement('div');
  grid.className = 'grid-lines';
  grid.id = 'gridLines';
  const bh = state.view === 'ridge' ? RIDGE_BAND_H : BAND_HEIGHT;
  const h = EVENTS_BAND_H + window.HA_REGIONS.length * bh;
  grid.style.height = h + 'px';
  const majorStep = 500;
  const centStep = 100;
  for (let y = Math.ceil(START_YEAR / centStep) * centStep; y <= END_YEAR; y += centStep) {
    const v = document.createElement('div');
    const isMaj = y % majorStep === 0;
    v.className = 'grid-v' + (isMaj ? ' major' : ' century');
    v.style.left = yearToX(y) + 'px';
    grid.appendChild(v);
  }
  // year 0 line (prominent)
  const zero = document.createElement('div');
  zero.className = 'grid-v major';
  zero.style.left = yearToX(0) + 'px';
  zero.style.background = 'var(--gold-dim)';
  zero.style.opacity = '0.5';
  grid.appendChild(zero);
  return grid;
}

function renderRegions() {
  const regions = window.HA_REGIONS;
  const frag = document.createDocumentFragment();
  regions.forEach((r, i) => {
    const band = document.createElement('div');
    band.className = 'region-band';
    band.dataset.region = r.id;
    band.style.top = (EVENTS_BAND_H + i * BAND_HEIGHT) + 'px';
    band.style.height = BAND_HEIGHT + 'px';
    band.style.width = (SPAN * state.pxPerYear) + 'px';

    // baseline near bottom of band (leaves room above for skyline growth)
    const baseline = document.createElement('div');
    baseline.className = 'region-baseline';
    baseline.style.bottom = '12px';
    band.appendChild(baseline);

    // civs in this region
    const civs = window.HA_CIVS.filter(c => c.r === r.id);
    // multi-row packing within band: bottom tier for main, stacked tiers for overlaps
    const sorted = [...civs].sort((a, b) => a.s - b.s);
    // assign row: greedy first-fit
    const rowEnds = [];  // rowEnds[i] = end year of last civ in row i
    sorted.forEach(c => {
      let row = -1;
      for (let i = 0; i < rowEnds.length; i++) {
        if (c.s >= rowEnds[i] + 20) { row = i; break; }
      }
      if (row === -1) { row = rowEnds.length; rowEnds.push(0); }
      rowEnds[row] = c.e;
      c._row = row;
    });

    const rowCount = Math.max(rowEnds.length, 1);
    // available vertical space inside band (above baseline)
    const avail = BAND_HEIGHT - 24;   // 12px bottom + 12px top breathing
    // for each row, compute horizontal strip it occupies. row 0 is bottom (tallest)
    // each row gets a vertical slot; tall civs (high w) grow upward more.
    sorted.forEach(c => {
      const x = yearToX(c.s);
      const w = (c.e - c.s) * state.pxPerYear;
      if (w < 2) return;
      // height based on influence AND compressed by row if multiple rows
      const rawH = civHeight(c.w);
      const rowCompress = rowCount > 1 ? Math.max(0.55, 1 - c._row * 0.22) : 1;
      const h = Math.min(rawH * rowCompress, avail - c._row * 12);
      // stacked: row 0 bottom, row 1 shifted up by some amount
      const bottomOffset = 12 + c._row * 8;  // slight stagger so rows peek

      const block = document.createElement('div');
      block.className = 'civ-block';
      block.dataset.id = c.id;
      block.style.left = x + 'px';
      block.style.width = w + 'px';
      block.style.height = h + 'px';
      block.style.bottom = bottomOffset + 'px';

      const color = PALETTE()[c.c] || PALETTE().sand;
      // gradient for depth (darker at base, slight lift at top)
      block.style.background = `linear-gradient(180deg, ${color} 0%, ${shade(color, -18)} 100%)`;
      block.style.color = color;  // used by ::after glow
      block.style.borderLeft = `1px solid ${shade(color, 20)}`;
      block.style.borderRight = `1px solid ${shade(color, -30)}`;

      if (h < 28) block.classList.add('short');
      else if (w < 70 && h > 60) block.classList.add('tall');

      const name = state.lang === 'zh' ? c.n.zh : c.n.en;
      const dateStr = `${fmtYear(c.s)} — ${fmtYear(c.e)}`;
      if (h >= 28) {
        block.innerHTML = `<span class="civ-name">${name}</span><span class="civ-dates">${dateStr}</span>`;
      }
      // tooltip
      block.dataset.name = name;
      block.dataset.sub = state.lang === 'zh' ? c.sub.zh : c.sub.en;
      block.dataset.dates = dateStr;
      block.dataset.dur = (c.e - c.s);
      band.appendChild(block);
    });

    frag.appendChild(band);
  });
  return frag;
}

// ———————————— RIDGELINE (profile mountains) ————————————
// For each region, compute at each sampled year: sum of active civs' influence
// The sum becomes the curve height. Peaks are labeled with the dominant civ.
function buildRidgeSamples(civs) {
  const samples = [];  // { year, sumW, civs: [civ,…] }
  for (let y = START_YEAR; y <= END_YEAR; y += RIDGE_STEP) {
    const active = civs.filter(c => y >= c.s && y <= c.e);
    let sumW = 0;
    active.forEach(c => { sumW += c.w; });
    samples.push({ year: y, sumW, civs: active });
  }
  return samples;
}

function smoothSamples(samples, radius = 2) {
  // simple box smoothing over sumW (keeps peaks but softens)
  const out = samples.map(s => ({ ...s }));
  for (let i = 0; i < samples.length; i++) {
    let sum = 0, cnt = 0;
    for (let k = -radius; k <= radius; k++) {
      const j = i + k;
      if (j < 0 || j >= samples.length) continue;
      sum += samples[j].sumW; cnt++;
    }
    out[i].smoothW = sum / cnt;
  }
  return out;
}

function findPeakLabels(samples, civs) {
  // Identify peaks: local maxima in smoothW, at least ~6 samples apart
  const peaks = [];
  const minGap = 8;  // samples
  for (let i = 2; i < samples.length - 2; i++) {
    const a = samples[i].smoothW;
    if (a < 1.5) continue;
    if (a > samples[i-1].smoothW && a >= samples[i+1].smoothW &&
        a > samples[i-2].smoothW && a >= samples[i+2].smoothW) {
      // dominant civ at this sample: highest w, then longest duration
      const sample = samples[i];
      if (!sample.civs.length) continue;
      const dom = [...sample.civs].sort((x, y) =>
        y.w - x.w || ((y.e - y.s) - (x.e - x.s)))[0];
      if (peaks.length && i - peaks[peaks.length-1].idx < minGap) {
        // keep the taller of the two; replace if current is taller
        if (a > peaks[peaks.length-1].h) peaks[peaks.length-1] = { idx: i, sample, dom, h: a };
      } else {
        peaks.push({ idx: i, sample, dom, h: a });
      }
    }
  }
  return peaks;
}

function renderRidgeline() {
  const regions = window.HA_REGIONS;
  const frag = document.createDocumentFragment();
  const width = SPAN * state.pxPerYear;

  regions.forEach((r, i) => {
    const band = document.createElement('div');
    band.className = 'region-band ridge-band';
    band.dataset.region = r.id;
    band.style.top = (EVENTS_BAND_H + i * RIDGE_BAND_H) + 'px';
    band.style.height = RIDGE_BAND_H + 'px';
    band.style.width = width + 'px';

    const civs = window.HA_CIVS.filter(c => c.r === r.id);
    const raw = buildRidgeSamples(civs);
    const samples = smoothSamples(raw, 2);

    // Build polyline for curve
    const baselineY = RIDGE_BAND_H - 14;  // baseline near bottom (leave gutter for axis)

    // SVG covering the entire band (width can be very large — but absolute pos SVG is fine in Chrome up to ~32k)
    const svgNS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(svgNS, 'svg');
    svg.setAttribute('width', width);
    svg.setAttribute('height', RIDGE_BAND_H);
    svg.setAttribute('viewBox', `0 0 ${width} ${RIDGE_BAND_H}`);
    svg.setAttribute('preserveAspectRatio', 'none');
    svg.style.position = 'absolute';
    svg.style.top = '0';
    svg.style.left = '0';
    svg.style.pointerEvents = 'none';

    // Define a region-tinted gradient
    const gradId = `grad-${r.id}`;
    const defs = document.createElementNS(svgNS, 'defs');
    const lg = document.createElementNS(svgNS, 'linearGradient');
    lg.setAttribute('id', gradId);
    lg.setAttribute('x1', '0'); lg.setAttribute('y1', '0');
    lg.setAttribute('x2', '0'); lg.setAttribute('y2', '1');
    const regionColor = regionColorFor(r.id);
    const stops = [
      [0, regionColor, 0.55],
      [0.6, regionColor, 0.22],
      [1, regionColor, 0.04],
    ];
    stops.forEach(([o, col, a]) => {
      const s = document.createElementNS(svgNS, 'stop');
      s.setAttribute('offset', o);
      s.setAttribute('stop-color', col);
      s.setAttribute('stop-opacity', a);
      lg.appendChild(s);
    });
    defs.appendChild(lg);
    svg.appendChild(defs);

    // Build smooth path via cubic bezier approximation of samples
    const pts = samples.map(s => {
      const x = yearToX(s.year);
      const h = Math.min(RIDGE_MAX_H, (s.smoothW / RIDGE_SCALE) * RIDGE_MAX_H);
      const y = baselineY - h;
      return [x, y, s];
    });

    if (pts.length) {
      // fill area path
      let d = `M ${pts[0][0]} ${baselineY} L ${pts[0][0]} ${pts[0][1]}`;
      for (let k = 1; k < pts.length; k++) {
        // smooth using midpoint
        const [x0, y0] = pts[k-1];
        const [x1, y1] = pts[k];
        const cx = (x0 + x1) / 2;
        d += ` Q ${x0} ${y0} ${cx} ${(y0 + y1) / 2}`;
      }
      // last segment to final point
      d += ` L ${pts[pts.length-1][0]} ${pts[pts.length-1][1]}`;
      d += ` L ${pts[pts.length-1][0]} ${baselineY} Z`;

      const area = document.createElementNS(svgNS, 'path');
      area.setAttribute('d', d);
      area.setAttribute('fill', `url(#${gradId})`);
      svg.appendChild(area);

      // stroke path (top edge only) — reuse but open path
      let sd = `M ${pts[0][0]} ${pts[0][1]}`;
      for (let k = 1; k < pts.length; k++) {
        const [x0, y0] = pts[k-1];
        const [x1, y1] = pts[k];
        const cx = (x0 + x1) / 2;
        sd += ` Q ${x0} ${y0} ${cx} ${(y0 + y1) / 2}`;
      }
      sd += ` L ${pts[pts.length-1][0]} ${pts[pts.length-1][1]}`;
      const stroke = document.createElementNS(svgNS, 'path');
      stroke.setAttribute('d', sd);
      stroke.setAttribute('fill', 'none');
      stroke.setAttribute('stroke', regionColor);
      stroke.setAttribute('stroke-opacity', '0.82');
      stroke.setAttribute('stroke-width', '1.4');
      stroke.setAttribute('stroke-linejoin', 'round');
      svg.appendChild(stroke);

      // baseline
      const bl = document.createElementNS(svgNS, 'line');
      bl.setAttribute('x1', 0); bl.setAttribute('x2', width);
      bl.setAttribute('y1', baselineY); bl.setAttribute('y2', baselineY);
      bl.setAttribute('stroke', 'var(--line-mid)');
      bl.setAttribute('stroke-width', '1');
      svg.appendChild(bl);
    }

    band.appendChild(svg);

    // Peak labels as HTML (so they can sit above SVG & be interactive)
    const peaks = findPeakLabels(samples, civs);
    peaks.forEach(p => {
      const x = yearToX(p.sample.year);
      const h = Math.min(RIDGE_MAX_H, (p.sample.smoothW / RIDGE_SCALE) * RIDGE_MAX_H);
      const y = baselineY - h;
      const name = state.lang === 'zh' ? p.dom.n.zh : p.dom.n.en;
      const tick = document.createElement('div');
      tick.className = 'ridge-peak';
      tick.style.left = x + 'px';
      tick.style.top = Math.max(4, y - 20) + 'px';
      const color = PALETTE()[p.dom.c] || PALETTE().sand;
      tick.innerHTML = `<span class="ridge-peak-dot" style="background:${color}"></span><span class="ridge-peak-name">${name}</span>`;
      tick.dataset.id = p.dom.id;
      band.appendChild(tick);
    });

    // Interactive hit layer — invisible div over the whole band to catch clicks/hovers
    const hit = document.createElement('div');
    hit.className = 'ridge-hit';
    hit.style.width = width + 'px';
    hit.dataset.regionId = r.id;
    band.appendChild(hit);

    frag.appendChild(band);
  });

  return frag;
}

function regionColorFor(regionId) {
  const map = {
    eastasia:  '#B24A38',  // vermillion
    southasia: '#4E6E4A',  // jade
    westasia:  '#A87C3E',  // bronze
    europe:    '#3E5E87',  // lapis
    africa:    '#B8772A',  // amber
    americas:  '#5E3A5E',  // plum
  };
  // in modern theme, cool them slightly
  if (state.theme === 'modern') {
    const m = {
      eastasia: '#D9604B', southasia: '#6E9A68', westasia: '#C79A57',
      europe: '#5E86B8', africa: '#D9932E', americas: '#8A5A8A',
    };
    return m[regionId] || map[regionId];
  }
  return map[regionId] || '#888';
}

// ———————————— SPINE VIEW (vertical time, regions flank a center spine) ————————————
// Render fixed column headers (top strip) for spine view
// Region color key mapping (used for sub headers + leaves)
const REGION_COLOR_KEY = { eastasia: 'crimson', southasia: 'jade', westasia: 'bronze', europe: 'lapis', africa: 'amber', americas: 'plum' };

// Minimum lane width target for spine columns — prevents labels becoming unreadably thin
// when a column packs many concurrent civilizations.
const SPINE_MIN_LANE_W  = 26;
const SPINE_LANE_GAP    = 3;
const SPINE_COL_MARGIN  = 10;

function _desiredColWidth(spec) {
  const civs = (window.HA_CIVS || []).filter(c => spec.subs.includes(c.sub.zh));
  const { laneCount } = packCivLanes(civs);
  return laneCount * (SPINE_MIN_LANE_W + SPINE_LANE_GAP) + SPINE_COL_MARGIN;
}

// Compute the total stage width and per-side budget. When the natural column widths
// fit inside the viewport, the stage matches viewport; otherwise the stage grows wider
// (horizontal scroll) so no column is starved.
function computeSpineDims(viewportW) {
  const leftReq  = SPINE_SUBS_LEFT.reduce((s, spec) => s + _desiredColWidth(spec), 0);
  const rightReq = SPINE_SUBS_RIGHT.reduce((s, spec) => s + _desiredColWidth(spec), 0);
  const sideReq  = Math.max(leftReq, rightReq);
  const AVAIL_HALF_VP = (viewportW - SPINE_WIDTH) / 2 - SPINE_EVENT_GUTTER - 20;
  const useSide  = Math.max(280, AVAIL_HALF_VP, sideReq);
  const stageW   = Math.max(viewportW, useSide * 2 + SPINE_WIDTH + SPINE_EVENT_GUTTER * 2 + 40);
  return { stageW, centerX: stageW / 2, useSide };
}

// Compute layout for sub-columns on one side. Each column gets at least its desired
// min-lane-driven width; any leftover budget is distributed proportionally by spec.weight.
function computeSubColLayout(specs, side, stageW, useSide) {
  const centerX = stageW / 2;
  const COL_OFFSET = SPINE_WIDTH / 2 + SPINE_EVENT_GUTTER;
  const desired = specs.map(_desiredColWidth);
  const totalDesired = desired.reduce((a, b) => a + b, 0);
  const extra = Math.max(0, useSide - totalDesired);
  const totalWeight = specs.reduce((s, c) => s + c.weight, 0);
  const widths = specs.map((spec, i) =>
    Math.floor(desired[i] + extra * (spec.weight / totalWeight))
  );
  const out = [];
  let cursor = 0;
  specs.forEach((spec, i) => {
    const w = widths[i];
    const left = side === 'left'
      ? centerX - COL_OFFSET - cursor - w
      : centerX + COL_OFFSET + cursor;
    out.push({ spec, width: w, left });
    cursor += w;
  });
  return out;
}

function renderSpineHeaders() {
  const viewportW = stage.getBoundingClientRect().width;
  const { stageW, centerX, useSide } = computeSpineDims(viewportW);

  const oldHdr = document.getElementById('spineHeadersBar');
  if (oldHdr) oldHdr.remove();
  if (state.view !== 'spine') return;

  const bar = document.createElement('div');
  bar.className = 'spine-headers-bar';
  bar.id = 'spineHeadersBar';
  bar.style.width = stageW + 'px';

  const layoutLeft  = computeSubColLayout(SPINE_SUBS_LEFT,  'left',  stageW, useSide);
  const layoutRight = computeSubColLayout(SPINE_SUBS_RIGHT, 'right', stageW, useSide);

  const mkHeader = (item, side) => {
    const { spec, width, left } = item;
    const h = document.createElement('div');
    h.className = 'spine-header-cell ' + side;
    h.dataset.region = spec.region;
    h.style.width = width + 'px';
    h.style.left = left + 'px';
    const dot = PALETTE()[REGION_COLOR_KEY[spec.region]] || '#888';
    const labelTxt = state.lang === 'zh' ? spec.zh : spec.en;
    // Encourage wrapping on the · separator for compound names like 拜占庭·奥斯曼 / Russia · USSR
    const labelHTML = labelTxt
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/·/g, '·<wbr>');
    h.innerHTML = `<span class="sh-dot" style="background:${dot}"></span><span class="sh-primary">${labelHTML}</span>`;
    bar.appendChild(h);
  };
  layoutLeft.forEach(it => mkHeader(it, 'left'));
  layoutRight.forEach(it => mkHeader(it, 'right'));

  // center spine label
  const spineLabel = document.createElement('div');
  spineLabel.className = 'spine-header-center';
  spineLabel.style.left = (centerX - SPINE_WIDTH / 2) + 'px';
  spineLabel.style.width = SPINE_WIDTH + 'px';
  spineLabel.innerHTML = `<span>${state.lang === 'zh' ? '纪年' : 'YEAR'}</span>`;
  bar.appendChild(spineLabel);

  stage.appendChild(bar);
}

// Assign civs to lanes within a region column (greedy first-fit on start year).
// Seamless transitions (e.g. 清 1644-1912 → 中华民国 1912-1949) should share a lane.
function packCivLanes(civs, maxLanes = 4) {
  const sorted = [...civs].sort((a, b) => a.s - b.s);
  const laneEnds = [];
  const laneById = {};
  sorted.forEach(c => {
    let lane = -1;
    // Prefer the lane of a declared predecessor (geographic/political successor).
    if (c.pred && laneById[c.pred] !== undefined) {
      const pLane = laneById[c.pred];
      if (c.s >= laneEnds[pLane] - 2) lane = pLane;
    }
    if (lane === -1) {
      for (let i = 0; i < laneEnds.length; i++) {
        if (c.s >= laneEnds[i] - 2) { lane = i; break; }
      }
    }
    if (lane === -1) { lane = laneEnds.length; laneEnds.push(0); }
    laneEnds[lane] = c.e;
    c._lane = lane;
    laneById[c.id] = lane;
  });
  return { sorted, laneCount: Math.max(laneEnds.length, 1) };
}

// Pick a label that fits inside a leaf. Tries full name at progressively smaller fonts,
// then a 2-char abbreviation. Never returns null — every leaf gets a label.
function pickLeafLabel(name, height, laneW, lang) {
  // Size tiers: [cssClass, perCharSize, padding]
  // perCharSize for vertical = line stacking height per glyph.
  // perCharSize for horizontal = glyph advance width.
  const vertTiers = lang === 'zh'
    ? [['v-lg', 13, 8], ['v-md', 11, 6], ['v-sm', 9, 4], ['v-xs', 8, 3]]
    : [['v-md', 8, 6], ['v-sm', 7, 4]];
  const horizTiers = lang === 'zh'
    ? [['h-lg', 11, 10, 12], ['h-md', 9, 8, 10], ['h-sm', 8, 7, 9]]
    : [['h-md', 6, 8, 10], ['h-sm', 5, 6, 9]];
  const preferVert = laneW <= 56;

  const tryVert = (text) => {
    for (const [cls, cs, pad] of vertTiers) {
      if (height >= text.length * cs + pad) return { orient: 'vert', cls, text };
    }
    return null;
  };
  const tryHoriz = (text) => {
    for (const [cls, cw, padW, minH] of horizTiers) {
      if (laneW >= text.length * cw + padW && height >= minH) return { orient: 'horiz', cls, text };
    }
    return null;
  };

  // 1. Full name in preferred orientation, then fall back to the other.
  let r = preferVert ? (tryVert(name) || tryHoriz(name)) : (tryHoriz(name) || tryVert(name));
  if (r) return r;

  // 2. Abbreviation: first ·/・-segment truncated to 2 chars (zh) or first word (en).
  const abbr = lang === 'zh'
    ? (name.split(/[·・•]/)[0] || name).slice(0, 2)
    : name.split(/\s+/)[0].slice(0, 5);
  r = preferVert ? (tryVert(abbr) || tryHoriz(abbr)) : (tryHoriz(abbr) || tryVert(abbr));
  if (r) return Object.assign(r, { abbreviated: true });

  // 3. Absolute last resort — 1 char, guaranteed to fit in any block ≥ 8px tall.
  const mini = lang === 'zh' ? name.slice(0, 1) : name.slice(0, 2);
  return {
    orient: preferVert ? 'vert' : 'horiz',
    cls: preferVert ? 'v-xs' : 'h-sm',
    text: mini,
    abbreviated: true
  };
}

function renderSpine() {
  const wrap = document.createElement('div');
  wrap.className = 'spine-wrap';
  const totalH = SPAN * state.pxPerYear;
  wrap.style.height = (totalH + 80) + 'px';

  const viewportW = stage.getBoundingClientRect().width;
  const { stageW, centerX, useSide } = computeSpineDims(viewportW);
  wrap.style.width = stageW + 'px';
  const layoutLeft  = computeSubColLayout(SPINE_SUBS_LEFT,  'left',  stageW, useSide);
  const layoutRight = computeSubColLayout(SPINE_SUBS_RIGHT, 'right', stageW, useSide);

  // Center spine (vertical axis)
  const spine = document.createElement('div');
  spine.className = 'spine-axis';
  spine.style.left = (centerX - SPINE_WIDTH / 2) + 'px';
  spine.style.width = SPINE_WIDTH + 'px';
  spine.style.top = '0';
  spine.style.height = totalH + 'px';
  wrap.appendChild(spine);

  // Spine ticks + year labels
  const majorStep = state.pxPerYear >= 0.7 ? 100 : (state.pxPerYear >= 0.35 ? 200 : 500);
  const minorStep = majorStep / 5;
  for (let y = Math.ceil(START_YEAR / minorStep) * minorStep; y <= END_YEAR; y += minorStep) {
    if (y % majorStep === 0) continue;
    const tk = document.createElement('div');
    tk.className = 'spine-tick minor';
    tk.style.top = yearToY(y) + 'px';
    spine.appendChild(tk);
  }
  for (let y = Math.ceil(START_YEAR / majorStep) * majorStep; y <= END_YEAR; y += majorStep) {
    const tk = document.createElement('div');
    tk.className = 'spine-tick major';
    tk.style.top = yearToY(y) + 'px';
    spine.appendChild(tk);
    const lb = document.createElement('div');
    lb.className = 'spine-year-label';
    lb.style.top = yearToY(y) + 'px';
    lb.textContent = fmtYear(y);
    spine.appendChild(lb);
  }
  // year zero prominence
  const zero = document.createElement('div');
  zero.className = 'spine-zero';
  zero.style.top = yearToY(0) + 'px';
  zero.innerHTML = `<span>${state.lang === 'zh' ? '公元元年' : 'YEAR 0'}</span>`;
  spine.appendChild(zero);

  // Era labels on the spine
  const eras = [
    { y: -3000, zh: '青铜时代', en: 'Bronze Age' },
    { y: -500,  zh: '轴心时代', en: 'Axial Age' },
    { y: 100,   zh: '古典帝国', en: 'Classical Empires' },
    { y: 900,   zh: '中世纪',   en: 'Middle Ages' },
    { y: 1500,  zh: '大航海',   en: 'Age of Exploration' },
    { y: 1850,  zh: '工业化',   en: 'Industrial Age' },
    { y: 1980,  zh: '数字时代', en: 'Digital Age' },
  ];
  eras.forEach(e => {
    const lb = document.createElement('div');
    lb.className = 'spine-era';
    lb.style.top = yearToY(e.y) + 'px';
    lb.textContent = state.lang === 'zh' ? e.zh : e.en;
    spine.appendChild(lb);
  });

  // Sub-region columns — left and right
  const buildSide = (layout, side) => {
    layout.forEach(item => {
      const { spec, width: COL_W, left: colLeft } = item;
      const civs = window.HA_CIVS.filter(c => spec.subs.includes(c.sub.zh));
      if (!civs.length) return;
      const { sorted, laneCount } = packCivLanes(civs);

      const col = document.createElement('div');
      col.className = 'spine-col';
      col.dataset.region = spec.region;
      col.dataset.sub = spec.key;
      col.dataset.side = side;
      col.style.width = COL_W + 'px';
      col.style.top = '0';
      col.style.height = totalH + 'px';
      col.style.left = colLeft + 'px';

      // Inner lanes container
      const lanesWrap = document.createElement('div');
      lanesWrap.className = 'spine-lanes';
      lanesWrap.style.top = '0';
      lanesWrap.style.height = totalH + 'px';
      col.appendChild(lanesWrap);

      // Available lane width: COL_W minus a small outer margin
      const innerW = COL_W - 8;
      const laneW  = Math.min(SPINE_LANE_W, Math.floor(innerW / Math.max(1, laneCount)) - 3);

      sorted.forEach(c => {
        const top = yearToY(c.s);
        const height = Math.max(4, (c.e - c.s) * state.pxPerYear);
        // Lane 0 = nearest the spine
        let leftPx;
        if (side === 'left') {
          // near-spine edge of the column is the RIGHT edge. Lane 0 hugs right.
          leftPx = (innerW - laneW) - c._lane * (laneW + 3);
        } else {
          // near-spine edge is the LEFT edge. Lane 0 hugs left.
          leftPx = 4 + c._lane * (laneW + 3);
        }

        const leaf = document.createElement('div');
        leaf.className = 'spine-leaf';
        leaf.dataset.id = c.id;
        leaf.style.top = top + 'px';
        leaf.style.height = height + 'px';
        leaf.style.width = laneW + 'px';
        leaf.style.left = leftPx + 'px';
        const color = PALETTE()[c.c] || PALETTE().sand;
        const direction = side === 'left' ? 'to left' : 'to right';
        leaf.style.background = `linear-gradient(${direction}, ${color} 0%, ${shade(color, -22)} 100%)`;
        leaf.dataset.side = side;
        leaf.dataset.w = c.w;
        if (c.w >= 4) leaf.classList.add('wide');
        if (height < 22) leaf.classList.add('short');

        const name = state.lang === 'zh' ? c.n.zh : c.n.en;
        const startStr = c.s < 0 ? `−${Math.abs(c.s)}` : `${c.s}`;
        const dates = `${fmtYear(c.s)} — ${fmtYear(c.e)}`;
        // Plan D: adaptive font sizing + abbreviation fallback. Every block carries its own label.
        // Full name always available via dataset.name → tooltip / detail panel.
        // Effective height ≥ 11 because CSS padding + min-content will expand tiny blocks visually.
        const effH = Math.max(height, 11);
        const label = pickLeafLabel(name, effH, laneW, state.lang);
        if (label.orient === 'vert') {
          leaf.classList.add('vert');
          const showDate = height >= 52 && !label.abbreviated;
          leaf.innerHTML = `<span class="leaf-name-v ${label.cls}">${label.text}</span>` +
            (showDate ? `<span class="leaf-dates-v">${startStr}</span>` : '');
        } else {
          const showDate = height >= 32 && !label.abbreviated;
          leaf.innerHTML = `<span class="leaf-name ${label.cls}">${label.text}</span>` +
            (showDate ? `<span class="leaf-dates">${startStr}</span>` : '');
        }
        leaf.dataset.name = name;
        leaf.dataset.sub = state.lang === 'zh' ? c.sub.zh : c.sub.en;
        leaf.dataset.dates = dates;
        leaf.dataset.dur = c.e - c.s;

        lanesWrap.appendChild(leaf);
      });

      // Pred-chain connectors: for every civ with a declared predecessor in this
      // column, draw a faint dashed line from the predecessor's bottom-center
      // to the successor's top-center. Skip seamless transitions (<4y gap) —
      // the leaves already touch, a line would be noise.
      const byId = {};
      sorted.forEach(c => { byId[c.id] = c; });
      sorted.forEach(c => {
        if (!c.pred) return;
        const p = byId[c.pred];
        if (!p) return;
        const gap = c.s - p.e;
        if (gap < 4) return;
        const y1 = yearToY(p.e);
        const y2 = yearToY(c.s);
        const xOf = civ => (side === 'left'
          ? (innerW - laneW) - civ._lane * (laneW + 3) + laneW / 2
          : 4 + civ._lane * (laneW + 3) + laneW / 2);
        const x1 = xOf(p);
        const x2 = xOf(c);
        const link = document.createElement('div');
        link.className = 'spine-pred-link';
        link.dataset.from = p.id;
        link.dataset.to = c.id;
        if (Math.abs(x1 - x2) < 1) {
          // Same lane — simple vertical dashed line
          link.style.top = y1 + 'px';
          link.style.left = x1 + 'px';
          link.style.height = (y2 - y1) + 'px';
        } else {
          // Different lane — rotated thin line connecting centers
          const dx = x2 - x1, dy = y2 - y1;
          const len = Math.sqrt(dx * dx + dy * dy);
          const angle = Math.atan2(dy, dx) * 180 / Math.PI;
          link.classList.add('diag');
          link.style.top = y1 + 'px';
          link.style.left = x1 + 'px';
          link.style.width = len + 'px';
          link.style.transform = `rotate(${angle}deg)`;
        }
        lanesWrap.appendChild(link);
      });

      wrap.appendChild(col);
    });
  };

  buildSide(layoutLeft, 'left');
  buildSide(layoutRight, 'right');

  // Global events — markers anchored on the spine's two side borders.
  // Greedy lane packing per side so dense modern-era events don't overlap.
  if (state.events === 'on') {
    const sorted = window.HA_EVENTS
      .map((ev, idx) => ({ ev, idx }))
      .sort((a, b) => a.ev.y - b.ev.y);
    const sideLanes = { left: [], right: [] }; // each lane = lastBottomY
    const LANE_H = 24;
    sorted.forEach((entry, i) => {
      const ev = entry.ev;
      const yPos = yearToY(ev.y);
      const side = i % 2 === 0 ? 'right' : 'left';
      const lanes = sideLanes[side];
      let lane = 0;
      while (lane < lanes.length && lanes[lane] > yPos - 4) lane++;
      if (lane === lanes.length) lanes.push(0);
      lanes[lane] = yPos + LANE_H;
      const top = yPos + lane * LANE_H;
      const text = state.lang === 'zh' ? ev.t.zh : ev.t.en;
      const yearStr = fmtYear(ev.y);
      const node = document.createElement('div');
      node.className = 'spine-event sev-' + side;
      if (lane > 0) node.classList.add('sev-staggered');
      node.style.top = top + 'px';
      node.style.left = (side === 'left'
        ? centerX - SPINE_WIDTH / 2
        : centerX + SPINE_WIDTH / 2) + 'px';
      node.dataset.year = ev.y;
      node.dataset.text = text;
      node.dataset.evIdx = String(entry.idx);
      node.innerHTML = `<span class="sev-dot"></span><span class="sev-tick"></span><span class="sev-label"><em>${yearStr}</em>${text}</span>`;
      wrap.appendChild(node);
    });
  }

  return wrap;
}


const MAJOR_EVENT_YEARS = new Set([-3100,-500,-221,-27,622,1206,1440,1492,1789,1914,1945,1969,1989]);

function renderEvents() {
  if (state.events === 'off') return null;
  const band = document.createElement('div');
  band.className = 'events-band';
  band.style.width = (SPAN * state.pxPerYear) + 'px';
  const bh = state.view === 'ridge' ? RIDGE_BAND_H : BAND_HEIGHT;
  const bandsH = window.HA_REGIONS.length * bh;
  band.style.height = '56px';

  // single row for majors, dots for minors
  let lastMajorEnd = -Infinity;
  const sorted = [...window.HA_EVENTS].sort((a, b) => a.y - b.y);

  sorted.forEach(ev => {
    const x = yearToX(ev.y);
    const text = state.lang === 'zh' ? ev.t.zh : ev.t.en;
    const yearStr = fmtYear(ev.y);
    const isMajor = MAJOR_EVENT_YEARS.has(ev.y);

    // vertical marker short
    const marker = document.createElement('div');
    marker.className = 'event-marker';
    marker.style.left = x + 'px';
    marker.style.height = '56px';
    band.appendChild(marker);

    // dashed trail into civ area
    const trail = document.createElement('div');
    trail.className = 'event-trail';
    trail.style.left = x + 'px';
    trail.style.top = '56px';
    trail.style.height = bandsH + 'px';
    band.appendChild(trail);

    const cjk = (text.match(/[\u4e00-\u9fff]/g) || []).length;
    const latin = text.length - cjk;
    const estW = cjk * 12 + latin * 6.2 + yearStr.length * 6.5 + 18;

    if (isMajor && x - 10 >= lastMajorEnd) {
      lastMajorEnd = x + estW;
      const label = document.createElement('div');
      label.className = 'event-label';
      label.style.top = '16px';
      label.style.left = (x + 6) + 'px';
      label.innerHTML = `<span class="evt-year">${yearStr}</span>${text}`;
      label.dataset.year = ev.y; label.dataset.text = text;
      band.appendChild(label);
    } else {
      const dot = document.createElement('div');
      dot.className = 'event-label event-collapsed';
      dot.style.top = '22px';
      dot.style.left = (x - 2) + 'px';
      dot.style.width = '5px'; dot.style.height = '5px';
      dot.style.padding = '0';
      dot.style.background = 'var(--event-text)';
      dot.style.borderRadius = '50%';
      dot.style.opacity = '0.5';
      dot.dataset.year = ev.y;
      dot.dataset.text = text + ' · ' + yearStr;
      band.appendChild(dot);
    }
  });
  return band;
}

function renderStage() {
  stageInner.innerHTML = '';
  if (state.view === 'spine') {
    const viewportW = stage.getBoundingClientRect().width;
    const { stageW } = computeSpineDims(viewportW);
    stageInner.style.width = stageW + 'px';
    stageInner.style.height = (SPAN * state.pxPerYear + 60) + 'px';
    stageInner.appendChild(renderSpine());
    renderSpineHeaders();
    applyFilter();
    applyTransform();
    return;
  }
  // non-spine: remove spine headers
  const old = document.getElementById('spineHeadersBar');
  if (old) old.remove();
  const width = SPAN * state.pxPerYear;
  stageInner.style.width = width + 'px';
  const bh = state.view === 'ridge' ? RIDGE_BAND_H : BAND_HEIGHT;
  stageInner.style.height = (EVENTS_BAND_H + window.HA_REGIONS.length * bh) + 'px';

  stageInner.appendChild(renderGrid());
  if (state.view === 'ridge') {
    stageInner.appendChild(renderRidgeline());
  } else {
    stageInner.appendChild(renderRegions());
  }
  const eventsLayer = renderEvents();
  if (eventsLayer) stageInner.appendChild(eventsLayer);

  applyFilter();
  applyTransform();
}

function applyTransform() {
  if (state.view === 'spine') {
    const stageW = parseFloat(stageInner.style.width) || stage.getBoundingClientRect().width;
    const viewportW = stage.getBoundingClientRect().width;
    const baseX = Math.min(0, -(stageW - viewportW) / 2);
    const xTotal = baseX + state.offsetX;
    stageInner.style.transform = `translate(${xTotal}px, ${state.offsetY}px)`;
    const bar = document.getElementById('spineHeadersBar');
    if (bar) bar.style.transform = `translateX(${xTotal}px)`;
    axisScroll.style.transform = `translateX(0)`;
    updateMinimap();
    return;
  }
  stageInner.style.transform = `translateX(${state.offsetX}px)`;
  axisScroll.style.transform = `translateX(${state.offsetX}px)`;
  updateMinimap();
}

function applyFilter() {
  const blocks = document.querySelectorAll('.civ-block');
  blocks.forEach(b => {
    const civ = window.HA_CIVS.find(c => c.id === b.dataset.id);
    if (!civ) return;
    let dim = false;
    if (state.regionFilter !== 'all' && civ.r !== state.regionFilter) dim = true;
    if (state.search) {
      const s = state.search.toLowerCase();
      const hit = civ.n.zh.toLowerCase().includes(s) ||
                  civ.n.en.toLowerCase().includes(s) ||
                  civ.sub.zh.toLowerCase().includes(s) ||
                  civ.sub.en.toLowerCase().includes(s);
      if (!hit) dim = true;
    }
    b.classList.toggle('dim', dim);
  });
  // ridge bands: dim by region filter
  document.querySelectorAll('.ridge-band').forEach(band => {
    const rid = band.dataset.region;
    const dim = state.regionFilter !== 'all' && rid !== state.regionFilter;
    band.classList.toggle('dim', dim);
  });
  // spine leaves: dim by filter + search
  document.querySelectorAll('.spine-leaf').forEach(lf => {
    const civ = window.HA_CIVS.find(c => c.id === lf.dataset.id);
    if (!civ) return;
    let dim = false;
    if (state.regionFilter !== 'all' && civ.r !== state.regionFilter) dim = true;
    if (state.search) {
      const s = state.search.toLowerCase();
      const hit = civ.n.zh.toLowerCase().includes(s) ||
                  civ.n.en.toLowerCase().includes(s) ||
                  civ.sub.zh.toLowerCase().includes(s) ||
                  civ.sub.en.toLowerCase().includes(s);
      if (!hit) dim = true;
    }
    lf.classList.toggle('dim', dim);
  });
  // ridge peak labels: dim non-matching search
  document.querySelectorAll('.ridge-peak').forEach(p => {
    const civ = window.HA_CIVS.find(c => c.id === p.dataset.id);
    if (!civ) return;
    let dim = false;
    if (state.regionFilter !== 'all' && civ.r !== state.regionFilter) dim = true;
    if (state.search) {
      const s = state.search.toLowerCase();
      const hit = civ.n.zh.toLowerCase().includes(s) ||
                  civ.n.en.toLowerCase().includes(s);
      if (!hit) dim = true;
    }
    p.classList.toggle('dim', dim);
  });
}

// ———————————— SHADE UTILITY ————————————
function shade(hex, amt) {
  // hex like #RRGGBB; amt in % (-100..100)
  const c = hex.replace('#', '');
  const num = parseInt(c, 16);
  const r = Math.max(0, Math.min(255, ((num >> 16) & 0xff) + Math.round(255 * amt / 100)));
  const g = Math.max(0, Math.min(255, ((num >> 8) & 0xff) + Math.round(255 * amt / 100)));
  const b = Math.max(0, Math.min(255, (num & 0xff) + Math.round(255 * amt / 100)));
  return '#' + [r, g, b].map(v => v.toString(16).padStart(2, '0')).join('');
}

// ———————————— MASTHEAD REGION FILTER ————————————
function renderRegionFilter() {
  regionFilterEl.innerHTML = '';
  const all = document.createElement('button');
  all.textContent = t('all');
  all.dataset.region = 'all';
  if (state.regionFilter === 'all') all.classList.add('active');
  regionFilterEl.appendChild(all);
  window.HA_REGIONS.forEach(r => {
    const b = document.createElement('button');
    b.textContent = state.lang === 'zh' ? r.zh : r.en;
    b.dataset.region = r.id;
    if (state.regionFilter === r.id) b.classList.add('active');
    regionFilterEl.appendChild(b);
  });
}

regionFilterEl.addEventListener('click', e => {
  const btn = e.target.closest('button');
  if (!btn) return;
  state.regionFilter = btn.dataset.region;
  regionFilterEl.querySelectorAll('button').forEach(x => x.classList.toggle('active', x === btn));
  applyFilter();
});

// ———————————— SEARCH ————————————
searchInput.addEventListener('input', e => {
  state.search = e.target.value.trim();
  if (!state.search) { searchResults.classList.remove('open'); applyFilter(); return; }
  const s = state.search.toLowerCase();
  const hits = window.HA_CIVS.filter(c =>
    c.n.zh.toLowerCase().includes(s) ||
    c.n.en.toLowerCase().includes(s) ||
    c.sub.zh.toLowerCase().includes(s) ||
    c.sub.en.toLowerCase().includes(s)
  ).slice(0, 12);
  searchResults.innerHTML = hits.map(c => {
    const name = state.lang === 'zh' ? c.n.zh : c.n.en;
    const other = state.lang === 'zh' ? c.n.en : c.n.zh;
    return `<div class="sr-item" data-id="${c.id}"><span class="sr-name">${name}</span><span class="sr-meta">${fmtYear(c.s)}–${fmtYear(c.e)} · ${other}</span></div>`;
  }).join('');
  searchResults.classList.add('open');
  applyFilter();
});
searchResults.addEventListener('click', e => {
  const item = e.target.closest('.sr-item');
  if (!item) return;
  focusOnCiv(item.dataset.id);
  searchResults.classList.remove('open');
  searchInput.value = '';
  state.search = '';
  applyFilter();
});
document.addEventListener('click', e => {
  if (!e.target.closest('.search-wrap')) searchResults.classList.remove('open');
});

function focusOnCiv(id) {
  const civ = window.HA_CIVS.find(c => c.id === id);
  if (!civ) return;
  const midYear = (civ.s + civ.e) / 2;
  if (state.view === 'spine') {
    const rect = stage.getBoundingClientRect();
    state.offsetY = rect.height / 2 - yearToY(midYear);
  } else {
    const targetX = yearToX(midYear);
    state.offsetX = -(targetX - window.innerWidth / 2);
  }
  clampOffset();
  applyTransform();
  setTimeout(() => openDetail(civ), 300);
}

// Parallel-civ highlight: dim non-contemporaries so the selected era glows
function applyParallelHighlight(civ) {
  document.querySelectorAll('.spine-leaf').forEach(lf => {
    lf.classList.remove('offbeat', 'concurrent', 'selected');
  });
  if (!civ) return;
  document.querySelectorAll('.spine-leaf').forEach(lf => {
    const c = window.HA_CIVS.find(x => x.id === lf.dataset.id);
    if (!c) return;
    if (c.id === civ.id) lf.classList.add('selected');
    else if (c.s < civ.e && c.e > civ.s) lf.classList.add('concurrent');
    else lf.classList.add('offbeat');
  });
}
function clearParallelHighlight() {
  document.querySelectorAll('.spine-leaf').forEach(lf => {
    lf.classList.remove('offbeat', 'concurrent', 'selected');
  });
}

// ———————————— DETAIL PANEL ————————————
function openDetail(civ) {
  const name = state.lang === 'zh' ? civ.n.zh : civ.n.en;
  const nameOther = state.lang === 'zh' ? civ.n.en : civ.n.zh;
  const region = window.HA_REGIONS.find(r => r.id === civ.r);

  el('dpKicker').textContent = state.lang === 'zh' ? civ.sub.zh : civ.sub.en;
  el('dpTitle').textContent = name;
  el('dpTitleEn').textContent = nameOther;

  const color = PALETTE()[civ.c] || PALETTE().sand;
  el('dpBar').style.background = `linear-gradient(90deg, ${color}, ${shade(color, 30)})`;

  el('dpDates').textContent = `${fmtYear(civ.s)} — ${fmtYear(civ.e)}`;
  const dur = civ.e - civ.s;
  el('dpDuration').textContent = `${dur} ${t('yrs')}`;
  el('dpRegion').textContent = state.lang === 'zh' ? region.zh : region.en;
  const infScale = t('influence');
  el('dpInfluence').innerHTML = `${'●'.repeat(civ.w)}${'○'.repeat(5 - civ.w)} &nbsp; ${infScale[civ.w]}`;

  el('dpDesc').textContent = state.lang === 'zh' ? civ.info.zh : civ.info.en;

  el('dpAch').innerHTML = (civ.ach || []).map(a =>
    `<span>${state.lang === 'zh' ? a.zh : a.en}</span>`).join('');
  // Restore achievement section visibility (event-mode hides it)
  el('dpAch').style.display = '';
  const achH1 = el('dpAch').previousElementSibling;
  if (achH1) achH1.style.display = '';

  // Concurrent: civs that overlap and are significant
  const concur = window.HA_CIVS.filter(c =>
    c.id !== civ.id && c.s < civ.e && c.e > civ.s && c.w >= 3
  );
  // sort by overlap length descending
  concur.sort((a, b) => {
    const oa = Math.min(a.e, civ.e) - Math.max(a.s, civ.s);
    const ob = Math.min(b.e, civ.e) - Math.max(b.s, civ.s);
    return ob - oa;
  });
  const top = concur.slice(0, 6);
  el('dpConcurrent').innerHTML = top.map(c => {
    const nm = state.lang === 'zh' ? c.n.zh : c.n.en;
    const reg = window.HA_REGIONS.find(r => r.id === c.r);
    const regName = state.lang === 'zh' ? reg.zh : reg.en;
    const col = PALETTE()[c.c] || PALETTE().sand;
    return `<div class="cc" data-id="${c.id}"><div class="cc-swatch" style="background:${col}"></div><div class="cc-name">${nm}</div><div class="cc-region">${regName}</div></div>`;
  }).join('');

  detailPanel.classList.remove('event-mode');
  detailPanel.classList.add('open');
  applyParallelHighlight(civ);
  writeDeepLink({ civ: civ.id });
}

const EVENT_REGION_LABEL = {
  eastasia:  { zh:'东亚',          en:'East Asia' },
  southasia: { zh:'南亚',          en:'South Asia' },
  westasia:  { zh:'西亚 / 中东',   en:'West Asia / Middle East' },
  europe:    { zh:'欧洲',          en:'Europe' },
  africa:    { zh:'非洲',          en:'Africa' },
  americas:  { zh:'美洲',          en:'Americas' },
  global:    { zh:'全球',          en:'Global' },
};

function openEventDetail(ev) {
  const titleZh = ev.t.zh, titleEn = ev.t.en;
  el('dpKicker').textContent = state.lang === 'zh' ? '关 键 事 件 · KEY EVENT' : 'KEY EVENT · 关键事件';
  el('dpTitle').textContent  = state.lang === 'zh' ? titleZh : titleEn;
  el('dpTitleEn').textContent = state.lang === 'zh' ? titleEn : titleZh;

  el('dpBar').style.background = `linear-gradient(90deg, var(--gold), var(--gold-dim))`;

  el('dpDates').textContent = fmtYear(ev.y);
  el('dpDuration').textContent = state.lang === 'zh' ? '一次性事件' : 'Single moment';
  const reg = EVENT_REGION_LABEL[ev.region] || EVENT_REGION_LABEL.global;
  el('dpRegion').textContent = state.lang === 'zh' ? reg.zh : reg.en;
  el('dpInfluence').textContent = state.lang === 'zh' ? '改变历史走向' : 'Changed the course of history';

  el('dpDesc').textContent = ev.info
    ? (state.lang === 'zh' ? ev.info.zh : ev.info.en)
    : (state.lang === 'zh' ? titleZh : titleEn);
  el('dpAch').innerHTML = '';
  el('dpAch').style.display = 'none';
  const achH = el('dpAch').previousElementSibling;
  if (achH) achH.style.display = 'none';

  // Concurrent civilizations alive at this exact year
  const concur = window.HA_CIVS
    .filter(c => ev.y >= c.s && ev.y <= c.e && c.w >= 3)
    .sort((a, b) => b.w - a.w)
    .slice(0, 8);
  el('dpConcurrent').innerHTML = concur.map(c => {
    const nm  = state.lang === 'zh' ? c.n.zh : c.n.en;
    const reg2 = window.HA_REGIONS.find(r => r.id === c.r);
    const regName = state.lang === 'zh' ? reg2.zh : reg2.en;
    const col = PALETTE()[c.c] || PALETTE().sand;
    return `<div class="cc" data-id="${c.id}"><div class="cc-swatch" style="background:${col}"></div><div class="cc-name">${nm}</div><div class="cc-region">${regName}</div></div>`;
  }).join('');

  detailPanel.classList.add('event-mode');
  detailPanel.classList.add('open');
  clearParallelHighlight();
  writeDeepLink({ y: ev.y });
}

// Close / dismiss semantics:
//   1st dismiss (ESC / ✕ / outside-click) → close panel, KEEP highlight so the
//     user can compare concurrent civilizations with the panel out of the way.
//   2nd dismiss (ESC or outside-click with panel already closed) → clear highlight.
// This avoids the previous inconsistency where ✕ + outside-click wiped the
// highlight but ESC didn't.
function _hasHighlight() {
  return !!document.querySelector('.spine-leaf.selected, .spine-leaf.concurrent, .spine-leaf.offbeat');
}
el('dpClose').addEventListener('click', () => {
  detailPanel.classList.remove('open');
  writeDeepLink({});
});
document.addEventListener('click', e => {
  // Ignore clicks inside panel / on clickable civ surfaces / search / tweaks.
  if (detailPanel.contains(e.target)) return;
  if (e.target.closest('.spine-leaf, .civ-block, .ridge-civ, .swim-civ, .ridge-peak, .ridge-hit, .spine-event, .search-results, #searchInput, .tweaks')) return;
  if (detailPanel.classList.contains('open')) {
    // Stage 1: close panel but leave the parallel highlight so the user can
    // see overlapping civs without the panel blocking the right column.
    detailPanel.classList.remove('open');
    writeDeepLink({});
    return;
  }
  if (_hasHighlight()) {
    // Stage 2: panel already closed → a second outside-click clears highlight.
    clearParallelHighlight();
  }
});
document.addEventListener('keydown', e => {
  if (e.key !== 'Escape') return;
  if (detailPanel.classList.contains('open')) {
    detailPanel.classList.remove('open');
    writeDeepLink({});
    e.preventDefault();
    return;
  }
  if (_hasHighlight()) {
    clearParallelHighlight();
    e.preventDefault();
    return;
  }
  if (searchResults.classList.contains('open')) {
    searchResults.classList.remove('open');
  }
});
el('dpConcurrent').addEventListener('click', e => {
  const cc = e.target.closest('.cc');
  if (!cc) return;
  focusOnCiv(cc.dataset.id);
});

// ———————————— CIV BLOCK / RIDGE CLICK + HOVER ————————————
function civAtRidgePosition(regionId, clientX) {
  // Given a region + clientX, find the dominant active civ at that year
  const year = Math.round(xToYear(clientX - state.offsetX));
  const active = window.HA_CIVS.filter(c =>
    c.r === regionId && year >= c.s && year <= c.e);
  if (!active.length) return { year, civ: null, active: [] };
  const dom = [...active].sort((a, b) =>
    b.w - a.w || ((b.e - b.s) - (a.e - a.s)))[0];
  return { year, civ: dom, active };
}

stageInner.addEventListener('click', e => {
  const sev = e.target.closest('.spine-event');
  if (sev) {
    const idx = +sev.dataset.evIdx;
    const ev = window.HA_EVENTS[idx];
    if (ev) openEventDetail(ev);
    return;
  }
  const b = e.target.closest('.civ-block');
  if (b) {
    const civ = window.HA_CIVS.find(c => c.id === b.dataset.id);
    if (civ) openDetail(civ);
    return;
  }
  const leaf = e.target.closest('.spine-leaf');
  if (leaf) {
    const civ = window.HA_CIVS.find(c => c.id === leaf.dataset.id);
    if (civ) openDetail(civ);
    return;
  }
  const peak = e.target.closest('.ridge-peak');
  if (peak) {
    const civ = window.HA_CIVS.find(c => c.id === peak.dataset.id);
    if (civ) openDetail(civ);
    return;
  }
  const hit = e.target.closest('.ridge-hit');
  if (hit) {
    const { civ } = civAtRidgePosition(hit.dataset.regionId, e.clientX);
    if (civ) openDetail(civ);
    return;
  }
});
stageInner.addEventListener('mouseover', e => {
  const b = e.target.closest('.civ-block');
  const evLabel = e.target.closest('.event-label') || e.target.closest('.spine-event');
  const peak = e.target.closest('.ridge-peak');
  const leaf = e.target.closest('.spine-leaf');
  if (b) {
    tooltip.innerHTML = `<b>${b.dataset.name}</b><em>${b.dataset.sub} · ${b.dataset.dates} · ${b.dataset.dur} ${t('yrs')}</em>`;
    tooltip.classList.add('open');
  } else if (leaf) {
    tooltip.innerHTML = `<b>${leaf.dataset.name}</b><em>${leaf.dataset.sub} · ${leaf.dataset.dates} · ${leaf.dataset.dur} ${t('yrs')}</em>`;
    tooltip.classList.add('open');
  } else if (peak) {
    const civ = window.HA_CIVS.find(c => c.id === peak.dataset.id);
    if (civ) {
      const name = state.lang === 'zh' ? civ.n.zh : civ.n.en;
      const sub  = state.lang === 'zh' ? civ.sub.zh : civ.sub.en;
      tooltip.innerHTML = `<b>${name}</b><em>${sub} · ${fmtYear(civ.s)} — ${fmtYear(civ.e)}</em>`;
      tooltip.classList.add('open');
    }
  } else if (evLabel) {
    tooltip.innerHTML = `<b>${fmtYear(+evLabel.dataset.year)}</b><em>${evLabel.dataset.text}</em>`;
    tooltip.classList.add('open');
  }
});
stageInner.addEventListener('mousemove', e => {
  // update ridge tooltip when over ridge-hit
  const hit = e.target.closest('.ridge-hit');
  if (hit && state.view === 'ridge') {
    const { year, civ, active } = civAtRidgePosition(hit.dataset.regionId, e.clientX);
    if (civ) {
      const name = state.lang === 'zh' ? civ.n.zh : civ.n.en;
      const n = active.length;
      const more = n > 1 ? ` · +${n-1} ${state.lang === 'zh' ? '同期' : 'contemp.'}` : '';
      tooltip.innerHTML = `<b>${name}</b><em>${fmtYear(year)}${more}</em>`;
      tooltip.classList.add('open');
    } else {
      tooltip.classList.remove('open');
    }
  }
  if (!tooltip.classList.contains('open')) return;
  let x = e.clientX + 16;
  let y = e.clientY + 16;
  if (x + 300 > window.innerWidth) x = e.clientX - 316;
  if (y + 100 > window.innerHeight) y = e.clientY - 80;
  tooltip.style.left = x + 'px';
  tooltip.style.top = y + 'px';
});
stageInner.addEventListener('mouseout', e => {
  const rel = e.relatedTarget;
  if (!rel || !rel.closest ||
      (!rel.closest('.civ-block') && !rel.closest('.event-label') &&
       !rel.closest('.ridge-peak') && !rel.closest('.ridge-hit'))) {
    tooltip.classList.remove('open');
  }
});

// ———————————— PAN + ZOOM ————————————
// Mouse / pen go through pointer events. Touch is handled by dedicated
// touchstart/move/end listeners below — iOS Safari's pointer-event
// implementation is flaky around preventDefault timing, so the native
// touch API is far more reliable on phones.
let lastMouseX = 0;
function _excludedDragTarget(target) {
  if (!target || !target.closest) return false;
  return !!(
    target.closest('.civ-block') ||
    target.closest('.event-label') ||
    target.closest('.spine-leaf') ||
    target.closest('.spine-event') ||
    target.closest('.ridge-peak')
  );
}
stage.addEventListener('pointerdown', e => {
  // Skip touch — touchstart below is the authoritative path for fingers.
  if (e.pointerType === 'touch') return;
  if (_excludedDragTarget(e.target)) return;
  e.preventDefault();
  state.dragging = true;
  state.dragMoved = false;
  state.dragDownX = e.clientX;
  state.dragDownY = e.clientY;
  state.dragStart = state.view === 'spine' ? e.clientY : e.clientX;
  state.dragStartOffset = state.view === 'spine' ? state.offsetY : state.offsetX;
  state.dragStartX = e.clientX;
  state.dragStartOffsetX = state.offsetX;
  stage.style.cursor = 'grabbing';
  document.body.classList.add('is-panning');
});
window.addEventListener('pointermove', e => {
  if (e.pointerType === 'touch') return;
  lastMouseX = e.clientX;
  if (!state.dragging) return;
  state.dragMoved = true;
  if (state.view === 'spine') {
    state.offsetY = state.dragStartOffset + (e.clientY - state.dragStart);
    state.offsetX = state.dragStartOffsetX + (e.clientX - state.dragStartX);
  } else {
    state.offsetX = state.dragStartOffset + (e.clientX - state.dragStart);
  }
  clampOffset();
  applyTransform();
  updateNow(e.clientX, e.clientY);
});
function _endMousePan(e) {
  if (e && e.pointerType === 'touch') return;
  if (state.dragging && !state.dragMoved && e && e.clientX != null) {
    updateNow(e.clientX, e.clientY);
  }
  state.dragging = false;
  state.dragMoved = false;
  stage.style.cursor = '';
  document.body.classList.remove('is-panning');
}
window.addEventListener('pointerup', _endMousePan);
window.addEventListener('pointercancel', _endMousePan);

// ———————————— TOUCH PAN (iOS-safe) ————————————
// Using the raw touch API avoids iOS's pointer-event quirks. `touch-action: none`
// on .stage (in CSS) keeps Safari from stealing the gesture as a page-scroll
// before our handler can call preventDefault. Single-finger pans; we don't
// fight a two-finger pinch (browser won't zoom either, since touch-action:none,
// but we just ignore multi-touch rather than interpret it).
const _touch = { active: false, sx: 0, sy: 0, ox: 0, oy: 0, moved: false };
// Touch listeners attach to `document` (not `stage`). On iOS Safari, listeners
// attached to non-root elements can silently miss touches when the target has
// complex stacking / transforms underneath — attaching to document guarantees
// delivery, and we filter by whether the touch is inside the stage below.
// `touch-action: none` is moved onto <html> / <body> on mobile so the browser
// never converts the gesture to a page-scroll.
function _touchInStage(t) {
  if (!t) return false;
  const r = stage.getBoundingClientRect();
  return t.clientX >= r.left && t.clientX <= r.right &&
         t.clientY >= r.top  && t.clientY <= r.bottom;
}
document.addEventListener('touchstart', e => {
  if (e.touches.length !== 1) { _touch.active = false; return; }
  const t = e.touches[0];
  if (!_touchInStage(t)) return;
  // Look up the actual hit element (e.target is stale under some iOS Safari
  // builds when touches originate on transformed/absolutely-positioned kids).
  const hit = document.elementFromPoint(t.clientX, t.clientY) || e.target;
  if (_excludedDragTarget(hit)) return;
  e.preventDefault();
  _touch.active = true;
  _touch.moved = false;
  _touch.sx = t.clientX;
  _touch.sy = t.clientY;
  _touch.ox = state.offsetX;
  _touch.oy = state.offsetY;
  state.dragging = true;
  state.dragMoved = false;
  document.body.classList.add('is-panning');
}, { passive: false });
document.addEventListener('touchmove', e => {
  if (!_touch.active || e.touches.length !== 1) return;
  e.preventDefault();
  const t = e.touches[0];
  _touch.moved = true;
  state.dragMoved = true;
  const dx = t.clientX - _touch.sx;
  const dy = t.clientY - _touch.sy;
  if (state.view === 'spine') {
    state.offsetY = _touch.oy + dy;
    state.offsetX = _touch.ox + dx;
  } else {
    state.offsetX = _touch.ox + dx;
  }
  clampOffset();
  applyTransform();
}, { passive: false });
function _endTouchPan() {
  _touch.active = false;
  state.dragging = false;
  state.dragMoved = false;
  document.body.classList.remove('is-panning');
}
document.addEventListener('touchend', _endTouchPan);
document.addEventListener('touchcancel', _endTouchPan);

stage.addEventListener('wheel', e => {
  e.preventDefault();
  if (e.ctrlKey || e.metaKey) {
    // zoom
    const rect = stage.getBoundingClientRect();
    const factor = e.deltaY < 0 ? 1.15 : 0.87;
    if (state.view === 'spine') {
      const mouseY = e.clientY - rect.top;
      const worldYear = (mouseY - state.offsetY) / state.pxPerYear + START_YEAR;
      state.pxPerYear = Math.max(0.12, Math.min(3.5, state.pxPerYear * factor));
      const newY = (worldYear - START_YEAR) * state.pxPerYear;
      state.offsetY = mouseY - newY;
    } else {
      const mouseX = e.clientX - rect.left;
      const worldX = (mouseX - state.offsetX) / state.pxPerYear;
      state.pxPerYear = Math.max(0.12, Math.min(2.5, state.pxPerYear * factor));
      const newX = worldX * state.pxPerYear;
      state.offsetX = mouseX - newX;
    }
    clampOffset();
    renderStage();
    renderRegionLabels();
    renderAxis();
  } else if (e.shiftKey && state.view === 'spine') {
    // Shift + wheel → horizontal pan in spine view.
    // Many trackpads/mice already deliver deltaX on shift-wheel; take whichever is larger.
    const dx = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
    state.offsetX -= dx;
    clampOffset();
    applyTransform();
  } else {
    if (state.view === 'spine') {
      const dy = Math.abs(e.deltaY) > Math.abs(e.deltaX) ? e.deltaY : e.deltaX;
      state.offsetY -= dy;
    } else {
      const dx = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
      state.offsetX -= dx;
    }
    clampOffset();
    applyTransform();
  }
  updateNow(e.clientX, e.clientY);
}, { passive: false });

el('zoomIn').addEventListener('click', () => zoomStep(1.25));
el('zoomOut').addEventListener('click', () => zoomStep(0.8));
el('resetView').addEventListener('click', () => {
  const dmap = state.view === 'spine' ? SPINE_DENSITY_MAP : DENSITY_MAP;
  state.pxPerYear = dmap[state.density];
  state.offsetX = 0; state.offsetY = 0;
  renderStage();
  renderRegionLabels();
  renderAxis();
});

function zoomStep(factor) {
  if (state.view === 'spine') {
    const rect = stage.getBoundingClientRect();
    const cy = rect.height / 2;
    const worldYear = (cy - state.offsetY) / state.pxPerYear + START_YEAR;
    state.pxPerYear = Math.max(0.12, Math.min(3.5, state.pxPerYear * factor));
    state.offsetY = cy - (worldYear - START_YEAR) * state.pxPerYear;
  } else {
    const cx = window.innerWidth / 2;
    const worldX = (cx - state.offsetX) / state.pxPerYear;
    state.pxPerYear = Math.max(0.12, Math.min(2.5, state.pxPerYear * factor));
    state.offsetX = cx - worldX * state.pxPerYear;
  }
  clampOffset();
  renderStage();
  renderRegionLabels();
  renderAxis();
}

// ———————————— NOW INDICATOR ————————————
function updateNow(clientX, clientY) {
  if (state.view === 'spine') {
    // now indicator is a horizontal line across the spine
    if (clientY == null) return;
    const rect = stage.getBoundingClientRect();
    const y = clientY;
    const year = Math.round(yToYear(y - rect.top - state.offsetY));
    if (year < START_YEAR || year > END_YEAR) {
      nowIndicator.style.display = 'none';
      nowYear.style.display = 'none';
      return;
    }
    nowIndicator.style.display = 'block';
    nowIndicator.style.top = y + 'px';
    nowIndicator.style.left = '0';
    nowIndicator.style.width = '100%';
    nowIndicator.style.height = '1px';
    nowIndicator.style.bottom = 'auto';
    nowYear.style.display = 'block';
    nowYear.style.top = y + 'px';
    nowYear.style.left = (window.innerWidth / 2 + 42) + 'px';
    nowYear.textContent = fmtYear(year);
    return;
  }
  if (clientX == null) return;
  const x = clientX;
  const year = Math.round(xToYear(x - state.offsetX));
  if (year < START_YEAR || year > END_YEAR) {
    nowIndicator.style.display = 'none';
    nowYear.style.display = 'none';
    return;
  }
  nowIndicator.style.display = 'block';
  nowIndicator.style.left = x + 'px';
  nowIndicator.style.top = '66px';
  nowIndicator.style.bottom = '78px';
  nowIndicator.style.width = '1px';
  nowIndicator.style.height = 'auto';
  nowYear.style.display = 'block';
  nowYear.style.left = x + 'px';
  nowYear.style.top = '72px';
  nowYear.textContent = fmtYear(year);
}

// ———————————— TWEAKS ————————————
function setTweak(key, val) {
  state[key] = val;
  if (key === 'theme') {
    document.body.dataset.theme = val;
    // Repaint minimap canvas so the density bars pick up the new palette.
    if (typeof renderMinimapCanvas === 'function') renderMinimapCanvas();
  }
  if (key === 'density') {
    const oldP = state.pxPerYear;
    const dmap = state.view === 'spine' ? SPINE_DENSITY_MAP : DENSITY_MAP;
    state.pxPerYear = dmap[val];
    if (state.view === 'spine') {
      const rect = stage.getBoundingClientRect();
      const cy = rect.height / 2;
      const centerYear = (cy - state.offsetY) / oldP + START_YEAR;
      state.offsetY = cy - (centerYear - START_YEAR) * state.pxPerYear;
    } else {
      const cx = window.innerWidth / 2;
      const centerYear = (cx - state.offsetX) / oldP + START_YEAR;
      state.offsetX = cx - (centerYear - START_YEAR) * state.pxPerYear;
    }
    clampOffset();
    renderStage();
    renderRegionLabels();
    renderAxis();
  }
  if (key === 'events') { renderStage(); }
  if (key === 'view') {
    const dmap = val === 'spine' ? SPINE_DENSITY_MAP : DENSITY_MAP;
    state.pxPerYear = dmap[state.density];
    state.offsetX = 0; state.offsetY = 0;
    // spine: scroll body to top, hide the bottom axis
    document.body.dataset.view = val;
    renderStage();
    renderRegionLabels();
    renderAxis();
    // center spine initial view around axial age (-400)
    if (val === 'spine') {
      const rect = stage.getBoundingClientRect();
      const cy = rect.height / 2;
      state.offsetY = cy - yearToY(-400);
      clampOffset();
      applyTransform();
    }
  }
  // persist
  try {
    window.parent.postMessage({ type: '__edit_mode_set_keys', edits: { [key]: val } }, '*');
  } catch(_) {}
  updateTweakUI();
}
function updateTweakUI() {
  tweaksEl.querySelectorAll('.tw-options').forEach(grp => {
    const key = grp.dataset.tw;
    grp.querySelectorAll('button').forEach(b => {
      b.classList.toggle('active', b.dataset.val === state[key]);
    });
  });
}
tweaksEl.addEventListener('click', e => {
  const b = e.target.closest('button[data-val]');
  if (!b) return;
  const key = b.parentElement.dataset.tw;
  setTweak(key, b.dataset.val);
});
el('tweaksClose')?.addEventListener('click', () => tweaksEl.classList.remove('open'));
el('tweaksToggle')?.addEventListener('click', () => tweaksEl.classList.toggle('open'));

// ———————————— TWEAKS HOST INTEGRATION ————————————
window.addEventListener('message', e => {
  const d = e.data;
  if (!d || typeof d !== 'object') return;
  if (d.type === '__activate_edit_mode') tweaksEl.classList.add('open');
  else if (d.type === '__deactivate_edit_mode') tweaksEl.classList.remove('open');
});
// announce after listener registered
setTimeout(() => {
  try { window.parent.postMessage({ type: '__edit_mode_available' }, '*'); } catch(_) {}
}, 100);

// ———————————— LANG SWITCH ————————————
// Both the hero and the masthead carry a .lang-switch — match by data-lang
// (not object identity) so clicking in either place keeps both in sync.
document.querySelectorAll('.lang-switch button').forEach(b => {
  b.addEventListener('click', () => {
    state.lang = b.dataset.lang;
    document.querySelectorAll('.lang-switch button').forEach(x => {
      x.classList.toggle('active', x.dataset.lang === state.lang);
    });
    applyI18n();
    renderRegionLabels();
    renderRegionFilter();
    renderStage();
    renderAxis();
    refreshMinimap();
  });
});
function applyI18n() {
  // Defensive: if a key is missing from the dictionary (e.g. a stale JS
  // cache is loading alongside fresher HTML that added a new key), leave the
  // existing HTML text alone rather than exposing the raw key name.
  const dict = STR[state.lang] || {};
  document.querySelectorAll('[data-i18n]').forEach(el => {
    const k = el.dataset.i18n;
    if (Object.prototype.hasOwnProperty.call(dict, k)) el.textContent = dict[k];
  });
  document.querySelectorAll('[data-i18n-ph]').forEach(el => {
    const k = el.dataset.i18nPh;
    if (Object.prototype.hasOwnProperty.call(dict, k)) el.placeholder = dict[k];
  });
  document.documentElement.lang = state.lang === 'zh' ? 'zh-CN' : 'en';
}

// ———————————— HERO ————————————
el('heroEnter').addEventListener('click', () => {
  el('hero').classList.add('hidden');
  // animate initial pan to a tasty position (Axial Age ~ year -400)
  setTimeout(() => {
    if (state.view === 'spine') {
      const rect = stage.getBoundingClientRect();
      state.offsetY = rect.height / 2 - yearToY(-400);
    } else {
      const target = yearToX(-400);
      state.offsetX = -(target - window.innerWidth / 2);
    }
    clampOffset();
    applyTransform();
  }, 200);
});

// ———————————— RESIZE ————————————
let resizeTO;
window.addEventListener('resize', () => {
  clearTimeout(resizeTO);
  resizeTO = setTimeout(() => {
    clampOffset();
    renderStage();
    renderAxis();
    renderMinimapCanvas();
    updateMinimap();
  }, 120);
});

// ———————————— DEEP LINKS (URL hash: #civ=tang or #y=618) ————————————
let _hashWriting = false;
function parseHash() {
  const h = (location.hash || '').replace(/^#/, '');
  if (!h) return {};
  const out = {};
  h.split('&').forEach(kv => {
    const [k, v] = kv.split('=');
    if (k) out[decodeURIComponent(k)] = v != null ? decodeURIComponent(v) : '';
  });
  return out;
}
function writeDeepLink(params) {
  _hashWriting = true;
  const parts = Object.entries(params).filter(([, v]) => v != null && v !== '');
  const next = parts.length ? '#' + parts.map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&') : ' ';
  try {
    history.replaceState(null, '', location.pathname + location.search + (next === ' ' ? '' : next));
  } catch (_) {}
  setTimeout(() => { _hashWriting = false; }, 50);
}
function applyHash() {
  const p = parseHash();
  if (p.civ) {
    const civ = window.HA_CIVS.find(c => c.id === p.civ);
    if (civ) {
      // Skip hero if hash deep-links in
      el('hero')?.classList.add('hidden');
      focusOnCiv(civ.id);
      return;
    }
  }
  if (p.y != null && p.y !== '') {
    const y = +p.y;
    if (!Number.isNaN(y)) {
      el('hero')?.classList.add('hidden');
      if (state.view === 'spine') {
        const rect = stage.getBoundingClientRect();
        state.offsetY = rect.height / 2 - yearToY(y);
      } else {
        const target = yearToX(y);
        state.offsetX = -(target - window.innerWidth / 2);
      }
      clampOffset();
      applyTransform();
    }
  }
}
window.addEventListener('hashchange', () => { if (!_hashWriting) applyHash(); });

// ———————————— SEARCH KEYBOARD NAVIGATION ————————————
// ArrowDown/ArrowUp cycles .sr-item, Enter activates, Escape closes.
searchInput.addEventListener('keydown', e => {
  const items = Array.from(searchResults.querySelectorAll('.sr-item'));
  const cur = searchResults.querySelector('.sr-item.active');
  let idx = items.indexOf(cur);
  if (e.key === 'ArrowDown') {
    if (!items.length) return;
    idx = (idx + 1) % items.length;
    items.forEach((n, i) => n.classList.toggle('active', i === idx));
    items[idx].scrollIntoView({ block: 'nearest' });
    e.preventDefault();
  } else if (e.key === 'ArrowUp') {
    if (!items.length) return;
    idx = idx <= 0 ? items.length - 1 : idx - 1;
    items.forEach((n, i) => n.classList.toggle('active', i === idx));
    items[idx].scrollIntoView({ block: 'nearest' });
    e.preventDefault();
  } else if (e.key === 'Enter') {
    const pick = cur || items[0];
    if (pick) {
      focusOnCiv(pick.dataset.id);
      searchResults.classList.remove('open');
      searchInput.value = '';
      state.search = '';
      applyFilter();
      searchInput.blur();
      e.preventDefault();
    }
  } else if (e.key === 'Escape') {
    searchResults.classList.remove('open');
    searchInput.blur();
  }
});

// ———————————— GLOBAL KEYBOARD SHORTCUTS ————————————
// Arrows pan, +/- zoom. Ignores when typing into inputs.
document.addEventListener('keydown', e => {
  if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.isContentEditable)) return;
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  const PAN = 120;
  if (state.view === 'spine') {
    if (e.key === 'ArrowUp')    { state.offsetY += PAN; clampOffset(); applyTransform(); e.preventDefault(); }
    else if (e.key === 'ArrowDown')  { state.offsetY -= PAN; clampOffset(); applyTransform(); e.preventDefault(); }
    else if (e.key === 'ArrowLeft')  { state.offsetX += PAN; clampOffset(); applyTransform(); e.preventDefault(); }
    else if (e.key === 'ArrowRight') { state.offsetX -= PAN; clampOffset(); applyTransform(); e.preventDefault(); }
  } else {
    if (e.key === 'ArrowLeft')       { state.offsetX += PAN; clampOffset(); applyTransform(); e.preventDefault(); }
    else if (e.key === 'ArrowRight') { state.offsetX -= PAN; clampOffset(); applyTransform(); e.preventDefault(); }
  }
  if (e.key === '+' || e.key === '=') { zoomStep(1.25); e.preventDefault(); }
  else if (e.key === '-' || e.key === '_') { zoomStep(0.8); e.preventDefault(); }
});

// ———————————— DEV-MODE STATE EXPOSURE ————————————
if (location.hostname === 'localhost' || location.hostname === '127.0.0.1') {
  window.__HA_STATE = state;
  window.__HA_focusOnCiv = focusOnCiv;
}

// ———————————— INIT ————————————
function init() {
  document.body.dataset.theme = state.theme;
  document.body.dataset.view = state.view;
  applyI18n();
  renderRegionFilter();
  renderRegionLabels();
  renderStage();
  renderAxis();
  refreshMinimap();
  updateTweakUI();
  // initial pan: center around year 0 (classical convergence)
  if (state.view === 'spine') {
    const rect = stage.getBoundingClientRect();
    state.offsetY = rect.height / 2 - yearToY(0);
  } else {
    const target = yearToX(0);
    state.offsetX = -(target - window.innerWidth / 2);
  }
  clampOffset();
  applyTransform();
  // If page loaded with a hash, apply it after a tick (so layout is measured).
  if (location.hash) setTimeout(applyHash, 50);
}
init();

})();
