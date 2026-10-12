import { describe, expect, it } from 'vitest';
import { addAddress, canConnect, createDevice, runCommand } from './networkEngine';
describe('network engine', () => {
  it('creates device with shared config', () => { const d = createDevice('router', 1); expect(d.config.interfaces.ether1.enabled).toBe(true); expect(d.config.hostname).toBe(d.name); });
  it('adds address to the selected interface', () => { const d = createDevice('router', 1); const n = addAddress(d, '192.168.1.1/24', 'ether2'); expect(n.config.interfaces.ether2.address).toBe('192.168.1.1/24'); expect(n.config.addresses[0]).toContain('ether2'); });
  it('rejects invalid addresses', () => { expect(() => addAddress(createDevice('router', 1), '999.1.1.1/24')).toThrow(); });
  it('CLI changes the same config used by GUI', () => { const d = createDevice('router', 1); const n = runCommand(d, '/ip address add address=10.0.0.1/24 interface=ether1').device; expect(n.config.interfaces.ether1.address).toBe('10.0.0.1/24'); expect(runCommand(n, '/ip address print').output).toContain('10.0.0.1/24'); });
  it('supports identity changes', () => { expect(runCommand(createDevice('router', 1), '/system identity set name=EDGE').device.config.hostname).toBe('EDGE'); });
  it('supports interface disable and enable', () => { const d = createDevice('router', 1); const off = runCommand(d, '/interface disable ether1').device; expect(off.config.interfaces.ether1.enabled).toBe(false); expect(runCommand(off, '/interface enable ether1').device.config.interfaces.ether1.enabled).toBe(true); });
  it('rejects unknown commands', () => { expect(() => runCommand(createDevice('router', 1), '/ip firewall nat print')).toThrow(); });
  it('prevents duplicate and self links', () => { const a = createDevice('router', 1), b = createDevice('pc', 1); const state = { devices: [a, b], links: [{ id: 'l1', from: a.id, to: b.id, fromPort: 'ether1', toPort: 'ether1' }] }; expect(canConnect(state, a.id, a.id)).toBe(false); expect(canConnect(state, a.id, b.id)).toBe(false); expect(canConnect({ ...state, links: [] }, a.id, b.id)).toBe(true); });
});