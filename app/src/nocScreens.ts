import type { DeviceStatus, LabState } from './networkEngine';
import { deviceStatus } from './networkEngine';
import { allRacks, type DevicePlace } from './labLayout';
import type { NocSim, RackPower } from './labMetrics';

// Canvas renderers for the NOC video wall. Pure 2D — reused by both the 3D
// screen textures and the HTML detail panel so the two can never diverge.

export type NocScreenId = 'traffic' | 'bandwidth' | 'topology' | 'health' | 'power' | 'alerts' | 'devices' | 'dude';

export const NOC_SCREENS: { id: NocScreenId; title: string }[] = [
  { id: 'traffic', title: 'Internet Traffic' },
  { id: 'bandwidth', title: 'Bandwidth Utilization' },
  { id: 'topology', title: 'Network Topology' },
  { id: 'health', title: 'Network Health' },
  { id: 'power', title: 'Power Status' },
  { id: 'alerts', title: 'Alerts & Incidents' },
  { id: 'devices', title: 'Device Monitoring' },
  { id: 'dude', title: 'The Dude — DACEN Monitoring' },
];

export type NocData = {
  lab: LabState;
  sim: NocSim;
  statusCounts: Record<DeviceStatus, number>;
  analysis: { components: string[][]; isolatedDeviceIds: string[]; inactiveLinkIds: string[] };
  places: Map<string, DevicePlace>;
  selectedId: string | null;
  power: RackPower[];
};

const BG = '#08101a', PANEL = '#0d1927', CYAN = '#22d3ee', GREEN = '#34d399', RED = '#f87171', AMBER = '#fbbf24', DIM = '#5b6b7e', TEXT = '#dbe7f3', PURPLE = '#a78bfa';
const KIND_LABEL: Record<string, string> = { router: 'Router', switch: 'Switch', olt: 'OLT', ont: 'ONT', pc: 'PC', server: 'Server' };
const STATUS_COLOR: Record<DeviceStatus, string> = { up: GREEN, idle: '#7c8aa0', error: RED };
const MONO = 'px "Courier New", monospace';

function header(ctx: CanvasRenderingContext2D, w: number, title: string) {
  ctx.fillStyle = BG; ctx.fillRect(0, 0, w, 34);
  ctx.fillStyle = TEXT; ctx.font = 'bold 14' + MONO; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
  ctx.fillText(title, 12, 17);
  ctx.fillStyle = CYAN; ctx.fillRect(0, 34, w, 2);
}

function badge(ctx: CanvasRenderingContext2D, w: number, text: string, color = AMBER) {
  ctx.font = 'bold 9' + MONO;
  const tw = ctx.measureText(text).width;
  const bx = w - tw - 22, by = 8;
  ctx.strokeStyle = color; ctx.lineWidth = 1; ctx.strokeRect(bx, by, tw + 12, 16);
  ctx.fillStyle = color; ctx.textAlign = 'left'; ctx.fillText(text, bx + 6, by + 8);
}

type MapTransform = { x: (rx: number) => number; y: (rz: number) => number };

// The topology map derives its bounds from the actual rack positions by way of
// the device places (the shared layout module owns the real coordinates).
function mapTransform(d: NocData, rx0: number, ry0: number, rw: number, rh: number): MapTransform {
  const racks = allRacks();
  const places = [...d.places.values()];
  const xs = [...racks.map(r => r.rx), ...places.map(p => p.rx)];
  const zs = [...racks.map(r => r.rz), ...places.map(p => p.rz)];
  const minRx = Math.min(...xs), maxRx = Math.max(...xs);
  const minRz = Math.min(...zs), maxRz = Math.max(...zs);
  const nx = (v: number) => (maxRx - minRx < 1e-6 ? 0.5 : (v - minRx) / (maxRx - minRx));
  const nz = (v: number) => (maxRz - minRz < 1e-6 ? 0.5 : (v - minRz) / (maxRz - minRz));
  return {
    x: (rx) => rx0 + 20 + nx(rx) * (rw - 40),
    y: (rz) => ry0 + 18 + nz(rz) * (rh - 36),
  };
}

