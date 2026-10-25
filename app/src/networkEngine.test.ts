import { describe, expect, it } from 'vitest';
import { addAddress, addBridgePort, addFirewallFilterRule, addRoute, canConnect, createDevice, deviceStatus, firstFreeInterface, removeAddress, removeBridgePort, removeFirewallFilterRule, removeLink, removeRoute, runCommand, setLinkDevicePort } from './networkEngine';
describe('network engine', () => {
  it('creates device with shared config', () => { const d = createDevice('router', 1); expect(d.config.interfaces.ether1.enabled).toBe(true); expect(d.config.hostname).toBe(d.name); });
  it('adds address to the selected interface', () => { const d = createDevice('router', 1); const n = addAddress(d, '192.168.1.1/24', 'ether2'); expect(n.config.interfaces.ether2.address).toBe('192.168.1.1/24'); expect(n.config.addresses[0]).toContain('ether2'); });
  it('rejects invalid addresses', () => { expect(() => addAddress(createDevice('router', 1), '999.1.1.1/24')).toThrow(); });
  it('CLI changes the same config used by GUI', () => { const d = createDevice('router', 1); const n = runCommand(d, '/ip address add address=10.0.0.1/24 interface=ether1').device; expect(n.config.interfaces.ether1.address).toBe('10.0.0.1/24'); expect(runCommand(n, '/ip address print').output).toContain('10.0.0.1/24'); });
  it('supports identity changes', () => { expect(runCommand(createDevice('router', 1), '/system identity set name=EDGE').device.config.hostname).toBe('EDGE'); });
  it('supports interface disable and enable', () => { const d = createDevice('router', 1); const off = runCommand(d, '/interface disable ether1').device; expect(off.config.interfaces.ether1.enabled).toBe(false); expect(runCommand(off, '/interface enable ether1').device.config.interfaces.ether1.enabled).toBe(true); });
  it('rejects unknown commands', () => { expect(() => runCommand(createDevice('router', 1), '/ip firewall mangle print')).toThrow(); });
  it('prevents duplicate and self links', () => { const a = createDevice('router', 1), b = createDevice('pc', 1); const state = { devices: [a, b], links: [{ id: 'l1', from: a.id, to: b.id, fromPort: 'ether1', toPort: 'ether1' }] }; expect(canConnect(state, a.id, a.id)).toBe(false); expect(canConnect(state, a.id, b.id)).toBe(false); expect(canConnect({ ...state, links: [] }, a.id, b.id)).toBe(true); });
  it('removes an address and clears the interface', () => { const d = addAddress(createDevice('router', 1), '192.168.1.1/24', 'ether1'); const n = removeAddress(d, 0); expect(n.config.addresses).toHaveLength(0); expect(n.config.interfaces.ether1.address).toBeUndefined(); });
  it('rejects removing an out-of-range address', () => { expect(() => removeAddress(createDevice('router', 1), 0)).toThrow(); expect(() => runCommand(createDevice('router', 1), '/ip address remove numbers=3')).toThrow(); });
  it('CLI removes an address by index', () => { const d = addAddress(createDevice('router', 1), '10.0.0.1/24', 'ether1'); const n = runCommand(d, '/ip address remove numbers=0').device; expect(n.config.addresses).toHaveLength(0); });
  it('reports idle status with no links', () => { const d = createDevice('router', 1); expect(deviceStatus(d, { devices: [d], links: [] })).toBe('idle'); });
  it('reports up status when linked', () => { const a = createDevice('router', 1), b = createDevice('pc', 1); const state = { devices: [a, b], links: [{ id: 'l1', from: a.id, to: b.id, fromPort: 'ether1', toPort: 'ether1' }] }; expect(deviceStatus(a, state)).toBe('up'); });
  it('reports error when a link uses a disabled interface', () => { const a = createDevice('router', 1), b = createDevice('pc', 1); const aOff = { ...a, config: { ...a.config, interfaces: { ...a.config.interfaces, ether1: { ...a.config.interfaces.ether1, enabled: false } } } }; const state = { devices: [aOff, b], links: [{ id: 'l1', from: aOff.id, to: b.id, fromPort: 'ether1', toPort: 'ether1' }] }; expect(deviceStatus(aOff, state)).toBe('error'); });
  it('reports error on duplicate IP across devices', () => { const a = addAddress(createDevice('router', 1), '192.168.1.1/24', 'ether1'); const b = addAddress(createDevice('router', 2), '192.168.1.1/24', 'ether1'); const state = { devices: [a, b], links: [] }; expect(deviceStatus(a, state)).toBe('error'); });
});

