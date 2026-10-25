export type DeviceKind = 'router' | 'switch' | 'olt' | 'ont' | 'pc' | 'server';
export const FIREWALL_NAT_CHAINS = ['srcnat', 'dstnat'] as const;
export type FirewallNatChain = (typeof FIREWALL_NAT_CHAINS)[number];
export type FirewallNatRule = { id: string; chain: FirewallNatChain; action: 'accept' | 'masquerade'; toAddresses?: string };
export type FirewallFilterRule = { id: string; chain: string; action: 'accept' | 'drop' | 'reject'; comment?: string };
export type DeviceConfig = { hostname: string; addresses: string[]; interfaces: Record<string, { enabled: boolean; address?: string; comment?: string }>; bridgePorts: string[]; dhcp: { enabled: boolean; poolStart: string; poolEnd: string; gateway: string }; dns: string[]; routes: string[]; firewall: { filter: FirewallFilterRule[]; nat: FirewallNatRule[] } };
export type Device = { id: string; kind: DeviceKind; name: string; x: number; y: number; config: DeviceConfig; poweredOff?: boolean; faulty?: boolean };
export type Link = { id: string; from: string; to: string; fromPort: string; toPort: string; faulty?: boolean };
export type LabState = { devices: Device[]; links: Link[] };
export type DeviceStatus = 'up' | 'idle' | 'error';
export const makeConfig = (hostname: string): DeviceConfig => ({ hostname, addresses: [], interfaces: { ether1: { enabled: true }, ether2: { enabled: true }, ether3: { enabled: true } }, bridgePorts: [], dhcp: { enabled: false, poolStart: '192.168.1.100', poolEnd: '192.168.1.200', gateway: '192.168.1.1' }, dns: ['1.1.1.1', '8.8.8.8'], routes: [], firewall: { filter: [], nat: [] } });
export function createDevice(kind: DeviceKind, index: number, x = 120, y = 120): Device {
  const labels: Record<DeviceKind, string> = { router: 'MikroTik', switch: 'Switch', olt: 'OLT', ont: 'ONT', pc: 'PC', server: 'Server' };
  const name = `${labels[kind]}-${index}`;
  return { id: `${kind}-${index}-${Math.random().toString(36).slice(2, 7)}`, kind, name, x, y, config: makeConfig(name) };
}
export function addAddress(device: Device, address: string, iface = 'ether1'): Device {
  if (!/^\d{1,3}(\.\d{1,3}){3}\/\d{1,2}$/.test(address)) throw new Error('Format IP tidak valid. Gunakan alamat/prefix, contoh 192.168.1.1/24.');
  const [ip, prefix] = address.split('/');
  if (ip.split('.').some(n => Number(n) > 255) || Number(prefix) > 32) throw new Error('IP atau prefix berada di luar rentang yang valid.');
  if (!device.config.interfaces[iface]) throw new Error(`Interface ${iface} tidak ditemukan.`);
  return { ...device, config: { ...device.config, addresses: [...device.config.addresses.filter(a => !a.endsWith(`@${iface}`)), `${address}@${iface}`], interfaces: { ...device.config.interfaces, [iface]: { ...device.config.interfaces[iface], address } } } };
}
export function removeAddress(device: Device, index: number): Device {
  const addr = device.config.addresses[index];
  if (!addr) throw new Error('Index alamat tidak ditemukan. Gunakan /ip address print untuk melihat index.');
  const iface = addr.split('@')[1] ?? 'ether1';
  return { ...device, config: { ...device.config, addresses: device.config.addresses.filter((_, i) => i !== index), interfaces: { ...device.config.interfaces, [iface]: { ...device.config.interfaces[iface], address: undefined } } } };
}
const IPV4 = /^\d{1,3}(\.\d{1,3}){3}$/;
const CIDR = /^\d{1,3}(\.\d{1,3}){3}\/\d{1,2}$/;
const validIp = (s: string) => IPV4.test(s) && s.split('.').every(n => Number(n) <= 255);
const validCidr = (s: string) => CIDR.test(s) && validIp(s.split('/')[0]) && Number(s.split('/')[1]) <= 32;
const rid = () => Math.random().toString(36).slice(2, 8);

