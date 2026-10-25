import type { Device, DeviceStatus, Link } from './networkEngine';

export type Carrying = {
  type: 'patchcord' | 'unit';
  label: string;
  forDeviceId?: string;
};

export type MaintenanceAction =
  | { type: 'removeCable'; linkId: string }
  | { type: 'installCable'; linkId: string }
  | { type: 'removeDevice'; id: string }
  | { type: 'installDevice'; id: string };

export type RackActionContext = {
  rackKey: string;
  doorOpen: boolean;
  carrying: Carrying | null;
  links: Link[];
  devices: Device[];
  removedLinks: ReadonlySet<string>;
  removedDevices: ReadonlySet<string>;
  deviceRackKeys: ReadonlyMap<string, string>;
  statuses: ReadonlyMap<string, DeviceStatus>;
};

const KIND_LABELS: Record<Device['kind'], string> = {
  router: 'Router',
  switch: 'Switch',
  olt: 'OLT',
  ont: 'ONT',
  pc: 'PC',
  server: 'Server',
};

export function rackKey(rx: number, rz: number): string {
  return `${rx},${rz}`;
}

export function clearRemovedLink(removedLinks: ReadonlySet<string>, linkId: string): Set<string> {
  const next = new Set(removedLinks);
  next.delete(linkId);
  return next;
}

export function selectRackAction(context: RackActionContext): MaintenanceAction | null {
  if (!context.doorOpen) return null;
  const touchesRack = (link: Link) => context.deviceRackKeys.get(link.from) === context.rackKey || context.deviceRackKeys.get(link.to) === context.rackKey;

  if (context.carrying?.type === 'unit') {
    const id = context.carrying.forDeviceId;
    if (!id || !context.removedDevices.has(id) || context.deviceRackKeys.get(id) !== context.rackKey) return null;
    return { type: 'installDevice', id };
  }

  if (context.carrying?.type === 'patchcord') {
    const link = context.links.find(item => context.removedLinks.has(item.id) && touchesRack(item));
    return link ? { type: 'installCable', linkId: link.id } : null;
  }

  const faultyLink = context.links.find(item => item.faulty && !context.removedLinks.has(item.id) && touchesRack(item));
  if (faultyLink) return { type: 'removeCable', linkId: faultyLink.id };

  const failedDevice = context.devices.find(device => (
    !context.removedDevices.has(device.id)
    && context.statuses.get(device.id) === 'error'
    && context.deviceRackKeys.get(device.id) === context.rackKey
  ));
  return failedDevice ? { type: 'removeDevice', id: failedDevice.id } : null;
}

export function selectStoragePickup(context: {
  carrying: Carrying | null;
  devices: Device[];
  removedDevices: ReadonlySet<string>;
}): Carrying | null {
  if (context.carrying) return null;
  const removedDevice = context.devices.find(device => context.removedDevices.has(device.id));
  if (removedDevice) {
    return {
      type: 'unit',
      label: `Unit Pengganti ${KIND_LABELS[removedDevice.kind]}`,
      forDeviceId: removedDevice.id,
    };
  }
  return { type: 'patchcord', label: 'Patch Cord' };
}

export function maintenanceActionLabel(action: MaintenanceAction, devices: Device[], links: Link[]): string {
  const nameOf = (id: string) => devices.find(device => device.id === id)?.name ?? '?';
  if (action.type === 'removeCable' || action.type === 'installCable') {
    const link = links.find(item => item.id === action.linkId);
    const names = link ? `${nameOf(link.from)} ↔ ${nameOf(link.to)}` : '? ↔ ?';
    return action.type === 'removeCable' ? `Lepas Kabel Rusak (${names})` : `Pasang Patch Cord (${names})`;
  }
  const name = nameOf(action.id);
  return action.type === 'removeDevice' ? `Lepas Perangkat (${name})` : `Pasang Unit Pengganti (${name})`;
}