function nodePositions(d: NocData, rx0: number, ry0: number, rw: number, rh: number) {
  const perRack = new Map<number, string[]>();
  d.lab.devices.forEach(dev => { const p = d.places.get(dev.id); if (!p) return; const arr = perRack.get(p.rack) ?? []; arr.push(dev.id); perRack.set(p.rack, arr); });
  const t = mapTransform(d, rx0, ry0, rw, rh);
  const out: { id: string; x: number; y: number; status: DeviceStatus; name: string }[] = [];
  d.lab.devices.forEach(dev => {
    const p = d.places.get(dev.id); if (!p) return;
    const sameRack = perRack.get(p.rack) ?? [];
    const idx = sameRack.indexOf(dev.id);
    const spread = (idx - (sameRack.length - 1) / 2) * 8;
    out.push({
      id: dev.id,
      x: t.x(p.rx) + spread,
      y: t.y(p.rz),
      status: deviceStatus(dev, d.lab),
      name: dev.name,
    });
  });
  return out;
}

function drawMap(ctx: CanvasRenderingContext2D, d: NocData, rx0: number, ry0: number, rw: number, rh: number) {
  ctx.fillStyle = PANEL; ctx.fillRect(rx0, ry0, rw, rh);
  ctx.strokeStyle = '#1c2c3f'; ctx.lineWidth = 1;
  const t = mapTransform(d, rx0, ry0, rw, rh);
  const racks = allRacks();
  const rows = [...new Set(racks.map(r => r.rz))].sort((a, b) => a - b);
  const cols = [...new Set(racks.map(r => r.rx))].sort((a, b) => a - b);
  // Rows run along Z, so each rack row is a vertical column on the map.
  cols.forEach(rx => {
    const x = t.x(rx);
    ctx.strokeStyle = '#1c2c3f';
    ctx.beginPath(); ctx.moveTo(x, ry0 + 14); ctx.lineTo(x, ry0 + rh - 10); ctx.stroke();
  });
  rows.forEach(rz => {
    const y = t.y(rz);
    ctx.strokeStyle = '#1c2c3f';
    ctx.beginPath(); ctx.moveTo(rx0 + 14, y); ctx.lineTo(rx0 + rw - 10, y); ctx.stroke();
  });
  const blocks = [...new Set(racks.map(r => r.aisle))];
  blocks.forEach(aisle => {
    const blockRacks = racks.filter(r => r.aisle === aisle);
    const x = t.x(blockRacks.reduce((a, b) => a + b.rx, 0) / blockRacks.length);
    const topZ = Math.min(...blockRacks.map(r => r.rz));
    const y = Math.max(ry0 + 10, t.y(topZ) - 6);
    ctx.fillStyle = DIM; ctx.font = 'bold 8' + MONO; ctx.textAlign = 'center';
    ctx.fillText(`LORONG ${aisle}`, x, y);
  });
  const nodes = nodePositions(d, rx0, ry0, rw, rh);
  const byId = new Map(nodes.map(n => [n.id, n]));
  const inactive = new Set(d.analysis.inactiveLinkIds);
  d.lab.links.forEach(l => {
    const a = byId.get(l.from), b = byId.get(l.to);
    if (!a || !b) return;
    ctx.strokeStyle = inactive.has(l.id) ? RED : 'rgba(34,211,238,.4)';
    ctx.lineWidth = inactive.has(l.id) ? 1.6 : 1;
    ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
  });
  const showNames = nodes.length <= 18;
  nodes.forEach(n => {
    ctx.fillStyle = STATUS_COLOR[n.status];
    ctx.beginPath(); ctx.arc(n.x, n.y, 6, 0, Math.PI * 2); ctx.fill();
    if (n.id === d.selectedId) { ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.6; ctx.beginPath(); ctx.arc(n.x, n.y, 9, 0, Math.PI * 2); ctx.stroke(); }
    if (showNames) {
      ctx.fillStyle = TEXT; ctx.font = '8' + MONO; ctx.textAlign = 'center';
      ctx.fillText(n.name.slice(0, 12), n.x, n.y + 13);
    }
  });
  return nodes;
}

function fmtMbps(v: number): string {
  return v >= 1000 ? (v / 1000).toFixed(2) + ' Gbps' : Math.round(v) + ' Mbps';
}

