import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import './style.css';
import {
  createCachedTileLayer,
  syncOfflineZoomLimits,
  isOnline,
  prefetchTiles,
  resolveAssetUrl,
  SEEDED_MAX_ZOOM,
} from './tileCache.js';

function prefetchRegion(region) {
  if (!region?.bbox || !isOnline()) return Promise.resolve();
  const b = region.bbox;
  const bounds = L.latLngBounds([b.south, b.west], [b.north, b.east]);
  const z0 = region.zmin ?? 6;
  const z1 = Math.min(region.zmax ?? SEEDED_MAX_ZOOM, SEEDED_MAX_ZOOM);
  return prefetchTiles(bounds, z0, z1);
}

const metaEl = document.getElementById('meta');
const statusEl = document.getElementById('status');
const panelEl = document.getElementById('panel');
const mapEl = document.getElementById('map');
const legendEl = document.getElementById('legend');
const sheet = document.getElementById('sheet');
const sheetTitle = document.getElementById('sheet-title');
const sheetSummary = document.getElementById('sheet-summary');
const sheetMeta = document.getElementById('sheet-meta');
const sheetLevel = document.getElementById('sheet-level');

let map;
let baseTiles;
let overlayGroup;
let offlineRegions = [];
let currentView = 'map-sea';
let data = {
  timeline: [],
  radar: [],
  satcom: [],
  geo: [],
  arcGeojson: null,
};

function showStatus(msg, ms = 2800) {
  if (!msg) {
    statusEl.hidden = true;
    return;
  }
  statusEl.textContent = msg;
  statusEl.hidden = false;
  if (ms > 0) setTimeout(() => { statusEl.hidden = true; }, ms);
}

function parseCsv(text) {
  const lines = text.replace(/^\uFEFF/, '').trim().split(/\r?\n/);
  if (!lines.length) return [];
  const headers = splitCsvLine(lines[0]);
  return lines.slice(1).filter(Boolean).map((line) => {
    const cols = splitCsvLine(line);
    const row = {};
    headers.forEach((h, i) => { row[h] = cols[i] ?? ''; });
    return row;
  });
}

function splitCsvLine(line) {
  const out = [];
  let cur = '';
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQ) {
      if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (c === '"') inQ = false;
      else cur += c;
    } else if (c === '"') inQ = true;
    else if (c === ',') { out.push(cur); cur = ''; }
    else cur += c;
  }
  out.push(cur);
  return out;
}

async function loadText(rel) {
  const url = resolveAssetUrl(rel);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${rel} ${res.status}`);
  return res.text();
}

async function loadJson(rel) {
  const url = resolveAssetUrl(rel);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${rel} ${res.status}`);
  return res.json();
}

