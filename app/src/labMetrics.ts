import type { Device, DeviceStatus, LabState } from './networkEngine';
import { deviceStatus, analyzeNetwork } from './networkEngine';
import { allRacks, RACK_H, type Aisle, type DevicePlace } from './labLayout';

// SIMULATED metrics layer — deterministic per device id + status.
// Nothing here claims to be real telemetry: every screen using these values
// must display the SIMULATED DATA label (see nocScreens.ts).

const hash01 = (s: string): number => {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0) / 4294967296;
};

export type DeviceSim = {
  id: string; name: string; kind: string; status: DeviceStatus;
  pingMs: number; lossPct: number; uptimePct: number;
  downMbps: number; upMbps: number; reachable: boolean;
};

export function simDevice(d: Device, status: DeviceStatus, t: number): DeviceSim {
  const s = hash01(d.id);
  const phase = s * Math.PI * 2;
  const wave = 0.5 + 0.5 * Math.sin(t * 0.35 + phase);
  const base = 40 + 620 * s;
  if (status === 'error') {
    return { id: d.id, name: d.name, kind: d.kind, status, pingMs: 0, lossPct: 100, uptimePct: Math.round(20 + 40 * s), downMbps: 0, upMbps: 0, reachable: false };
  }
  if (status === 'idle') {
    return { id: d.id, name: d.name, kind: d.kind, status, pingMs: Math.round((8 + 30 * s) * 10) / 10, lossPct: 0, uptimePct: Math.round((97 + 2.9 * s) * 10) / 10, downMbps: Math.round(base * 0.03 * (0.5 + wave)), upMbps: Math.round(base * 0.01 * (0.5 + wave)), reachable: true };
  }
  return { id: d.id, name: d.name, kind: d.kind, status, pingMs: Math.round((2 + 18 * s + 6 * wave) * 10) / 10, lossPct: Math.round(40 * s) / 10, uptimePct: Math.round((99 + 0.9 * s) * 100) / 100, downMbps: Math.round(base * (0.55 + 0.45 * wave)), upMbps: Math.round(base * 0.3 * (0.4 + 0.6 * wave)), reachable: true };
}

export type TrafficSample = { down: number; up: number };
const HISTORY: TrafficSample[] = [];
const HISTORY_MAX = 90;
let lastBucket = -1;

export type Issue = {
  key: string; severity: 'critical' | 'warning'; type: 'device' | 'link' | 'isolated';
  deviceId?: string; linkId?: string; label: string; detail: string;
};

export type NocSim = {
  devices: DeviceSim[];
  totalDown: number; totalUp: number; capacityMbps: number; utilPct: number;
  traffic: TrafficSample[];
  issues: Issue[];
  issueFirstSeen: Map<string, string>;
};

const firstSeen = new Map<string, string>();
const fmtTime = () => new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' });

export function simNetwork(lab: LabState): NocSim {
  const t = Date.now() / 1000;
  const devices = lab.devices.map(d => simDevice(d, deviceStatus(d, lab), t));
  const totalDown = devices.reduce((a, v) => a + v.downMbps, 0);
  const totalUp = devices.reduce((a, v) => a + v.upMbps, 0);
  const capacityMbps = 10000;
  const bucket = Math.floor(Date.now() / 2000);
  if (bucket !== lastBucket) {
    lastBucket = bucket;
    HISTORY.push({ down: totalDown, up: totalUp });
    if (HISTORY.length > HISTORY_MAX) HISTORY.shift();
  }
  const analysis = analyzeNetwork(lab);
  const issues: Issue[] = [];
  lab.devices.forEach(d => {
    if (deviceStatus(d, lab) === 'error') {
      const key = `dev:${d.id}`;
      if (!firstSeen.has(key)) firstSeen.set(key, fmtTime());
      issues.push({ key, severity: 'critical', type: 'device', deviceId: d.id, label: d.poweredOff ? `${d.name} POWER OFF` : `${d.name} ERROR`, detail: d.poweredOff ? 'Device is switched off — no response to ping.' : 'Internal failure detected on device.' });
    }
  });
  analysis.inactiveLinkIds.forEach(id => {
    const l = lab.links.find(x => x.id === id);
    if (!l) return;
    const key = `link:${id}`;
    if (!firstSeen.has(key)) firstSeen.set(key, fmtTime());
    const a = lab.devices.find(d => d.id === l.from), b = lab.devices.find(d => d.id === l.to);
    issues.push({ key, severity: 'critical', type: 'link', linkId: id, deviceId: l.from, label: `LINK DOWN: ${a?.name ?? '?'} ↔ ${b?.name ?? '?'}`, detail: `Cable ${a?.name ?? '?'} (${l.fromPort}) ↔ ${b?.name ?? '?'} (${l.toPort}) is not operational.` });
  });
  analysis.isolatedDeviceIds.forEach(id => {
    const d = lab.devices.find(x => x.id === id);
    if (!d) return;
    const key = `iso:${id}`;
    if (!firstSeen.has(key)) firstSeen.set(key, fmtTime());
    issues.push({ key, severity: 'warning', type: 'isolated', deviceId: id, label: `ISOLATED: ${d.name}`, detail: 'No operational link to any other device.' });
  });
  const activeKeys = new Set(issues.map(i => i.key));
  [...firstSeen.keys()].forEach(k => { if (!activeKeys.has(k)) firstSeen.delete(k); });
  return { devices, totalDown, totalUp, capacityMbps, utilPct: Math.round(1000 * Math.max(totalDown, totalUp) / capacityMbps) / 10, traffic: HISTORY, issues, issueFirstSeen: firstSeen };
}

