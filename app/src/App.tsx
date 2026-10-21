import { useEffect, useMemo, useRef, useState } from 'react';
import { Activity, AlertTriangle, Cable, Check, FileText, Globe, Laptop, Monitor, Network, Plus, RotateCcw, Router, Save, Search, Server, Settings2, Shield, Terminal, Trash2, X, Zap } from 'lucide-react';
import { analyzeNetwork, canConnect, createDevice, deviceStatus, removeAddress, runCommand, type Device, type DeviceKind, type DeviceStatus, type LabState, type Link } from './networkEngine';
import Room3D from './Room3D';

const kindInfo: Record<DeviceKind, { label: string; short: string; icon: typeof Router; color: string }> = {
  router: { label: 'Router', short: 'Router', icon: Router, color: '#6366f1' },
  switch: { label: 'Switch', short: 'Switch', icon: Network, color: '#3b82f6' },
  olt: { label: 'OLT', short: 'OLT', icon: Activity, color: '#8b5cf6' },
  ont: { label: 'ONT', short: 'ONT', icon: Globe, color: '#10b981' },
  pc: { label: 'Client PC', short: 'PC', icon: Monitor, color: '#64748b' },
  server: { label: 'Server', short: 'Server', icon: Server, color: '#f43f5e' },
};
const statusMeta: Record<DeviceStatus, { label: string; color: string }> = {
  up: { label: 'Online', color: '#22c55e' },
  idle: { label: 'Idle', color: '#94a3b8' },
  error: { label: 'Error', color: '#ef4444' },
};
const STORAGE_KEY = 'netverse-lab-v1';
const uid = () => Math.random().toString(36).slice(2, 9);
type LogEntry = { id: string; time: string; text: string };
type Boot = { lab: LabState; projectName: string; logs: LogEntry[] };

function loadInitial(): Boot {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { lab: { devices: [], links: [] }, projectName: 'Untitled Lab', logs: [] };
    const p = JSON.parse(raw);
    if (!p || !Array.isArray(p.lab?.devices) || !Array.isArray(p.lab?.links)) throw new Error('invalid');
    return { lab: p.lab, projectName: typeof p.projectName === 'string' ? p.projectName : 'Untitled Lab', logs: Array.isArray(p.logs) ? p.logs : [] };
  } catch { return { lab: { devices: [], links: [] }, projectName: 'Untitled Lab', logs: [] }; }
}