function drawTraffic(ctx: CanvasRenderingContext2D, w: number, h: number, d: NocData) {
  header(ctx, w, 'INTERNET TRAFFIC');
  badge(ctx, w, 'SIMULATED DATA');
  ctx.fillStyle = TEXT; ctx.font = 'bold 12' + MONO; ctx.textAlign = 'left';
  ctx.fillText(`▼ ${fmtMbps(d.sim.totalDown)}   ▲ ${fmtMbps(d.sim.totalUp)}`, 12, 52);
  const gx = 12, gy = 66, gw = w - 24, gh = h - 100;
  ctx.fillStyle = PANEL; ctx.fillRect(gx, gy, gw, gh);
  const hist = d.sim.traffic;
  const max = Math.max(100, ...hist.map(s => Math.max(s.down, s.up))) * 1.2;
  ctx.strokeStyle = '#16283c'; ctx.beginPath();
  for (let i = 1; i < 4; i++) { const y = gy + (gh * i) / 4; ctx.moveTo(gx, y); ctx.lineTo(gx + gw, y); }
  ctx.stroke();
  ctx.fillStyle = DIM; ctx.font = '8' + MONO; ctx.textAlign = 'right';
  for (let i = 0; i < 4; i++) ctx.fillText(fmtMbps((max * (4 - i)) / 4), gx + gw - 4, gy + (gh * i) / 4 + 8);
  const line = (key: 'down' | 'up', color: string) => {
    if (hist.length < 2) return;
    ctx.strokeStyle = color; ctx.lineWidth = 1.6; ctx.beginPath();
    hist.forEach((s, i) => {
      const x = gx + 4 + (i / (HIST_SPAN - 1)) * (gw - 8);
      const y = gy + gh - 6 - (s[key] / max) * (gh - 12);
      i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
    });
    ctx.stroke();
  };
  line('down', CYAN); line('up', PURPLE);
  ctx.font = '9' + MONO; ctx.textAlign = 'left';
  ctx.fillStyle = CYAN; ctx.fillText('■ download', gx + 4, h - 14);
  ctx.fillStyle = PURPLE; ctx.fillText('■ upload', gx + 90, h - 14);
  ctx.fillStyle = DIM; ctx.textAlign = 'right'; ctx.fillText(`${hist.length}/${90} sampel · 2s interval`, w - 12, h - 14);
}
const HIST_SPAN = 90;

function drawBandwidth(ctx: CanvasRenderingContext2D, w: number, d: NocData) {
  header(ctx, w, 'BANDWIDTH UTILIZATION');
  badge(ctx, w, 'SIMULATED DATA');
  const byKind: Record<string, number> = {};
  d.sim.devices.forEach(v => { byKind[v.kind] = (byKind[v.kind] ?? 0) + v.downMbps + v.upMbps; });
  ctx.fillStyle = TEXT; ctx.font = 'bold 22' + MONO; ctx.textAlign = 'left';
  ctx.fillText(`▼ ${fmtMbps(d.sim.totalDown)}`, 14, 68);
  ctx.fillText(`▲ ${fmtMbps(d.sim.totalUp)}`, 14, 100);
  const bx = 14, by = 122, bw = w * 0.52, bh = 22;
  ctx.fillStyle = PANEL; ctx.fillRect(bx, by, bw, bh);
  const frac = Math.min(1, d.sim.utilPct / 100);
  ctx.fillStyle = d.sim.utilPct > 80 ? RED : d.sim.utilPct > 55 ? AMBER : CYAN;
  ctx.fillRect(bx, by, bw * frac, bh);
  ctx.strokeStyle = '#2a3d52'; ctx.strokeRect(bx, by, bw, bh);
  ctx.fillStyle = TEXT; ctx.font = 'bold 11' + MONO;
  ctx.fillText(`UTILIZATION ${d.sim.utilPct}%  of  ${fmtMbps(d.sim.capacityMbps)} metro capacity`, bx, by + 40);
  ctx.fillStyle = DIM; ctx.font = '9' + MONO;
  ctx.fillText('kapasitas & trafik = simulasi internal, bukan telemetry nyata', bx, by + 58);
  const kinds = Object.keys(byKind);
  const maxK = Math.max(1, ...kinds.map(k => byKind[k]));
  const lx = w * 0.58, ly = 56;
  ctx.fillStyle = DIM; ctx.font = '9' + MONO; ctx.textAlign = 'left';
  ctx.fillText('DOWN+UP PER JENIS PERANGKAT', lx, ly - 10);
  kinds.forEach((k, i) => {
    const y = ly + i * 24;
    ctx.fillStyle = TEXT; ctx.fillText(KIND_LABEL[k] ?? k, lx, y + 8);
    ctx.fillStyle = PANEL; ctx.fillRect(lx + 58, y, 120, 10);
    ctx.fillStyle = CYAN; ctx.fillRect(lx + 58, y, 120 * (byKind[k] / maxK), 10);
    ctx.fillStyle = DIM; ctx.fillText(fmtMbps(byKind[k]), lx + 184, y + 8);
  });
}