describe('bridge, routing, firewall', () => {
  it('adds and removes bridge ports', () => {
    const d = createDevice('router', 1);
    const n = addBridgePort(d, 'ether2');
    expect(n.config.bridgePorts).toContain('ether2');
    expect(removeBridgePort(n, 'ether2').config.bridgePorts).not.toContain('ether2');
    expect(() => addBridgePort(n, 'ether2')).toThrow();
    expect(() => addBridgePort(d, 'ether9')).toThrow();
  });
  it('CLI adds a bridge port and prints it', () => {
    const d = createDevice('router', 1);
    const n = runCommand(d, '/interface bridge port add interface=ether3').device;
    expect(n.config.bridgePorts).toContain('ether3');
    expect(runCommand(n, '/interface bridge print').output).toContain('ether3');
  });
  it('adds a static route and validates inputs', () => {
    const d = createDevice('router', 1);
    const n = addRoute(d, '0.0.0.0/0', '192.168.1.1');
    expect(n.config.routes).toContain('0.0.0.0/0@192.168.1.1');
    expect(runCommand(n, '/ip route print').output).toContain('via 192.168.1.1');
    expect(() => addRoute(d, '999.0.0.0/8', '192.168.1.1')).toThrow();
    expect(() => addRoute(d, '0.0.0.0/0', '999.1.1.1')).toThrow();
  });
  it('removes routes by index', () => {
    const d = addRoute(createDevice('router', 1), '0.0.0.0/0', '192.168.1.1');
    const n = removeRoute(d, 0);
    expect(n.config.routes).toHaveLength(0);
    expect(() => removeRoute(d, 3)).toThrow();
  });
  it('adds and removes firewall filter rules', () => {
    const d = createDevice('router', 1);
    const n = addFirewallFilterRule(d, 'input', 'drop', 'block all');
    expect(n.config.firewall.filter).toHaveLength(1);
    expect(n.config.firewall.filter[0].comment).toBe('block all');
    expect(removeFirewallFilterRule(n, 0).config.firewall.filter).toHaveLength(0);
    expect(() => addFirewallFilterRule(d, 'input', 'nope')).toThrow();
  });
  it('adds a srcnat masquerade rule via CLI and prints it', () => {
    const d = createDevice('router', 1);
    const n = runCommand(d, '/ip firewall nat add chain=srcnat action=masquerade').device;
    expect(n.config.firewall.nat[0].action).toBe('masquerade');
    expect(runCommand(n, '/ip firewall nat print').output).toContain('masquerade');
    expect(() => runCommand(d, '/ip firewall nat add chain=bad action=masquerade')).toThrow();
  });
  it('picks the first free interface for a new cable', () => {
    const a = createDevice('router', 1), b = createDevice('pc', 1), c = createDevice('pc', 2);
    const state = { devices: [a, b, c], links: [{ id: 'l1', from: a.id, to: b.id, fromPort: 'ether1', toPort: 'ether1' }] };
    expect(firstFreeInterface(a, state)).toBe('ether2');
    expect(firstFreeInterface(c, state)).toBe('ether1');
  });
  it('moves a cable to another port and rejects conflicts', () => {
    const a = createDevice('router', 1), b = createDevice('switch', 1), c = createDevice('pc', 1);
    const state = { devices: [a, b, c], links: [
      { id: 'l1', from: a.id, to: b.id, fromPort: 'ether1', toPort: 'ether1' },
      { id: 'l2', from: a.id, to: c.id, fromPort: 'ether2', toPort: 'ether1' },
    ]};
    const next = setLinkDevicePort(state, 'l1', a.id, 'ether3');
    expect(next.links[0].fromPort).toBe('ether3');
    expect(() => setLinkDevicePort(state, 'l1', a.id, 'ether2')).toThrow();
    expect(() => setLinkDevicePort(state, 'l1', a.id, 'ether9')).toThrow();
  });
  it('removes a cable (unplugs)', () => {
    const a = createDevice('router', 1), b = createDevice('pc', 1);
    const state = { devices: [a, b], links: [{ id: 'l1', from: a.id, to: b.id, fromPort: 'ether1', toPort: 'ether1' }] };
    expect(removeLink(state, 'l1').links).toHaveLength(0);
    expect(() => removeLink(state, 'none')).toThrow();
  });
  it('blocks connecting when a device has no free port', () => {
    const a = createDevice('router', 1);
    const o1 = createDevice('switch', 1), o2 = createDevice('pc', 1), o3 = createDevice('olt', 1);
    const state = { devices: [a, o1, o2, o3], links: [
      { id: 'l1', from: a.id, to: o1.id, fromPort: 'ether1', toPort: 'ether1' },
      { id: 'l2', from: a.id, to: o2.id, fromPort: 'ether2', toPort: 'ether1' },
      { id: 'l3', from: a.id, to: o3.id, fromPort: 'ether3', toPort: 'ether1' },
    ]};
    const extra = createDevice('server', 1);
    expect(canConnect({ devices: [...state.devices, extra], links: state.links }, a.id, extra.id)).toBe(false);
  });
});