function num(v) {
  if (v === '' || v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function openSheet({ title, summary, meta, badge }) {
  sheetTitle.textContent = title || '';
  sheetSummary.textContent = summary || '';
  sheetMeta.textContent = meta || '';
  sheetLevel.textContent = badge || '';
  sheetLevel.className = 'badge phase';
  sheet.hidden = false;
}

function closeSheet() {
  sheet.hidden = true;
}

function markerIcon(color) {
  return L.divIcon({
    className: '',
    html: `<span style="display:block;width:14px;height:14px;border-radius:50%;background:${color};border:2px solid #fff;box-shadow:0 0 0 1px rgba(0,0,0,.35)"></span>`,
    iconSize: [14, 14],
    iconAnchor: [7, 7],
  });
}

function buildOverlays() {
  if (overlayGroup) overlayGroup.clearLayers();
  else overlayGroup = L.layerGroup().addTo(map);

  // Seventh arc schematic band
  if (data.arcGeojson) {
    L.geoJSON(data.arcGeojson, {
      style: {
        color: '#a78bfa',
        weight: 2,
        fillColor: '#a78bfa',
        fillOpacity: 0.18,
      },
      onEachFeature(feat, layer) {
        const p = feat.properties || {};
        layer.on('click', () => openSheet({
          title: p.label_zh || '第七弧优先带',
          badge: '示意',
          summary: p.caveat || '示意优先纬度带，非精确 BTO 几何',
          meta: p.source || '',
        }));
      },
    }).addTo(overlayGroup);
  }

  // Radar / waypoint points with coords
  const pathPts = [];
  for (const r of data.radar) {
    const lat = num(r.lat);
    const lon = num(r.lon);
    if (lat == null || lon == null) continue;
    const name = r.waypoint_or_area || r.point_id;
    pathPts.push([lat, lon, r]);
    L.marker([lat, lon], { icon: markerIcon('#3b82f6') })
      .addTo(overlayGroup)
      .on('click', () => openSheet({
        title: name,
        badge: r.radar_type || '航路点',
        summary: (r.notes || r.heading_or_track_note || '').slice(0, 400),
        meta: `${r.time_utc || '无时间'} · 坐标为 IFR/公开参考，≠ 军用雷达原档`,
      }));
  }

  // Schematic corridor polyline using waypoints in narrative order if present
  const order = ['IGARI', 'BITOD', 'VAMPI', 'MEKAR'];
  const ordered = [];
  for (const w of order) {
    const hit = pathPts.find((p) => String(p[2].waypoint_or_area || '').includes(w));
    if (hit) ordered.push([hit[0], hit[1]]);
  }
  if (ordered.length >= 2) {
    L.polyline(ordered, {
      color: '#60a5fa',
      weight: 3,
      dashArray: '6 8',
      opacity: 0.85,
    }).addTo(overlayGroup);
  }

  // Extra geo reference markers
  for (const g of data.geo) {
    const lat = num(g.lat);
    const lon = num(g.lon);
    if (lat == null || lon == null) continue;
    const isSchematic = String(g.category || '').includes('schematic');
    const color = isSchematic ? '#f6ad55' : (g.category === 'airport' ? '#22c55e' : '#94a3b8');
    L.marker([lat, lon], { icon: markerIcon(color) })
      .addTo(overlayGroup)
      .on('click', () => openSheet({
        title: g.label_zh || g.name,
        badge: g.category || '参考',
        summary: g.notes || '',
        meta: g.source || '',
      }));
  }
}

function fitSea() {
  map.fitBounds([[2.4, 96.0], [7.6, 104.6]], { padding: [24, 24], maxZoom: 9 });
}

function fitArc() {
  map.fitBounds([[-37.0, 86.0], [-31.5, 106.0]], { padding: [24, 24], maxZoom: 6 });
}

function setView(view) {
  currentView = view;
  document.querySelectorAll('.filter-btn').forEach((b) => {
    b.classList.toggle('active', b.dataset.view === view);
  });
  const mapMode = view === 'map-sea' || view === 'map-arc';
  mapEl.classList.toggle('hidden', !mapMode);
  legendEl.hidden = !mapMode;
  panelEl.hidden = mapMode;
  if (mapMode) {
    requestAnimationFrame(() => map.invalidateSize());
    if (view === 'map-sea') fitSea();
    else fitArc();
  } else if (view === 'timeline') renderTimeline();
  else if (view === 'satcom') renderSatcom();
  else if (view === 'charts') renderCharts();
}

function renderTimeline() {
  const rows = data.timeline;
  panelEl.innerHTML = `
    <div class="caveat">公开时间线摘要，离线内置。详细分析见仓库 ANALYSIS_GUIDE。</div>
    <h2>关键时间线（${rows.length}）</h2>
    ${rows.map((r) => `
      <div class="card">
        <div class="t">${esc(r.time_utc)} · ${esc(r.phase)}</div>
        <div class="e">${esc(r.event)}</div>
      </div>`).join('')}
  `;
}

function renderSatcom() {
  const rows = data.satcom;
  panelEl.innerHTML = `
    <div class="caveat">关键握手 BTO/BFO（微秒 / Hz）。R600 与 R1200 比较前需减 4600 µs（见数据包说明）。</div>
    <h2>Inmarsat 关键握手（${rows.length}）</h2>
    ${rows.map((r) => `
      <div class="card">
        <div class="t">${esc(r.handshake_id || '')} · ${esc(r.time_utc)} · ${esc(r.arc_name || '')}</div>
        <div class="e">${esc(r.message_type || '')}</div>
        <div class="t">BTO ${esc(r.bto_us || '—')} µs · BFO ${esc(r.bfo_hz || '—')} Hz</div>
      </div>`).join('')}
  `;
}

function renderCharts() {
  const figs = [
    ['figures/01_timeline_by_phase.png', '分阶段时间线'],
    ['figures/02_bto_vs_time.png', 'BTO–时间'],
    ['figures/03_bfo_vs_time.png', 'BFO–时间'],
    ['figures/04_arc_summary.png', '弧段摘要'],
    ['figures/06_map_sea_corridor.png', '走廊静态图'],
    ['figures/07_map_seventh_arc_band.png', '第七弧静态图'],
  ];
  panelEl.innerHTML = `
    <div class="caveat">图表由公开 CSV 生成，已打包进 APK，可离线查看。</div>
    <div class="charts">
      ${figs.map(([src, cap]) => `
        <figure>
          <img src="${resolveAssetUrl(src)}" alt="${esc(cap)}" loading="lazy" />
          <figcaption class="t">${esc(cap)}</figcaption>
        </figure>`).join('')}
    </div>
  `;
}

function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

async function init() {
  metaEl.textContent = isOnline() ? '在线（可回退拉瓦片）' : '离线模式';

  map = L.map('map', {
    zoomControl: true,
    attributionControl: true,
    maxZoom: 19,
  }).setView([5.5, 100.5], 6);

  baseTiles = createCachedTileLayer(L, {
    maxZoom: 19,
    attribution: '&copy; OpenStreetMap, &copy; CARTO',
  });
  baseTiles.addTo(map);
  syncOfflineZoomLimits(map, baseTiles);
  window.addEventListener('online', () => {
    metaEl.textContent = '在线（可回退拉瓦片）';
    syncOfflineZoomLimits(map, baseTiles);
  });
  window.addEventListener('offline', () => {
    metaEl.textContent = '离线模式';
    syncOfflineZoomLimits(map, baseTiles);
    showStatus(`离线：底图最高 z${SEEDED_MAX_ZOOM}`);
  });

  try {
    const [timelineTxt, radarTxt, satcomTxt, geoTxt, regions, arc] = await Promise.all([
      loadText('data/01_key_timeline.csv'),
      loadText('data/02_radar_track_points.csv'),
      loadText('data/03_inmarsat_satcom.csv'),
      loadText('data/geo_reference.csv'),
      loadJson('offline-regions.json').catch(() => ({ regions: [] })),
      loadJson('data/seventh_arc_priority_band_schematic.geojson').catch(() => null),
    ]);
    data.timeline = parseCsv(timelineTxt);
    data.radar = parseCsv(radarTxt);
    data.satcom = parseCsv(satcomTxt);
    data.geo = parseCsv(geoTxt);
    data.arcGeojson = arc;
    offlineRegions = Array.isArray(regions.regions) ? regions.regions : [];
    metaEl.textContent = `${isOnline() ? '在线' : '离线'} · 时间线 ${data.timeline.length} · 握手 ${data.satcom.length}`;
  } catch (e) {
    metaEl.textContent = '数据加载失败';
    showStatus(String(e.message || e), 5000);
  }

  buildOverlays();
  setView('map-sea');

  if (isOnline()) {
    for (const r of offlineRegions) prefetchRegion(r).catch(() => {});
  }

  document.getElementById('filters').addEventListener('click', (ev) => {
    const btn = ev.target.closest('[data-view]');
    if (!btn) return;
    setView(btn.dataset.view);
  });
  document.getElementById('btn-fit').addEventListener('click', () => {
    if (currentView === 'map-arc') fitArc();
    else fitSea();
  });
  document.getElementById('btn-close').addEventListener('click', closeSheet);
}

init().catch((e) => {
  metaEl.textContent = '启动失败';
  showStatus(String(e), 8000);
});