function drawTopology(ctx: CanvasRenderingContext2D, w: number, h: number, d: NocData) {
  header(ctx, w, 'NETWORK TOPOLOGY');
  drawMap(ctx, d, 10, 44, w - 20, h - 78);
  const legend: [string, string][] = [[GREEN, 'online'], ['#7c8aa0', 'idle'], [RED, 'error / link putus'], [CYAN, 'link aktif']];
  let lx = 14;
  legend.forEach(([c, t]) => {
    ctx.fillStyle = c; ctx.fillRect(lx, h - 20, 8, 8);
    ctx.fillStyle = DIM; ctx.font = '9' + MONO; ctx.textAlign = 'left'; ctx.fillText(t, lx + 12, h - 13);
    lx += 24 + ctx.measureText(t).width + 18;
  });
}

function drawHealth(ctx: CanvasRenderingContext2D, w: number, h: number, d: NocData) {
  header(ctx, w, 'NETWORK HEALTH');
  const a = d.analysis;
  const activeLinks = d.lab.links.length - a.inactiveLinkIds.length;
  const score = !d.lab.devices.length ? '—' : Math.round(100 * ((d.lab.devices.length - d.statusCounts.error - a.isolatedDeviceIds.length) + (d.lab.links.length ? activeLinks : 0)) / Math.max(1, d.lab.devices.length + d.lab.links.length)) + '%';
  const cards: [string, string | number, string][] = [
    ['ONLINE DEVICES', d.statusCounts.up, GREEN],
    ['IDLE DEVICES', d.statusCounts.idle, '#7c8aa0'],
    ['ERROR DEVICES', d.statusCounts.error, d.statusCounts.error ? RED : GREEN],
    ['ACTIVE LINKS', activeLinks, GREEN],
    ['INACTIVE LINKS', a.inactiveLinkIds.length, a.inactiveLinkIds.length ? RED : GREEN],
    ['ISOLATED', a.isolatedDeviceIds.length, a.isolatedDeviceIds.length ? RED : GREEN],
    ['SEGMENTS', a.components.length, TEXT],
    ['DEVICES', d.lab.devices.length, TEXT],
    ['HEALTH SCORE', score, score === '—' ? TEXT : score === '100%' ? GREEN : AMBER],
  ];
  const cw = (w - 40) / 3, ch = (h - 100) / 3;
  cards.forEach(([label, val, color], i) => {
    const x = 14 + (i % 3) * (cw + 6), y = 46 + Math.floor(i / 3) * (ch + 6);
    ctx.fillStyle = PANEL; ctx.fillRect(x, y, cw, ch);
    ctx.strokeStyle = '#1c2c3f'; ctx.strokeRect(x, y, cw, ch);
    ctx.fillStyle = DIM; ctx.font = '8' + MONO; ctx.textAlign = 'left'; ctx.fillText(label, x + 8, y + 14);
    ctx.fillStyle = color; ctx.font = 'bold 20' + MONO; ctx.fillText(String(val), x + 8, y + 34);
  });
  const ok = d.statusCounts.error === 0 && a.inactiveLinkIds.length === 0 && a.isolatedDeviceIds.length === 0;
  ctx.fillStyle = ok ? GREEN : AMBER; ctx.font = 'bold 10' + MONO; ctx.textAlign = 'left';
  ctx.fillText(ok ? '● All systems operational' : `● ${d.sim.issues.length} issue(s) terdeteksi — cek Alerts`, 14, h - 12);
}