/** Bridge: satu bridge bernama `bridge1`; `bridgePorts` adalah daftar port anggotanya. */
export function addBridgePort(device: Device, iface: string): Device {
  if (!device.config.interfaces[iface]) throw new Error(`Interface ${iface} tidak ditemukan.`);
  if (device.config.bridgePorts.includes(iface)) throw new Error(`Interface ${iface} sudah menjadi anggota bridge.`);
  return { ...device, config: { ...device.config, bridgePorts: [...device.config.bridgePorts, iface] } };
}
export function removeBridgePort(device: Device, iface: string): Device {
  if (!device.config.bridgePorts.includes(iface)) throw new Error(`Interface ${iface} bukan anggota bridge.`);
  return { ...device, config: { ...device.config, bridgePorts: device.config.bridgePorts.filter(p => p !== iface) } };
}

/** Route statis disimpan sebagai "dst-address@gateway". Ternary/routing dinamis di luar cakupan. */
export function addRoute(device: Device, dst: string, gateway: string): Device {
  if (!validCidr(dst)) throw new Error('dst-address tidak valid. Gunakan alamat/prefix, contoh 0.0.0.0/0.');
  if (!validIp(gateway)) throw new Error('gateway tidak valid.');
  const entry = `${dst}@${gateway}`;
  if (device.config.routes.includes(entry)) throw new Error('Route tersebut sudah ada.');
  return { ...device, config: { ...device.config, routes: [...device.config.routes, entry] } };
}
export function removeRoute(device: Device, index: number): Device {
  if (!device.config.routes[index]) throw new Error('Index route tidak ditemukan. Gunakan /ip route print.');
  return { ...device, config: { ...device.config, routes: device.config.routes.filter((_, i) => i !== index) } };
}

