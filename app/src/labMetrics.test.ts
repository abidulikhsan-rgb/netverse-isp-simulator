import { describe, expect, it } from 'vitest';
import { createDevice, type LabState } from './networkEngine';
import { planLabLayout } from './labLayout';
import { DEFAULT_POWER_GRID, powerModel, type PowerGrid } from './labMetrics';

type GridPatch = Omit<Partial<PowerGrid>, 'breakers'> & { breakers?: Partial<PowerGrid['breakers']> };

const grid = (patch: GridPatch = {}): PowerGrid => ({
  ...DEFAULT_POWER_GRID,
  ...patch,
  breakers: { ...DEFAULT_POWER_GRID.breakers, ...(patch.breakers ?? {}) },
});

function fixture(): LabState {
  const online = createDevice('router', 11);
  const peer = createDevice('switch', 12);
  const standby = createDevice('olt', 13);
  const offline = { ...createDevice('ont', 14), poweredOff: true };
  return {
    devices: [online, peer, standby, offline],
    links: [{ id: 'link-online', from: online.id, to: peer.id, fromPort: 'ether1', toPort: 'ether1' }],
  };
}

describe('rack power model', () => {
  it('starts with all breakers and PLN enabled and the genset stopped', () => {
    expect(DEFAULT_POWER_GRID).toEqual({
      breakers: { A: true, B: true, C: true },
      plnOn: true,
      gensetOn: false,
    });
  });

  it('returns all 24 aisle-ordered racks with grid power enabled', () => {
    const lab = fixture();
    const { places } = planLabLayout(lab.devices);
    const racks = powerModel(lab, places, DEFAULT_POWER_GRID);

    expect(racks).toHaveLength(24);
    expect(racks.every(rack => rack.powerOn)).toBe(true);
    expect(racks.every(rack => rack.source === 'PLN')).toBe(true);
    expect(racks.filter(rack => rack.aisle === 'A')).toHaveLength(8);
    expect(racks.filter(rack => rack.aisle === 'B')).toHaveLength(8);
    expect(racks.filter(rack => rack.aisle === 'C')).toHaveLength(8);
    expect(racks.filter(rack => rack.aisle === 'A').map(rack => rack.row)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });

  it('turns every rack in a tripped aisle off', () => {
    const lab = fixture();
    const { places } = planLabLayout(lab.devices);
    const racks = powerModel(lab, places, grid({ breakers: { A: false } }));
    const aisleA = racks.filter(rack => rack.aisle === 'A');

    expect(aisleA).toHaveLength(8);
    expect(aisleA.every(rack => !rack.powerOn)).toBe(true);
    expect(aisleA.every(rack => rack.source === 'OFF')).toBe(true);
    expect(aisleA.every(rack => rack.watt === 0)).toBe(true);
    expect(racks.filter(rack => rack.aisle !== 'A').every(rack => rack.powerOn)).toBe(true);
  });

  it('uses the genset when PLN is unavailable', () => {
    const lab = fixture();
    const { places } = planLabLayout(lab.devices);
    const racks = powerModel(lab, places, grid({ plnOn: false, gensetOn: true }));

    expect(racks.every(rack => rack.powerOn)).toBe(true);
    expect(racks.every(rack => rack.source === 'GENSET')).toBe(true);
  });

  it('turns all racks off when neither source is available', () => {
    const lab = fixture();
    const { places } = planLabLayout(lab.devices);
    const racks = powerModel(lab, places, grid({ plnOn: false, gensetOn: false }));

    expect(racks.every(rack => !rack.powerOn)).toBe(true);
    expect(racks.every(rack => rack.source === 'OFF')).toBe(true);
    expect(racks.every(rack => rack.watt === 0)).toBe(true);
  });

  it('classifies online, standby, and offline devices from engine status', () => {
    const lab = fixture();
    const { places } = planLabLayout(lab.devices);
    const rack = powerModel(lab, places, DEFAULT_POWER_GRID)[0];

    expect(rack.onlineDevices).toBe(2);
    expect(rack.standbyDevices).toBe(1);
    expect(rack.offlineDevices).toBe(1);
    expect(rack.totalDevices).toBe(4);
    expect([...places.values()].every(place => place.aisle === 'A')).toBe(true);
  });

  it('classifies a faulty device as offline', () => {
    const faulty = { ...createDevice('pc', 15), faulty: true };
    const lab: LabState = { devices: [faulty], links: [] };
    const { places } = planLabLayout(lab.devices);
    const rack = powerModel(lab, places, DEFAULT_POWER_GRID)[0];

    expect(rack.onlineDevices).toBe(0);
    expect(rack.standbyDevices).toBe(0);
    expect(rack.offlineDevices).toBe(1);
  });

  it('uses full online draw, 60 percent standby draw, and 2 W offline draw', () => {
    const lab = fixture();
    const { places } = planLabLayout(lab.devices);
    const emptyLab: LabState = { devices: [], links: [] };
    const emptyRack = powerModel(emptyLab, planLabLayout([]).places, DEFAULT_POWER_GRID)[0];
    const loadedRack = powerModel(lab, places, DEFAULT_POWER_GRID)[0];

    expect(loadedRack.watt - emptyRack.watt).toBe(2 * 55 + Math.round(55 * 0.6) + 2);
    expect(powerModel(lab, places, DEFAULT_POWER_GRID)[0].watt).toBe(loadedRack.watt);
  });
});