describe('network impact analysis', () => {
  it('finds devices reachable through multiple active links', async () => {
    const { getReachableDevices } = await import('./networkEngine');
    const a = createDevice('router', 1);
    const b = createDevice('switch', 2);
    const c = createDevice('pc', 3);
    const state = {
      devices: [a, b, c],
      links: [
        { id: 'l1', from: a.id, to: b.id, fromPort: 'ether1', toPort: 'ether1' },
        { id: 'l2', from: b.id, to: c.id, fromPort: 'ether2', toPort: 'ether1' }
      ]
    };

    expect(getReachableDevices(state, a.id)).toHaveLength(3);
  });

  it('detects a broken path when an interface is disabled', async () => {
    const { getReachableDevices, analyzeNetwork } = await import('./networkEngine');
    const a = createDevice('router', 1);
    const b = createDevice('switch', 2);
    const c = createDevice('pc', 3);
    const bOff = {
      ...b,
      config: {
        ...b.config,
        interfaces: {
          ...b.config.interfaces,
          ether2: { ...b.config.interfaces.ether2, enabled: false }
        }
      }
    };
    const state = {
      devices: [a, bOff, c],
      links: [
        { id: 'l1', from: a.id, to: bOff.id, fromPort: 'ether1', toPort: 'ether1' },
        { id: 'l2', from: bOff.id, to: c.id, fromPort: 'ether2', toPort: 'ether1' }
      ]
    };

    expect(getReachableDevices(state, a.id)).toEqual([a.id, bOff.id]);
    expect(analyzeNetwork(state).inactiveLinkIds).toContain('l2');
  });

  it('detects isolated devices', async () => {
    const { analyzeNetwork } = await import('./networkEngine');
    const a = createDevice('router', 1);
    const b = createDevice('pc', 2);
    const result = analyzeNetwork({ devices: [a, b], links: [] });

    expect(result.isolatedDeviceIds).toContain(a.id);
    expect(result.isolatedDeviceIds).toContain(b.id);
    expect(result.components).toHaveLength(2);
  });
});