/** Firewall: subset filter + NAT. Tanpa protocol/port/match detail — itu langit-langitnya. */
export function addFirewallFilterRule(device: Device, chain: string, action: string, comment = ''): Device {
  if (!['accept', 'drop', 'reject'].includes(action)) throw new Error('action firewall tidak valid (accept/drop/reject).');
  const rule: FirewallFilterRule = { id: rid(), chain, action: action as FirewallFilterRule['action'], ...(comment ? { comment } : {}) };
  return { ...device, config: { ...device.config, firewall: { ...device.config.firewall, filter: [...device.config.firewall.filter, rule] } } };
}
export function removeFirewallFilterRule(device: Device, index: number): Device {
  if (!device.config.firewall.filter[index]) throw new Error('Index aturan filter tidak ditemukan.');
  return { ...device, config: { ...device.config, firewall: { ...device.config.firewall, filter: device.config.firewall.filter.filter((_, i) => i !== index) } } };
}
export function addFirewallNatRule(device: Device, chain: string, action: string, toAddresses = ''): Device {
  if (!FIREWALL_NAT_CHAINS.includes(chain as FirewallNatChain)) throw new Error('chain NAT tidak valid (srcnat/dstnat).');
  if (!['accept', 'masquerade'].includes(action)) throw new Error('action NAT tidak valid (accept/masquerade).');
  const rule: FirewallNatRule = { id: rid(), chain: chain as FirewallNatChain, action: action as FirewallNatRule['action'], ...(toAddresses ? { toAddresses } : {}) };
  return { ...device, config: { ...device.config, firewall: { ...device.config.firewall, nat: [...device.config.firewall.nat, rule] } } };
}
export function removeFirewallNatRule(device: Device, index: number): Device {
  if (!device.config.firewall.nat[index]) throw new Error('Index aturan NAT tidak ditemukan.');
  return { ...device, config: { ...device.config, firewall: { ...device.config.firewall, nat: device.config.firewall.nat.filter((_, i) => i !== index) } } };
}
export function deviceStatus(device: Device, state: LabState): DeviceStatus {
  if (device.poweredOff || device.faulty) return 'error';
  const own = device.config.addresses.map(a => a.split('@')[0]);
  const duplicate = own.some(a => state.devices.some(o => o.id !== device.id && o.config.addresses.some(oa => oa.split('@')[0] === a)));
  if (duplicate) return 'error';
  const links = state.links.filter(l => l.from === device.id || l.to === device.id);
  for (const l of links) {
    const port = l.from === device.id ? l.fromPort : l.toPort;
    if (!device.config.interfaces[port]?.enabled) return 'error';
  }
  return links.length ? 'up' : 'idle';
}
export function runCommand(device: Device, command: string): { device: Device; output: string } {
  const cmd = command.trim();
  if (!cmd) return { device, output: '' };
  if (/^\/system identity set name=\S+$/i.test(cmd)) {
    const name = cmd.match(/name=(\S+)/i)![1];
    return { device: { ...device, name, config: { ...device.config, hostname: name } }, output: `identity updated: ${name}` };
  }
  if (/^\/system identity print$/i.test(cmd)) return { device, output: `name: ${device.config.hostname}` };
  if (/^\/interface print$/i.test(cmd)) return { device, output: Object.entries(device.config.interfaces).map(([name, v], i) => `${i}  ${name.padEnd(8)} ${v.enabled ? 'R' : 'X'} ${v.address ?? ''}`).join('\n') || 'no interfaces' };
  if (/^\/ip address print$/i.test(cmd)) return { device, output: device.config.addresses.length ? device.config.addresses.map((a, i) => `${i}  ${a.replace('@', ' on ')}`).join('\n') : 'no ip addresses' };
  const add = cmd.match(/^\/ip address add address=([^\s]+)(?: interface=(\S+))?$/i);
  if (add) return { device: addAddress(device, add[1], add[2] ?? 'ether1'), output: `address ${add[1]} added` };
  const rm = cmd.match(/^\/ip address remove numbers=(\d+)$/i);
  if (rm) {
    const idx = Number(rm[1]);
    const removed = device.config.addresses[idx];
    return { device: removeAddress(device, idx), output: `address ${removed.split('@')[0]} removed` };
  }
  const disable = cmd.match(/^\/interface disable (\S+)$/i);
  if (disable) {
    if (!device.config.interfaces[disable[1]]) throw new Error(`Interface ${disable[1]} tidak ditemukan.`);
    return { device: { ...device, config: { ...device.config, interfaces: { ...device.config.interfaces, [disable[1]]: { ...device.config.interfaces[disable[1]], enabled: false } } } }, output: `${disable[1]} disabled` };
  }
  const enable = cmd.match(/^\/interface enable (\S+)$/i);
  if (enable) {
    if (!device.config.interfaces[enable[1]]) throw new Error(`Interface ${enable[1]} tidak ditemukan.`);
    return { device: { ...device, config: { ...device.config, interfaces: { ...device.config.interfaces, [enable[1]]: { ...device.config.interfaces[enable[1]], enabled: true } } } }, output: `${enable[1]} enabled` };
  }
  // --- bridge ---
  if (/^\/interface bridge print$/i.test(cmd)) return { device, output: device.config.bridgePorts.length ? `bridge1\n  ports: ${device.config.bridgePorts.join(', ')}` : 'bridge1 (no ports)' };
  const bpAdd = cmd.match(/^\/interface bridge port add interface=(\S+)$/i);
  if (bpAdd) return { device: addBridgePort(device, bpAdd[1]), output: `${bpAdd[1]} added to bridge1` };
  const bpRm = cmd.match(/^\/interface bridge port remove interface=(\S+)$/i);
  if (bpRm) return { device: removeBridgePort(device, bpRm[1]), output: `${bpRm[1]} removed from bridge1` };
  // --- routing ---
  if (/^\/ip route print$/i.test(cmd)) return { device, output: device.config.routes.length ? device.config.routes.map((r, i) => `${i}  ${r.split('@')[0]} via ${r.split('@')[1] ?? '?'}`).join('\n') : 'no routes' };
  const rtAdd = cmd.match(/^\/ip route add dst-address=(\S+) gateway=(\S+)$/i);
  if (rtAdd) return { device: addRoute(device, rtAdd[1], rtAdd[2]), output: `route to ${rtAdd[1]} added` };
  const rtRm = cmd.match(/^\/ip route remove numbers=(\d+)$/i);
  if (rtRm) { const removed = device.config.routes[Number(rtRm[1])]; return { device: removeRoute(device, Number(rtRm[1])), output: `route ${removed.split('@')[0]} removed` }; }
  // --- firewall filter ---
  if (/^\/ip firewall filter print$/i.test(cmd)) return { device, output: device.config.firewall.filter.length ? device.config.firewall.filter.map((r, i) => `${i}  chain=${r.chain} action=${r.action}${r.comment ? ` comment=${r.comment}` : ''}`).join('\n') : 'no filter rules' };
  const fwAdd = cmd.match(/^\/ip firewall filter add chain=(\S+) action=(\S+)(?: comment=(.+))?$/i);
  if (fwAdd) return { device: addFirewallFilterRule(device, fwAdd[1], fwAdd[2], fwAdd[3] ?? ''), output: `filter rule added: chain=${fwAdd[1]} action=${fwAdd[2]}` };
  const fwRm = cmd.match(/^\/ip firewall filter remove numbers=(\d+)$/i);
  if (fwRm) { const r = device.config.firewall.filter[Number(fwRm[1])]; return { device: removeFirewallFilterRule(device, Number(fwRm[1])), output: `filter rule removed (chain=${r.chain} action=${r.action})` }; }
  // --- firewall nat ---
  if (/^\/ip firewall nat print$/i.test(cmd)) return { device, output: device.config.firewall.nat.length ? device.config.firewall.nat.map((r, i) => `${i}  chain=${r.chain} action=${r.action}${r.toAddresses ? ` to-addresses=${r.toAddresses}` : ''}`).join('\n') : 'no nat rules' };
  const natAdd = cmd.match(/^\/ip firewall nat add chain=(\S+) action=(\S+)(?: to-addresses=(\S+))?$/i);
  if (natAdd) return { device: addFirewallNatRule(device, natAdd[1], natAdd[2], natAdd[3] ?? ''), output: `nat rule added: chain=${natAdd[1]} action=${natAdd[2]}` };
  const natRm = cmd.match(/^\/ip firewall nat remove numbers=(\d+)$/i);
  if (natRm) { const r = device.config.firewall.nat[Number(natRm[1])]; return { device: removeFirewallNatRule(device, Number(natRm[1])), output: `nat rule removed (chain=${r.chain} action=${r.action})` }; }
  if (/^\/help$/i.test(cmd) || /^\?$/i.test(cmd)) return { device, output: '/system identity print\n/system identity set name=ROUTER\n/interface print\n/interface disable ether1\n/interface enable ether1\n/ip address print\n/ip address add address=192.168.1.1/24 interface=ether1\n/ip address remove numbers=0\n/interface bridge print\n/interface bridge port add interface=ether2\n/interface bridge port remove interface=ether2\n/ip route print\n/ip route add dst-address=0.0.0.0/0 gateway=192.168.1.1\n/ip route remove numbers=0\n/ip firewall filter print\n/ip firewall filter add chain=input action=accept comment=LAN\n/ip firewall filter remove numbers=0\n/ip firewall nat print\n/ip firewall nat add chain=srcnat action=masquerade\n/ip firewall nat remove numbers=0\n\nNetVerse implements a small RouterOS-style command subset; it is not RouterOS.' };
  throw new Error('Perintah belum didukung oleh simulator. Ketik /help untuk melihat perintah yang tersedia.');
}
export function firstFreeInterface(device: Device, state: LabState): string | null {
  const used = new Set<string>();
  for (const l of state.links) {
    if (l.from === device.id) used.add(l.fromPort);
    if (l.to === device.id) used.add(l.toPort);
  }
  return Object.keys(device.config.interfaces).find(n => !used.has(n)) ?? null;
}
export function canConnect(state: LabState, from: string, to: string): boolean {
  if (from === to) return false;
  const a = state.devices.find(d => d.id === from);
  const b = state.devices.find(d => d.id === to);
  if (!a || !b) return false;
  if (state.links.some(l => (l.from === from && l.to === to) || (l.from === to && l.to === from))) return false;
  return firstFreeInterface(a, state) !== null && firstFreeInterface(b, state) !== null;
}
export function setLinkDevicePort(state: LabState, linkId: string, deviceId: string, port: string): LabState {
  const link = state.links.find(l => l.id === linkId);
  if (!link) throw new Error('Kabel tidak ditemukan.');
  const isFrom = link.from === deviceId;
  if (!isFrom && link.to !== deviceId) throw new Error('Perangkat bukan bagian dari kabel ini.');
  const device = state.devices.find(d => d.id === deviceId);
  if (!device) throw new Error('Perangkat tidak ditemukan.');
  if (!device.config.interfaces[port]) throw new Error(`Interface ${port} tidak ditemukan pada ${device.name}.`);
  const conflict = state.links.some(l => l.id !== linkId && ((l.from === deviceId && l.fromPort === port) || (l.to === deviceId && l.toPort === port)));
  if (conflict) throw new Error(`Port ${port} sudah dipakai kabel lain di ${device.name}.`);
  return { ...state, links: state.links.map(l => l.id !== linkId ? l : isFrom ? { ...l, fromPort: port } : { ...l, toPort: port }) };
}
export function removeLink(state: LabState, linkId: string): LabState {
  if (!state.links.some(l => l.id === linkId)) throw new Error('Kabel tidak ditemukan.');
  return { ...state, links: state.links.filter(l => l.id !== linkId) };
}

