import type { Device } from './networkEngine';

// Shared world layout — single source of truth for Room3D placement AND NOC topology map.
// 24 racks: 3 cold aisles (A/B/C) × 2 facing rows × 4 racks per row.
// Rows run along Z; each cabinet front faces ±X so the aisle is seen from spawn.
export const RACK_H = 5.6;
export const RACK_W = 1.86;
export const RACK_D = 0.9;
export const RACKS_PER_ROW = 4;
export const RACK_Z = [-7.5, -10.5, -13.5, -16.5] as const;
export const AISLE_NAMES = ['A', 'B', 'C'] as const;
export const AISLE_SIGN_X = [0, 4.05, -4.05] as const;
export const AISLE_SIGN_Z = -12;
export const NOC_RACK = 0; // first rack of Lorong A left row (x=-1.55, z=-7.5)
export const NOC_HERO_Y = RACK_H - 0.92;

export type Aisle = (typeof AISLE_NAMES)[number];
export type RackCoord = { rx: number; rz: number; yaw: number; aisle: Aisle; row: 0 | 1 };

const HALF_PI = Math.PI / 2;
// Stable order: A left, A right, B inner, B outer, C inner, C outer; racks near→far.
// front +x → yaw = +PI/2, front -x → yaw = -PI/2.
const ROW_DEFS: { rx: number; yaw: number; aisle: Aisle; row: 0 | 1 }[] = [
  { rx: -1.55, yaw: HALF_PI, aisle: 'A', row: 0 }, // A left,  front +x
  { rx: 1.55, yaw: -HALF_PI, aisle: 'A', row: 1 }, // A right, front -x
  { rx: 2.5, yaw: HALF_PI, aisle: 'B', row: 0 }, // B inner,  front +x
  { rx: 5.6, yaw: -HALF_PI, aisle: 'B', row: 1 }, // B outer,  front -x
  { rx: -2.5, yaw: -HALF_PI, aisle: 'C', row: 0 }, // C inner,  front -x
  { rx: -5.6, yaw: HALF_PI, aisle: 'C', row: 1 }, // C outer,  front +x
];

export const rackCoords: RackCoord[] = ROW_DEFS.flatMap(def =>
  RACK_Z.map(rz => ({ rx: def.rx, rz, yaw: def.yaw, aisle: def.aisle, row: def.row })),
);

export function allRacks(): RackCoord[] {
  return rackCoords;
}

export const KIND_HEIGHT: Record<string, number> = { router: 0.6, switch: 0.6, olt: 0.6, ont: 0.42, pc: 0.42, server: 1.2 };

export type DevicePlace = { rx: number; rz: number; yBottom: number; yCenter: number; rack: number; aisle: Aisle; yaw: number };

export function planLabLayout(devices: Device[]): { racks: RackCoord[]; usedY: number[]; places: Map<string, DevicePlace> } {
  const racks = rackCoords;
  const usedY = racks.map(() => 0.06);
  const places = new Map<string, DevicePlace>();
  const put = (d: Device, start: number) => {
    const h = KIND_HEIGHT[d.kind] ?? 0.6;
    for (let r = start; r < racks.length; r++) {
      const cap = r === NOC_RACK ? NOC_HERO_Y - 0.01 : RACK_H - 1.05;
      if (usedY[r] + h <= cap) {
        const yBottom = usedY[r];
        usedY[r] += h + 0.01;
        places.set(d.id, { rx: racks[r].rx, rz: racks[r].rz, yBottom, yCenter: yBottom + h / 2, rack: r, aisle: racks[r].aisle, yaw: racks[r].yaw });
        return;
      }
    }
  };
  devices.filter(d => d.kind !== 'server').forEach(d => put(d, NOC_RACK));
  devices.filter(d => d.kind === 'server').forEach(d => put(d, NOC_RACK + 1));
  return { racks, usedY, places };
}
