import { describe, expect, it } from 'vitest';
import { createDevice } from './networkEngine';
import {
  clearRemovedLink,
  maintenanceActionLabel,
  rackKey,
  selectRackAction,
  selectStoragePickup,
  type Carrying,
  type RackActionContext,
} from './maintenance';

function context(overrides: Partial<RackActionContext> = {}): RackActionContext {
  const router = createDevice('router', 1);
  const pc = createDevice('pc', 1);
  const devices = overrides.devices ?? [router, pc];
  const defaultRackKeys = new Map(devices.map((device, index) => [
    device.id,
    rackKey(index === 0 ? -1.55 : 1.55, -7.5),
  ]));
  const defaultStatuses = new Map<string, 'up' | 'idle' | 'error'>(devices.map((device, index) => [device.id, index === 0 ? 'error' : 'up']));
  return {
    rackKey: rackKey(-1.55, -7.5),
    doorOpen: true,
    carrying: null,
    links: [],
    devices,
    removedLinks: new Set(),
    removedDevices: new Set(),
    deviceRackKeys: defaultRackKeys,
    statuses: defaultStatuses,
    ...overrides,
  };
}

describe('maintenance interaction', () => {
  it('does not offer maintenance while the rack door is closed', () => {
    const router = createDevice('router', 1);
    const pc = createDevice('pc', 1);
    const link = { id: 'l1', from: router.id, to: pc.id, fromPort: 'ether1', toPort: 'ether1', faulty: true };
    const result = selectRackAction(context({
      doorOpen: false,
      links: [link],
      devices: [router, pc],
    }));
    expect(result).toBeNull();
  });

  it('removes a faulty cable before an error device in the same rack', () => {
    const router = createDevice('router', 1);
    const pc = createDevice('pc', 1);
    const link = { id: 'l1', from: router.id, to: pc.id, fromPort: 'ether1', toPort: 'ether1', faulty: true };
    const result = selectRackAction(context({
      links: [link],
      devices: [router, pc],
      statuses: new Map([[router.id, 'error'], [pc.id, 'up']]),
    }));
    expect(result).toEqual({ type: 'removeCable', linkId: 'l1' });
  });

  it('installs a removed patch cord at an endpoint rack', () => {
    const router = createDevice('router', 1);
    const pc = createDevice('pc', 1);
    const link = { id: 'l1', from: router.id, to: pc.id, fromPort: 'ether1', toPort: 'ether1', faulty: true };
    const carrying: Carrying = { type: 'patchcord', label: 'Patch Cord' };
    const result = selectRackAction(context({
      carrying,
      links: [link],
      devices: [router, pc],
      removedLinks: new Set(['l1']),
    }));
    expect(result).toEqual({ type: 'installCable', linkId: 'l1' });
  });

  it('installs only the replacement unit carried for that device', () => {
    const router = createDevice('router', 1);
    const pc = createDevice('pc', 1);
    const carrying: Carrying = { type: 'unit', label: 'Unit Pengganti Router', forDeviceId: router.id };
    const result = selectRackAction(context({
      carrying,
      devices: [router, pc],
      removedDevices: new Set([router.id]),
      deviceRackKeys: new Map([
        [router.id, rackKey(-1.55, -7.5)],
        [pc.id, rackKey(-1.55, -7.5)],
      ]),
    }));
    expect(result).toEqual({ type: 'installDevice', id: router.id });
  });

  it('removes an error device when no cable repair is available', () => {
    const router = createDevice('router', 1);
    const result = selectRackAction(context({ devices: [router] }));
    expect(result).toEqual({ type: 'removeDevice', id: router.id });
  });

  it('offers a replacement unit only after a device was removed', () => {
    const router = createDevice('router', 1);
    const withoutRemoval = selectStoragePickup({ carrying: null, devices: [router], removedDevices: new Set() });
    const withRemoval = selectStoragePickup({ carrying: null, devices: [router], removedDevices: new Set([router.id]) });
    expect(withoutRemoval).toEqual({ type: 'patchcord', label: 'Patch Cord' });
    expect(withRemoval).toEqual({ type: 'unit', label: 'Unit Pengganti Router', forDeviceId: router.id });
  });

  it('clears the hidden marker when a removed cable is restored', () => {
    const next = clearRemovedLink(new Set(['l1', 'l2']), 'l1');
    expect([...next]).toEqual(['l2']);
  });

  it('labels cable and device actions with the affected names', () => {
    const router = createDevice('router', 1);
    const pc = createDevice('pc', 1);
    const links = [{ id: 'l1', from: router.id, to: pc.id, fromPort: 'ether1', toPort: 'ether1' }];
    expect(maintenanceActionLabel({ type: 'removeCable', linkId: 'l1' }, [router, pc], links)).toBe(`Lepas Kabel Rusak (${router.name} ↔ ${pc.name})`);
    expect(maintenanceActionLabel({ type: 'installCable', linkId: 'l1' }, [router, pc], links)).toBe(`Pasang Patch Cord (${router.name} ↔ ${pc.name})`);
    expect(maintenanceActionLabel({ type: 'removeDevice', id: router.id }, [router, pc], links)).toBe(`Lepas Perangkat (${router.name})`);
    expect(maintenanceActionLabel({ type: 'installDevice', id: router.id }, [router, pc], links)).toBe(`Pasang Unit Pengganti (${router.name})`);
  });
});