/**
 * Menentukan apakah sebuah kabel aktif di kedua ujungnya.
 * Fungsi ini memeriksa koneksi fisik/logis sederhana,
 * bukan routing IP sungguhan.
 */
export function isLinkOperational(link: Link, state: LabState): boolean {
  const from = state.devices.find(d => d.id === link.from);
  const to = state.devices.find(d => d.id === link.to);

  if (!from || !to || from.poweredOff || to.poweredOff || link.faulty) return false;

  const fromInterface = from.config.interfaces[link.fromPort];
  const toInterface = to.config.interfaces[link.toPort];

  return Boolean(fromInterface?.enabled && toInterface?.enabled);
}

/**
 * Mengembalikan ID semua perangkat yang bisa dijangkau
 * dari perangkat awal melalui kabel yang aktif.
 */
export function getReachableDevices(
  state: LabState,
  startId: string
): string[] {
  if (!state.devices.some(d => d.id === startId)) return [];

  const visited = new Set<string>([startId]);
  const queue = [startId];

  while (queue.length > 0) {
    const current = queue.shift()!;

    for (const link of state.links) {
      if (!isLinkOperational(link, state)) continue;

      let neighbor: string | null = null;

      if (link.from === current) neighbor = link.to;
      else if (link.to === current) neighbor = link.from;

      if (
        neighbor &&
        !visited.has(neighbor) &&
        state.devices.some(d => d.id === neighbor)
      ) {
        visited.add(neighbor);
        queue.push(neighbor);
      }
    }
  }

  return [...visited];
}

export type NetworkAnalysis = {
  components: string[][];
  isolatedDeviceIds: string[];
  inactiveLinkIds: string[];
};

/**
 * Menganalisis kelompok koneksi yang masih aktif,
 * perangkat tanpa koneksi aktif, dan kabel yang tidak aktif.
 */
export function analyzeNetwork(state: LabState): NetworkAnalysis {
  const visited = new Set<string>();
  const components: string[][] = [];

  for (const device of state.devices) {
    if (visited.has(device.id)) continue;

    const component = getReachableDevices(state, device.id);
    component.forEach(id => visited.add(id));
    components.push(component);
  }

  const isolatedDeviceIds = state.devices
    .filter(device =>
      !state.links.some(
        link =>
          (link.from === device.id || link.to === device.id) &&
          isLinkOperational(link, state)
      )
    )
    .map(device => device.id);

  const inactiveLinkIds = state.links
    .filter(link => !isLinkOperational(link, state))
    .map(link => link.id);

  return { components, isolatedDeviceIds, inactiveLinkIds };
}