function drawAlerts(ctx: CanvasRenderingContext2D, w: number, h: number, d: NocData) {
  header(ctx, w, 'ALERTS & INCIDENTS');
  const issues = d.sim.issues;
  if (!issues.length) {
    ctx.fillStyle = GREEN; ctx.font = 'bold 12' + MONO; ctx.textAlign = 'left';
    ctx.fillText('● Tidak ada insiden aktif', 14, 64);
    ctx.fillStyle = DIM; ctx.font = '9' + MONO;
    ctx.fillText('Semua perangkat dan link beroperasi normal.', 14, 84);
    return;
  }
  issues.slice(0, 6).forEach((iss, i) => {
    const y = 46 + i * 36;
    ctx.fillStyle = PANEL; ctx.fillRect(10, y, w - 20, 32);
    ctx.fillStyle = iss.severity === 'critical' ? RED : AMBER;
    ctx.fillRect(10, y, 4, 32);
    ctx.font = 'bold 10' + MONO; ctx.textAlign = 'left';
    ctx.fillStyle = iss.severity === 'critical' ? RED : AMBER;
    ctx.fillText(iss.severity === 'critical' ? 'CRIT' : 'WARN', 20, y + 11);
    ctx.fillStyle = TEXT;
    ctx.fillText(iss.label.slice(0, Math.floor((w - 150) / 6)), 58, y + 11);
    ctx.fillStyle = DIM; ctx.font = '8' + MONO;
    ctx.fillText(iss.detail.slice(0, Math.floor((w - 40) / 5)), 20, y + 24);
    ctx.fillStyle = DIM; ctx.textAlign = 'right';
    ctx.fillText(d.sim.issueFirstSeen.get(iss.key) ?? '', w - 16, y + 11);
  });
  if (issues.length > 6) {
    ctx.fillStyle = DIM; ctx.font = '9' + MONO; ctx.textAlign = 'left';
    ctx.fillText(`+${issues.length - 6} insiden lainnya…`, 14, h - 12);
  }
}

