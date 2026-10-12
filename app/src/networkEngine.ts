export type DeviceKind = 'router' | 'switch' | 'olt' | 'ont' | 'pc' | 'server';
export type DeviceConfig = { hostname: string; addresses: string[]; interfaces: Record<string, { enabled: boolean; address?: string; comment?: string }>; bridgePorts: string[]; dhcp: { enabled: boolean; poolStart: string; poolEnd: string; gateway: string }; dns: string[]; routes: string[] };
export type Device = { id: string; kind: DeviceKind; name: string; x: number; y: number; config: DeviceConfig };
export type Link = { id: string; from: string; to: string; fromPort: string; toPort: string };
export type LabState = { devices: Device[]; links: Link[] };
export const makeConfig = (hostname: string): DeviceConfig => ({ hostname, addresses: [], interfaces: { ether1: { enabled: true }, ether2: { enabled: true }, ether3: { enabled: true } }, bridgePorts: [], dhcp: { enabled: false, poolStart: '192.168.1.100', poolEnd: '192.168.1.200', gateway: '192.168.1.1' }, dns: ['1.1.1.1', '8.8.8.8'], routes: [] });
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
  if (/^\/help$/i.test(cmd) || /^\?$/i.test(cmd)) return { device, output: '/system identity print\n/system identity set name=ROUTER\n/interface print\n/interface disable ether1\n/interface enable ether1\n/ip address print\n/ip address add address=192.168.1.1/24 interface=ether1\n\nNetVerse implements a small RouterOS-style command subset; it is not RouterOS.' };
  throw new Error('Perintah belum didukung oleh simulator. Ketik /help untuk melihat perintah yang tersedia.');
}
export function canConnect(state: LabState, from: string, to: string): boolean { return from !== to && state.devices.some(d => d.id === from) && state.devices.some(d => d.id === to) && !state.links.some(l => (l.from === from && l.to === to) || (l.from === to && l.to === from)); }