export type PowerGrid = {
  breakers: { A: boolean; B: boolean; C: boolean };
  plnOn: boolean;
  gensetOn: boolean;
};

export type PowerSource = 'PLN' | 'GENSET' | 'OFF';

export const DEFAULT_POWER_GRID: PowerGrid = {
  breakers: { A: true, B: true, C: true },
  plnOn: true,
  gensetOn: false,
};

export function isAislePowered(grid: PowerGrid, aisle: Aisle): boolean {
  return grid.breakers[aisle] && (grid.plnOn || grid.gensetOn);
}

export function powerSourceForAisle(grid: PowerGrid, aisle: Aisle): PowerSource {
  if (!isAislePowered(grid, aisle)) return 'OFF';
  return grid.plnOn ? 'PLN' : 'GENSET';
}

export type RackPower = {
  rack: number;
  aisle: Aisle;
  row: number;
  powerOn: boolean;
  source: PowerSource;
  onlineDevices: number;
  standbyDevices: number;
  offlineDevices: number;
  totalDevices: number;
  watt: number;
};

const RACK_BASE_WATT = 380;
const FULL_DEVICE_WATT = 55;
const STANDBY_RATIO = 0.6;
const OFFLINE_DEVICE_WATT = 2;
const POWER_WAVE_WATT = Math.max(1, Math.round(RACK_H / 0.7));

export function powerModel(lab: LabState, places: Map<string, DevicePlace>, grid: PowerGrid = DEFAULT_POWER_GRID): RackPower[] {
  const counts = new Map<number, { online: number; standby: number; offline: number; total: number }>();
  lab.devices.forEach(device => {
    const place = places.get(device.id);
    if (!place) return;
    const current = counts.get(place.rack) ?? { online: 0, standby: 0, offline: 0, total: 0 };
    const status = deviceStatus(device, lab);
    if (device.poweredOff || status === 'error') current.offline += 1;
    else if (status === 'idle') current.standby += 1;
    else current.online += 1;
    current.total += 1;
    counts.set(place.rack, current);
  });

  const aisleRows = new Map<string, number>();
  return allRacks().map((coord, rack) => {
    const row = (aisleRows.get(coord.aisle) ?? 0) + 1;
    aisleRows.set(coord.aisle, row);
    const current = counts.get(rack) ?? { online: 0, standby: 0, offline: 0, total: 0 };
    const wave = Math.sin(hash01(`rack:${coord.aisle}:${row}`) * Math.PI * 2) * POWER_WAVE_WATT;
    const powered = isAislePowered(grid, coord.aisle);
    const watt = powered
      ? Math.round(
        RACK_BASE_WATT
        + current.online * FULL_DEVICE_WATT
        + current.standby * Math.round(FULL_DEVICE_WATT * STANDBY_RATIO)
        + current.offline * OFFLINE_DEVICE_WATT
        + wave,
      )
      : 0;
    return {
      rack,
      aisle: coord.aisle,
      row,
      powerOn: powered,
      source: powerSourceForAisle(grid, coord.aisle),
      onlineDevices: current.online,
      standbyDevices: current.standby,
      offlineDevices: current.offline,
      totalDevices: current.total,
      watt,
    };
  });
}