function drawDevices(ctx: CanvasRenderingContext2D, w: number, h: number, d: NocData) {
  header(ctx, w, 'DEVICE MONITORING');
  badge(ctx, w, 'METRIK: SIMULATED', CYAN);
  ctx.fillStyle = DIM; ctx.font = '8' + MONO; ctx.textAlign = 'left';
  ctx.fillText('STATUS = DATA ENGINE · PING/LOSS = SIMULASI', 12, 48);
  const rows = d.sim.devices.slice(0, 8);
  rows.forEach((v, i) => {
    const y = 58 + i * 26;
    ctx.fillStyle = i % 2 ? '#0b1622' : PANEL;
    ctx.fillRect(10, y, w - 20, 23);
    ctx.fillStyle = STATUS_COLOR[v.status];
    ctx.beginPath(); ctx.arc(20, y + 11, 4, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = TEXT; ctx.font = 'bold 10' + MONO;
    ctx.fillText(v.name.slice(0, 14), 32, y + 12);
    ctx.fillStyle = DIM; ctx.font = '9' + MONO;
    ctx.fillText(KIND_LABEL[v.kind] ?? v.kind, 132, y + 12);
    const place = d.places.get(v.id);
    ctx.fillText(place ? `RACK ${place.rack + 1}` : '—', 190, y + 12);
    ctx.fillStyle = v.reachable ? GREEN : RED;
    ctx.fillText(v.reachable ? `${v.pingMs} ms` : 'no resp', 250, y + 12);
    ctx.fillStyle = v.lossPct >= 20 ? RED : v.lossPct >= 5 ? AMBER : GREEN;
    ctx.fillText(`loss ${v.lossPct}%`, 322, y + 12);
    ctx.fillStyle = DIM;
    ctx.fillText(`▼ ${fmtMbps(v.downMbps)}`, 396, y + 12);
  });
  if (d.sim.devices.length > 8) {
    ctx.fillStyle = DIM; ctx.font = '9' + MONO;
    ctx.fillText(`+${d.sim.devices.length - 8} perangkat lain — buka panel detail`, 12, h - 10);
  }
}

function drawDude(ctx: CanvasRenderingContext2D, w: number, h: number, d: NocData) {
  header(ctx, w, 'THE DUDE — DACEN MONITORING');
  badge(ctx, w, 'SIMULATION · BUKAN DUDE ASLI', AMBER);
  const mapW = Math.floor(w * 0.56);
  drawMap(ctx, d, 10, 44, mapW, h - 110);
  const tx = mapW + 20, tw = w - mapW - 30;
  ctx.fillStyle = DIM; ctx.font = '8' + MONO; ctx.textAlign = 'left';
  ctx.fillText('PERANGKAT · PING · LOSS · UPTIME (SIM)', tx, 52);
  d.sim.devices.slice(0, 6).forEach((v, i) => {
    const y = 60 + i * 22;
    ctx.fillStyle = i % 2 ? '#0b1622' : PANEL;
    ctx.fillRect(tx - 4, y, tw, 19);
    ctx.fillStyle = STATUS_COLOR[v.status];
    ctx.beginPath(); ctx.arc(tx + 4, y + 9, 3.5, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = TEXT; ctx.font = 'bold 9' + MONO;
    ctx.fillText(v.name.slice(0, 11), tx + 13, y + 10);
    ctx.fillStyle = v.reachable ? (v.pingMs > 50 ? AMBER : GREEN) : RED;
    ctx.fillText(v.reachable ? `${v.pingMs}` : '—', tx + 86, y + 10);
    ctx.fillStyle = v.lossPct >= 20 ? RED : v.lossPct >= 5 ? AMBER : GREEN;
    ctx.fillText(`${v.lossPct}%`, tx + 122, y + 10);
    ctx.fillStyle = DIM;
    ctx.fillText(`${v.uptimePct}%`, tx + 156, y + 10);
  });
  const iy = h - 60;
  ctx.fillStyle = DIM; ctx.font = '8' + MONO; ctx.textAlign = 'left';
  ctx.fillText('INCIDENTS', 12, iy);
  if (!d.sim.issues.length) {
    ctx.fillStyle = GREEN; ctx.font = '9' + MONO;
    ctx.fillText('Tidak ada alarm — semua perangkat merespons.', 12, iy + 16);
  } else {
    d.sim.issues.slice(0, 2).forEach((iss, i) => {
      const y = iy + 10 + i * 17;
      ctx.fillStyle = iss.severity === 'critical' ? RED : AMBER;
      ctx.font = 'bold 9' + MONO;
      ctx.fillText(`● ${iss.label.slice(0, Math.floor((w - 60) / 5.4))}`, 12, y + 8);
    });
  }
}

function drawPower(ctx: CanvasRenderingContext2D, w: number, h: number, d: NocData) {
  header(ctx, w, 'POWER STATUS — DC LORONG A/B/C');
  badge(ctx, w, 'WATT: SIMULATED');
  const gridX = 8;
  const gridY = 40;
  const gridW = w - 16;
  const gridH = h - 68;
  const gapX = 6;
  const gapY = 4;
  const tileW = (gridW - gapX * 3) / 4;
  const tileH = (gridH - gapY * 5) / 6;
  const compact = tileH < 58;

  d.power.forEach((rack, index) => {
    const col = index % 4;
    const row = Math.floor(index / 4);
    const x = gridX + col * (tileW + gapX);
    const y = gridY + row * (tileH + gapY);
    const sourceColor = rack.source === 'PLN' ? GREEN : rack.source === 'GENSET' ? AMBER : RED;
    ctx.fillStyle = col % 2 ? '#0b1724' : PANEL;
    ctx.fillRect(x, y, tileW, tileH);
    ctx.strokeStyle = rack.source === 'OFF' ? '#5f2830' : '#1d4b4e';
    ctx.lineWidth = 1;
    ctx.strokeRect(x, y, tileW, tileH);

    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = TEXT;
    ctx.font = `bold ${compact ? 7 : 10}px "Courier New", monospace`;
    ctx.fillText(`LORONG ${rack.aisle} · R${rack.row}`, x + 7, y + (compact ? 9 : 13));

    const ledRadius = compact ? 5 : 8;
    const ledX = x + tileW - (compact ? 10 : 16);
    const ledY = y + (compact ? 11 : 16);
    ctx.fillStyle = sourceColor;
    ctx.beginPath();
    ctx.arc(ledX, ledY, ledRadius, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = sourceColor;
    ctx.font = `bold ${compact ? 6 : 8}px "Courier New", monospace`;
    ctx.textAlign = 'right';
    ctx.fillText(rack.source, ledX - ledRadius - 3, ledY);

    ctx.textAlign = 'left';
    ctx.fillStyle = TEXT;
    ctx.font = `${compact ? 7 : 9}px "Courier New", monospace`;
    ctx.fillText(`online ${rack.onlineDevices}/${rack.totalDevices}`, x + 7, y + (compact ? 22 : 31));
    ctx.fillStyle = DIM;
    ctx.font = `${compact ? 6 : 8}px "Courier New", monospace`;
    ctx.fillText(`standby ${rack.standbyDevices} · offline ${rack.offlineDevices}`, x + 7, y + (compact ? 31 : 45));

    const badgeY = y + tileH - (compact ? 13 : 20);
    const badgeH = compact ? 10 : 14;
    ctx.fillStyle = rack.source === 'OFF' ? '#2b1418' : '#211c10';
    ctx.fillRect(x + 5, badgeY, tileW - 10, badgeH);
    ctx.strokeStyle = sourceColor;
    ctx.strokeRect(x + 5, badgeY, tileW - 10, badgeH);
    ctx.fillStyle = sourceColor;
    ctx.font = `bold ${compact ? 6 : 8}px "Courier New", monospace`;
    ctx.textAlign = 'center';
    ctx.fillText(`${rack.watt} W · SIMULATED`, x + tileW / 2, badgeY + badgeH / 2);
  });

  const totalWatt = d.power.reduce((sum, rack) => sum + rack.watt, 0);
  const powered = d.power.filter(rack => rack.powerOn).length;
  const darkAisles = new Set(d.power.filter(rack => rack.source === 'OFF').map(rack => rack.aisle)).size;
  const gensetAisles = new Set(d.power.filter(rack => rack.source === 'GENSET').map(rack => rack.aisle)).size;
  const footer = darkAisles > 0
    ? `BLACKOUT — ${darkAisles} lorong gelap`
    : gensetAisles > 0
      ? `GENSET aktif — ${gensetAisles} lorong`
      : `Sumber: PLN — ${powered}/${d.power.length} rack`;
  ctx.textAlign = 'left';
  ctx.fillStyle = AMBER;
  ctx.font = `bold ${compact ? 7 : 9}px "Courier New", monospace`;
  ctx.fillText(`TOTAL BEBAN: ${(totalWatt / 1000).toFixed(2)} kW · SIMULATED`, 10, h - 12);
  ctx.fillStyle = darkAisles > 0 ? RED : gensetAisles > 0 ? AMBER : GREEN;
  ctx.textAlign = 'right';
  ctx.fillText(footer, w - 10, h - 12);
}

export function drawScreen(id: NocScreenId, ctx: CanvasRenderingContext2D, w: number, h: number, d: NocData) {
  ctx.save();
  ctx.fillStyle = BG; ctx.fillRect(0, 0, w, h);
  switch (id) {
    case 'traffic': drawTraffic(ctx, w, h, d); break;
    case 'bandwidth': drawBandwidth(ctx, w, d); break;
    case 'topology': drawTopology(ctx, w, h, d); break;
    case 'health': drawHealth(ctx, w, h, d); break;
    case 'power': drawPower(ctx, w, h, d); break;
    case 'alerts': drawAlerts(ctx, w, h, d); break;
    case 'devices': drawDevices(ctx, w, h, d); break;
    case 'dude': drawDude(ctx, w, h, d); break;
  }
  ctx.restore();
}

export function pickAt(id: NocScreenId, mx: number, my: number, w: number, h: number, d: NocData): string | null {
  const hitNode = (rx0: number, ry0: number, rw: number, rh: number): string | null => {
    const nodes = nodePositions(d, rx0, ry0, rw, rh);
    let best: { id: string; dist: number } | null = null;
    nodes.forEach(n => {
      const dist = Math.hypot(n.x - mx, n.y - my);
      if (dist < 14 && (!best || dist < best.dist)) best = { id: n.id, dist };
    });
    return best ? (best as { id: string }).id : null;
  };
  if (id === 'power') return null;
  if (id === 'topology') return hitNode(10, 44, w - 20, h - 78);
  if (id === 'dude') {
    const mapW = Math.floor(w * 0.56);
    const inMap = hitNode(10, 44, mapW, h - 110);
    if (inMap) return inMap;
    const idx = Math.floor((my - 60) / 22);
    if (mx >= Math.floor(w * 0.56) + 16 && idx >= 0 && idx < Math.min(6, d.sim.devices.length)) return d.sim.devices[idx].id;
    return null;
  }
  if (id === 'devices') {
    const idx = Math.floor((my - 58) / 26);
    if (idx >= 0 && idx < Math.min(8, d.sim.devices.length)) return d.sim.devices[idx].id;
    return null;
  }
  if (id === 'alerts') {
    const idx = Math.floor((my - 46) / 36);
    if (idx >= 0 && idx < d.sim.issues.length) return d.sim.issues[idx].deviceId ?? null;
  }
  return null;
}