export default function App() {
  const [boot] = useState<Boot>(loadInitial);
  const [lab, setLab] = useState<LabState>(boot.lab);
  const [selected, setSelected] = useState<string | null>(null);
  const [configTab, setConfigTab] = useState('Overview');
  const [showConfig, setShowConfig] = useState(false);
  const [showDevicePanel, setShowDevicePanel] = useState(false);
  const [showTerminal, setShowTerminal] = useState(false);
  const [connectMode, setConnectMode] = useState(false);
  const [linkStart, setLinkStart] = useState<string | null>(null);
  const [terminalDevice, setTerminalDevice] = useState<string | null>(null);
  const [command, setCommand] = useState('');
  const [terminalLines, setTerminalLines] = useState<string[]>(['NetVerse terminal — a small RouterOS-style subset. Type /help.']);
  const [notice, setNotice] = useState('Welcome to your server room');
  const [projectName, setProjectName] = useState(boot.projectName);
  const [logs, setLogs] = useState<LogEntry[]>(boot.logs);
  const [confirm, setConfirm] = useState<null | { title: string; message: string; label: string; danger?: boolean; action: () => void }>(null);
  const historyRef = useRef<string[]>([]);
  const [histIdx, setHistIdx] = useState(-1);

  const device = lab.devices.find(d => d.id === selected) ?? null;
  const terminalRouter = lab.devices.find(d => d.id === terminalDevice) ?? lab.devices.find(d => d.kind === 'router') ?? null;
  const countByKind = useMemo(() => Object.fromEntries((Object.keys(kindInfo) as DeviceKind[]).map(k => [k, lab.devices.filter(d => d.kind === k).length])) as Record<DeviceKind, number>, [lab.devices]);
  const statusCounts = useMemo(() => { const c: Record<DeviceStatus, number> = { up: 0, idle: 0, error: 0 }; lab.devices.forEach(d => { c[deviceStatus(d, lab)]++; }); return c; }, [lab]);
  const networkAnalysis = useMemo(() => analyzeNetwork(lab), [lab]);
  const connectedDeviceCount = lab.devices.length - networkAnalysis.isolatedDeviceIds.length;
  const nameOf = (id: string) => lab.devices.find(d => d.id === id)?.name ?? '?';
  const objective = lab.devices.length === 0 ? 'Add your first device' : lab.links.length === 0 ? 'Connect two devices with a cable' : statusCounts.error > 0 ? `${statusCounts.error} device${statusCounts.error > 1 ? 's' : ''} need attention` : 'All services operational';

  useEffect(() => { try { localStorage.setItem(STORAGE_KEY, JSON.stringify({ version: 1, projectName, lab, logs })); } catch { /* storage unavailable */ } }, [lab, projectName, logs]);

  const pushLog = (text: string) => setLogs(l => [{ id: uid(), time: new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' }), text }, ...l].slice(0, 60));
  const patchDevice = (id: string, patch: Partial<Device> | ((d: Device) => Device)) => setLab(s => ({ ...s, devices: s.devices.map(d => d.id !== id ? d : typeof patch === 'function' ? patch(d) : { ...d, ...patch }) }));

  const add = (kind: DeviceKind) => {
    const index = countByKind[kind] + 1;
    const d = createDevice(kind, index);
    setLab(s => ({ ...s, devices: [...s.devices, d] })); setSelected(d.id); setConfigTab('Overview'); setShowConfig(true); setShowDevicePanel(false); pushLog(`Added ${d.name}`); setNotice(`${d.name} added`);
  };
  const removeSelected = () => {
    if (!selected) return;
    const name = lab.devices.find(d => d.id === selected)?.name ?? 'device';
    setConfirm({ title: 'Remove device?', message: `${name} and its connections will be removed.`, label: 'Remove', danger: true, action: () => { setLab(s => ({ devices: s.devices.filter(d => d.id !== selected), links: s.links.filter(l => l.from !== selected && l.to !== selected) })); pushLog(`Removed ${name}`); setSelected(null); setShowConfig(false); setNotice('Device removed'); } });
  };
  const clickDevice = (id: string) => {
    if (connectMode) {
      if (!linkStart) { setLinkStart(id); setNotice('Select the second device to run a cable'); }
      else if (canConnect(lab, linkStart, id)) {
        const link: Link = { id: uid(), from: linkStart, to: id, fromPort: 'ether1', toPort: 'ether1' };
        setLab(s => ({ ...s, links: [...s.links, link] }));
        pushLog(`Connected ${nameOf(linkStart)} ↔ ${nameOf(id)}`); setNotice('Cable connected'); setLinkStart(null); setConnectMode(false);
      } else { setNotice('Cannot connect: choose a different, unconnected device'); setLinkStart(id); }
      return;
    }
    setSelected(id); setConfigTab('Overview'); setShowConfig(true);
  };
  const run = () => {
    if (!terminalRouter || !command.trim()) return;
    const cmd = command.trim();
    historyRef.current = [...historyRef.current, cmd]; setHistIdx(-1);
    setTerminalLines(lines => [...lines, `> ${cmd}`]); pushLog(`CLI ${terminalRouter.name}: ${cmd}`);
    try { const result = runCommand(terminalRouter, cmd); patchDevice(terminalRouter.id, result.device); setTerminalLines(lines => [...lines, result.output || 'done']); }
    catch (err) { setTerminalLines(lines => [...lines, `failure: ${(err as Error).message}`]); }
    setCommand('');
  };
  const onTerminalKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    const h = historyRef.current;
    if (!h.length) return;
    if (e.key === 'ArrowUp') { e.preventDefault(); const i = histIdx < 0 ? h.length - 1 : Math.max(0, histIdx - 1); setHistIdx(i); setCommand(h[i]); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); const i = histIdx < 0 ? -1 : histIdx + 1; if (i >= h.length) { setHistIdx(-1); setCommand(''); } else { setHistIdx(i); setCommand(h[i]); } }
  };
  const saveProject = () => { const data = JSON.stringify({ version: 1, projectName, lab }, null, 2); const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([data], { type: 'application/json' })); a.download = `${projectName.toLowerCase().replace(/[^a-z0-9]+/g, '-') || 'netverse-lab'}.json`; a.click(); URL.revokeObjectURL(a.href); setNotice('Project exported'); };
  const importProject = (file?: File) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(String(reader.result));
        if (!Array.isArray(parsed.lab?.devices) || !Array.isArray(parsed.lab?.links)) throw new Error('Invalid project');
        setLab(parsed.lab); setProjectName(parsed.projectName || 'Imported Lab'); setSelected(null); setShowConfig(false); setNotice('Project imported');
      } catch { setNotice('Could not import this project file'); }
    };
    reader.readAsText(file);
  };
  const resetSim = () => setConfirm({ title: 'Reset everything?', message: 'All devices, connections, and configuration will be erased.', label: 'Reset', danger: true, action: () => { setLab({ devices: [], links: [] }); setSelected(null); setShowConfig(false); setLogs([]); setProjectName('Untitled Lab'); setNotice('Simulation reset'); } });
  const configUpdate = (fn: (d: Device) => Device) => { if (device) patchDevice(device.id, fn); };
  const tabs = ['Overview', 'Interfaces', 'IP', 'Bridge', 'DHCP', 'DNS', 'Firewall', 'Routing'];

  return <div className="app-shell">
    <header className="topbar">
      <div className="brand"><div className="brand-mark"><Network size={18}/></div><div><div className="brand-name">NetVerse <span>Lab</span></div><div className="brand-sub">Server Room Simulator</div></div></div>
      <input className="project-title" aria-label="Project name" value={projectName} onChange={e => setProjectName(e.target.value)} />
      <div className="top-actions">
        <button className="btn btn-ghost" onClick={() => setShowDevicePanel(v => !v)}><Plus size={15}/> Add device</button>
        <button className={`btn ${connectMode ? 'btn-accent' : 'btn-ghost'}`} onClick={() => { setConnectMode(v => !v); setLinkStart(null); setNotice(connectMode ? 'Cable mode off' : 'Cable mode on — click two devices'); }}><Cable size={15}/> Cable</button>
        <button className={`btn ${showTerminal ? 'btn-accent' : 'btn-ghost'}`} onClick={() => setShowTerminal(v => !v)}><Terminal size={15}/> Terminal</button>
        <button className="icon-btn" title="Import project" onClick={() => document.getElementById('project-import')?.click()}><FileText size={16}/></button>
        <input id="project-import" type="file" accept="application/json" hidden onChange={e => importProject(e.target.files?.[0])}/>
        <button className="icon-btn" title="Export project" onClick={saveProject}><Save size={16}/></button>
        <button className="icon-btn" title="Reset" onClick={resetSim}><RotateCcw size={16}/></button>
      </div>
    </header>

    <main className="workspace">
      <div className="canvas-area">
        <Room3D devices={lab.devices} links={lab.links} selectedId={selected} linkStartId={linkStart} onDeviceClick={clickDevice} onEmptyClick={() => setSelected(null)} />
        {connectMode && <div className="mode-banner"><Cable size={14}/>{linkStart ? 'Choose the second device' : 'Cable mode — click the first device'}<button onClick={() => { setConnectMode(false); setLinkStart(null); }}>Cancel</button></div>}
      </div>
      <div className="hud">
        <div className="objective"><span>OBJECTIVE</span><b>{objective}</b></div>
        <div className="hud-right">
          <span className="hud-hint"><b>WASD</b> move · <b>drag</b> look · <b>click</b> device</span>
          <span className="hud-count">{lab.devices.length} devices · {lab.links.length} links</span>
        </div>
      </div>
      <section className="network-health" aria-label="Network Health">
        <div className="network-health-head">
          <div>
            <strong>Network Health</strong>
            <span>Live topology analysis</span>
          </div>
          <span className={
            statusCounts.error > 0 || networkAnalysis.inactiveLinkIds.length > 0 || networkAnalysis.isolatedDeviceIds.length > 0
              ? "health-indicator health-warning"
              : "health-indicator"
          }>
            {statusCounts.error > 0 || networkAnalysis.inactiveLinkIds.length > 0 || networkAnalysis.isolatedDeviceIds.length > 0
              ? "Network issues detected"
              : "Network status OK"}
          </span>
        </div>
        <div className="network-health-grid">
          <div className="network-health-card">
            <span>Online devices</span>
            <strong className="metric-online">{statusCounts.up}</strong>
          </div>
          <div className="network-health-card">
            <span>Idle devices</span>
            <strong>{statusCounts.idle}</strong>
          </div>
          <div className="network-health-card">
            <span>Error devices</span>
            <strong className={statusCounts.error ? "metric-error" : "metric-online"}>{statusCounts.error}</strong>
          </div>
          <div className="network-health-card">
            <span>Active links</span>
            <strong>{lab.links.length - networkAnalysis.inactiveLinkIds.length}</strong>
          </div>
          <div className="network-health-card">
            <span>Segments</span>
            <strong>{networkAnalysis.components.length}</strong>
          </div>
          <div className="network-health-card">
            <span>Connected</span>
            <strong>{connectedDeviceCount}</strong>
          </div>
          <div className="network-health-card">
            <span>Isolated</span>
            <strong className={networkAnalysis.isolatedDeviceIds.length ? "metric-error" : "metric-online"}>{networkAnalysis.isolatedDeviceIds.length}</strong>
          </div>
          <div className="network-health-card">
            <span>Inactive links</span>
            <strong className={networkAnalysis.inactiveLinkIds.length ? "metric-error" : "metric-online"}>{networkAnalysis.inactiveLinkIds.length}</strong>
          </div>
          <div className="network-health-card">
            <span>Health score</span>
            <strong className={
              !lab.devices.length ? "" :
              (statusCounts.error === 0 && networkAnalysis.inactiveLinkIds.length === 0 && networkAnalysis.isolatedDeviceIds.length === 0) ? "metric-online" : "metric-error"
            }>{
              !lab.devices.length ? "—" :
              Math.round(100 * (
                (lab.devices.length - statusCounts.error - networkAnalysis.isolatedDeviceIds.length) +
                (lab.links.length ? lab.links.length - networkAnalysis.inactiveLinkIds.length : 0)
              ) / Math.max(1, lab.devices.length + lab.links.length)) + "%"
            }</strong>
          </div>
        </div>
        {lab.devices.length === 0 ? (
          <p className="network-health-normal">Add devices to start network monitoring.</p>
        ) : statusCounts.error === 0 &&
             networkAnalysis.inactiveLinkIds.length === 0 &&
             networkAnalysis.isolatedDeviceIds.length === 0 ? (
          <p className="network-health-normal">No network issues detected.</p>
        ) : (
          <ul className="network-health-list">
            {lab.devices.filter(d => deviceStatus(d, lab) === "error").map(d => (
              <li key={`error-${d.id}`}>{d.poweredOff ? "POWER OFF" : "ERROR"}: {d.name}{d.poweredOff ? " is switched off." : " needs inspection."}</li>
            ))}
            {networkAnalysis.inactiveLinkIds.map(id => {
              const link = lab.links.find(item => item.id === id);
              return link ? (
                <li key={`link-${id}`}>INACTIVE LINK: {nameOf(link.from)} ↔ {nameOf(link.to)}</li>
              ) : null;
            })}
            {networkAnalysis.isolatedDeviceIds.map(id => {
              const d = lab.devices.find(item => item.id === id);
              return d ? (
                <li key={`isolated-${id}`}>ISOLATED: {d.name} has no operational link.</li>
              ) : null;
            })}
          </ul>
        )}
      </section>
    </main>

    {showDevicePanel && <div className="device-panel">
      <div className="device-panel-head">Add device <button onClick={() => setShowDevicePanel(false)}><X size={14}/></button></div>
      {(Object.keys(kindInfo) as DeviceKind[]).map(kind => { const info = kindInfo[kind], Icon = info.icon; return <button className="device-item" key={kind} onClick={() => add(kind)}><span className="device-icon" style={{ background: info.color }}><Icon size={18}/></span><span className="device-text"><b>{info.short}</b><small>{info.label}</small></span></button>; })}
    </div>}

    {showTerminal && <div className="terminal-panel">
      <div className="terminal-head"><Terminal size={14}/><select value={terminalRouter?.id ?? ''} onChange={e => setTerminalDevice(e.target.value)}>{lab.devices.filter(d => d.kind === 'router').map(d => <option key={d.id} value={d.id}>{d.name}</option>)}</select><span>RouterOS-style CLI · subset only</span><button className="icon-btn" onClick={() => setShowTerminal(false)}><X size={14}/></button></div>
      <div className="terminal-output">{terminalLines.map((line, i) => <div key={i} className={line.startsWith('failure:') ? 'term-error' : line.startsWith('>') ? 'term-command' : ''}>{line}</div>)}</div>
      <form className="terminal-input" onSubmit={e => { e.preventDefault(); run(); }}><span>{terminalRouter?.config.hostname ?? 'no-router'} &gt;</span><input value={command} onChange={e => setCommand(e.target.value)} onKeyDown={onTerminalKey} placeholder={terminalRouter ? 'Type /help or a supported command…' : 'Add a router to use the terminal'} disabled={!terminalRouter}/><button disabled={!terminalRouter || !command.trim()}>Run ↵</button></form>
    </div>}

    {showConfig && device && <div className="modal-backdrop" onMouseDown={e => { if (e.target === e.currentTarget) setShowConfig(false); }}>
      <section className="winbox-window">
        <header className="winbox-title"><div className="winbox-appicon"><Router size={16}/></div><div><b>{device.config.hostname}</b><small>{kindInfo[device.kind].label} · <span style={{ color: statusMeta[deviceStatus(device, lab)].color }}>{device.poweredOff ? "Powered Off" : statusMeta[deviceStatus(device, lab)].label}</span></small></div><div className="window-actions"><button title="Close" onClick={() => setShowConfig(false)}><X size={17}/></button></div></header>
        <div className="winbox-body">
          <aside className="winbox-nav">{tabs.map(t => <button key={t} className={configTab === t ? 'win-nav-active' : ''} onClick={() => setConfigTab(t)}>{t === 'Overview' ? <Monitor size={15}/> : t === 'Interfaces' ? <Cable size={15}/> : t === 'IP' ? <Globe size={15}/> : t === 'Bridge' ? <Network size={15}/> : t === 'DHCP' ? <Laptop size={15}/> : t === 'DNS' ? <Search size={15}/> : t === 'Firewall' ? <Shield size={15}/> : <Activity size={15}/>}<span>{t}</span></button>)}</aside>
          <div className="winbox-main">
            {configTab === 'Overview' && <>
              <div className="win-section-title">Identity</div>
              <label className="field-row"><span>Name</span><input value={device.config.hostname} onChange={e => configUpdate(d => ({ ...d, name: e.target.value, config: { ...d.config, hostname: e.target.value } }))}/></label>
              <div className="overview-grid"><div><small>TYPE</small><b>{kindInfo[device.kind].label}</b></div><div><small>INTERFACES</small><b>{Object.keys(device.config.interfaces).length}</b></div><div><small>IP ADDRESSES</small><b>{device.config.addresses.length}</b></div><div><small>LINKS</small><b>{lab.links.filter(l => l.from === device.id || l.to === device.id).length}</b></div></div>
              <div className="info-strip"><Zap size={15}/> GUI and CLI edit the same configuration, autosaved to this browser.</div>
              <div className="win-section-title">Quick actions</div>
              <div className="quick-actions"><button className={device.poweredOff ? "power-action power-on" : "power-action"} onClick={() => { const nextOff = !device.poweredOff; patchDevice(device.id, { poweredOff: nextOff }); pushLog(`${device.name} powered ${nextOff ? "OFF" : "ON"}`); setNotice(`${device.name}: ${nextOff ? "Power Off" : "Power On"}`); }}><Zap size={16}/>{device.poweredOff ? "Power On" : "Power Off"}</button><button onClick={() => setConfigTab('Interfaces')}><Cable size={16}/> Interfaces</button><button onClick={() => setConfigTab('IP')}><Globe size={16}/> IP</button><button onClick={() => { setTerminalDevice(device.id); setShowTerminal(true); setShowConfig(false); }}><Terminal size={16}/> CLI</button><button className="quick-danger" onClick={removeSelected}><Trash2 size={16}/> Remove</button></div>
            </>}
            {configTab === 'Interfaces' && <>
              <div className="win-section-title">Interfaces <button className="mini-action" onClick={() => configUpdate(d => ({ ...d, config: { ...d.config, interfaces: { ...d.config.interfaces, [`ether${Object.keys(d.config.interfaces).length + 1}`]: { enabled: true } } } }))}><Plus size={13}/> Add</button></div>
              <table className="interface-table"><thead><tr><th>Interface</th><th>Status</th><th>Address</th><th>Action</th></tr></thead><tbody>{Object.entries(device.config.interfaces).map(([name, iface]) => <tr key={name}><td><span className="iface-led"/>{name}</td><td><span className={iface.enabled ? 'status-pill up' : 'status-pill down'}>{iface.enabled ? 'enabled' : 'disabled'}</span></td><td>{iface.address || '—'}</td><td><button className="table-action" onClick={() => configUpdate(d => ({ ...d, config: { ...d.config, interfaces: { ...d.config.interfaces, [name]: { ...d.config.interfaces[name], enabled: !d.config.interfaces[name].enabled } } } }))}>{iface.enabled ? 'Disable' : 'Enable'}</button></td></tr>)}</tbody></table>
            </>}
            {configTab === 'IP' && <>
              <div className="win-section-title">IP addresses</div>
              <div className="address-form"><label>Address / Prefix<input id="new-address" placeholder="192.168.1.1/24"/></label><label>Interface<select id="new-interface">{Object.keys(device.config.interfaces).map(n => <option key={n}>{n}</option>)}</select></label><button className="btn btn-primary" onClick={() => { const address = (document.getElementById('new-address') as HTMLInputElement).value.trim(), iface = (document.getElementById('new-interface') as HTMLSelectElement).value; try { const next = runCommand(device, `/ip address add address=${address} interface=${iface}`); patchDevice(device.id, next.device); pushLog(`Added IP ${address} to ${device.name}`); setNotice(next.output); (document.getElementById('new-address') as HTMLInputElement).value = ''; } catch (e) { setNotice((e as Error).message); } }}>Apply</button></div>
              <table className="interface-table"><thead><tr><th>Address</th><th>Interface</th><th>Action</th></tr></thead><tbody>{device.config.addresses.map((a, i) => <tr key={a}><td>{a.split('@')[0]}</td><td>{a.split('@')[1] || 'ether1'}</td><td><button className="table-action danger" onClick={() => { const next = removeAddress(device, i); patchDevice(device.id, next); pushLog(`Removed IP ${a.split('@')[0]}`); setNotice('Address removed'); }}>Remove</button></td></tr>)}</tbody></table>
            </>}
            {configTab === 'Bridge' && <><div className="win-section-title">Bridge</div><div className="info-strip">Bridge creation and switching are not implemented yet.</div></>}
            {configTab === 'DHCP' && <><div className="win-section-title">DHCP Server</div><label className="field-row"><span>DHCP server</span><select value={device.config.dhcp.enabled ? 'enabled' : 'disabled'} onChange={e => configUpdate(d => ({ ...d, config: { ...d.config, dhcp: { ...d.config.dhcp, enabled: e.target.value === 'enabled' } } }))}><option value="disabled">disabled</option><option value="enabled">enabled (config only)</option></select></label><label className="field-row"><span>Pool start</span><input value={device.config.dhcp.poolStart} onChange={e => configUpdate(d => ({ ...d, config: { ...d.config, dhcp: { ...d.config.dhcp, poolStart: e.target.value } } }))}/></label><label className="field-row"><span>Pool end</span><input value={device.config.dhcp.poolEnd} onChange={e => configUpdate(d => ({ ...d, config: { ...d.config, dhcp: { ...d.config.dhcp, poolEnd: e.target.value } } }))}/></label><label className="field-row"><span>Gateway</span><input value={device.config.dhcp.gateway} onChange={e => configUpdate(d => ({ ...d, config: { ...d.config, dhcp: { ...d.config.dhcp, gateway: e.target.value } } }))}/></label></>}
            {configTab === 'DNS' && <><div className="win-section-title">DNS</div>{device.config.dns.map((dns, i) => <label className="field-row" key={i}><span>Server {i + 1}</span><input value={dns} onChange={e => configUpdate(d => ({ ...d, config: { ...d.config, dns: d.config.dns.map((v, j) => i === j ? e.target.value : v) } }))}/></label>)}<button className="mini-action" onClick={() => configUpdate(d => ({ ...d, config: { ...d.config, dns: [...d.config.dns, ''] } }))}><Plus size={13}/> Add DNS server</button></>}
            {(configTab === 'Firewall' || configTab === 'Routing') && <><div className="win-section-title">{configTab}</div><div className="empty-feature"><Settings2 size={23}/><b>{configTab} is not implemented yet</b></div></>}
          </div>
        </div>
        <footer className="winbox-footer"><span>{notice}</span><div><button className="btn btn-ghost" onClick={() => setShowConfig(false)}>Close</button><button className="btn btn-primary" onClick={() => { setShowConfig(false); setNotice(`${device.config.hostname} updated`); }}><Check size={14}/> Done</button></div></footer>
      </section>
    </div>}

    {confirm && <div className="modal-backdrop" onMouseDown={e => { if (e.target === e.currentTarget) setConfirm(null); }}><section className="confirm-dialog"><div className="confirm-icon"><AlertTriangle size={20}/></div><b>{confirm.title}</b><p>{confirm.message}</p><div className="confirm-actions"><button className="btn btn-ghost" onClick={() => setConfirm(null)}>Cancel</button><button className="btn btn-danger" onClick={() => { const a = confirm.action; setConfirm(null); a(); }}>{confirm.label}</button></div></section></div>}
  </div>;
}
