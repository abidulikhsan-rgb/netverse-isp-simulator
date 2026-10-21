import { useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react';
import { Activity, AlertTriangle, Cable, Check, ChevronDown, CircleHelp, Clock, FileText, Globe, Laptop, LayoutDashboard, Menu, Monitor, Network, Plus, Router, RotateCcw, Save, Search, Server, Settings2, Shield, Terminal, Trash2, X, Zap } from 'lucide-react';
import { canConnect, createDevice, deviceStatus, removeAddress, runCommand, type Device, type DeviceKind, type DeviceStatus, type LabState, type Link } from './networkEngine';

const kindInfo: Record<DeviceKind, { label: string; short: string; icon: typeof Router; color: string }> = {
  router: { label: 'MikroTik Router', short: 'Router', icon: Router, color: '#dca36a' },
  switch: { label: 'Ethernet Switch', short: 'Switch', icon: Network, color: '#79a7df' },
  olt: { label: 'Optical Line Terminal', short: 'OLT', icon: Activity, color: '#a99ae8' },
  ont: { label: 'Optical Network Terminal', short: 'ONT', icon: Globe, color: '#8dc7aa' },
  pc: { label: 'Client PC', short: 'PC', icon: Monitor, color: '#b5becb' },
  server: { label: 'Server', short: 'Server', icon: Server, color: '#df8c9a' },
};
const statusMeta: Record<DeviceStatus, { label: string; color: string }> = {
  up: { label: 'Online', color: '#7ec9a6' },
  idle: { label: 'Idle', color: '#8493a0' },
  error: { label: 'Error', color: '#e9a0a0' },
};
const STORAGE_KEY = 'netverse-lab-v1';
const uid = () => Math.random().toString(36).slice(2, 9);
type LogEntry = { id: string; time: string; text: string };
type Boot = { lab: LabState; projectName: string; logs: LogEntry[] };

function loadInitial(): Boot {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { lab: { devices: [], links: [] }, projectName: 'Untitled ISP Lab', logs: [] };
    const p = JSON.parse(raw);
    if (!p || !Array.isArray(p.lab?.devices) || !Array.isArray(p.lab?.links)) throw new Error('invalid');
    return { lab: p.lab, projectName: typeof p.projectName === 'string' ? p.projectName : 'Untitled ISP Lab', logs: Array.isArray(p.logs) ? p.logs : [] };
  } catch { return { lab: { devices: [], links: [] }, projectName: 'Untitled ISP Lab', logs: [] }; }
}

export default function App() {
  const [boot] = useState<Boot>(loadInitial);
  const [lab, setLab] = useState<LabState>(boot.lab);
  const [selected, setSelected] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'dashboard' | 'terminal' | 'guide'>('dashboard');
  const [configTab, setConfigTab] = useState('Overview');
  const [showConfig, setShowConfig] = useState(false);
  const [connectMode, setConnectMode] = useState(false);
  const [linkStart, setLinkStart] = useState<string | null>(null);
  const [terminalDevice, setTerminalDevice] = useState<string | null>(null);
  const [command, setCommand] = useState('');
  const [terminalLines, setTerminalLines] = useState<string[]>(['NetVerse RouterOS-style terminal', 'This is a simulator command subset, not RouterOS. Type /help.']);
  const [notice, setNotice] = useState('Ready · no devices in workspace');
  const [drag, setDrag] = useState<{ id: string; dx: number; dy: number } | null>(null);
  const [projectName, setProjectName] = useState(boot.projectName);
  const [logs, setLogs] = useState<LogEntry[]>(boot.logs);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [confirm, setConfirm] = useState<null | { title: string; message: string; label: string; danger?: boolean; action: () => void }>(null);
  const canvasRef = useRef<HTMLDivElement>(null);
  const historyRef = useRef<string[]>([]);
  const [histIdx, setHistIdx] = useState(-1);

  const device = lab.devices.find(d => d.id === selected) ?? null;
  const terminalRouter = lab.devices.find(d => d.id === terminalDevice) ?? lab.devices.find(d => d.kind === 'router') ?? null;
  const countByKind = useMemo(() => Object.fromEntries((Object.keys(kindInfo) as DeviceKind[]).map(k => [k, lab.devices.filter(d => d.kind === k).length])) as Record<DeviceKind, number>, [lab.devices]);
  const statusCounts = useMemo(() => { const c: Record<DeviceStatus, number> = { up: 0, idle: 0, error: 0 }; lab.devices.forEach(d => { c[deviceStatus(d, lab)]++; }); return c; }, [lab]);
  const nameOf = (id: string) => lab.devices.find(d => d.id === id)?.name ?? '?';

  useEffect(() => { try { localStorage.setItem(STORAGE_KEY, JSON.stringify({ version: 1, projectName, lab, logs })); } catch { /* storage unavailable */ } }, [lab, projectName, logs]);

  const pushLog = (text: string) => setLogs(l => [{ id: uid(), time: new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' }), text }, ...l].slice(0, 60));
  const patchDevice = (id: string, patch: Partial<Device> | ((d: Device) => Device)) => setLab(s => ({ ...s, devices: s.devices.map(d => d.id !== id ? d : typeof patch === 'function' ? patch(d) : { ...d, ...patch }) }));

  const add = (kind: DeviceKind) => {
    const index = countByKind[kind] + 1;
    const d = createDevice(kind, index, 90 + (lab.devices.length % 4) * 185, 95 + Math.floor(lab.devices.length / 4) * 140);
    setLab(s => ({ ...s, devices: [...s.devices, d] })); setSelected(d.id); setConfigTab('Overview'); setShowConfig(true); pushLog(`Added device ${d.name}`); setNotice(`${d.name} added to workspace`); setSidebarOpen(false);
  };
  const removeSelected = () => {
    if (!selected) return;
    const name = lab.devices.find(d => d.id === selected)?.name ?? 'device';
    setConfirm({ title: 'Delete device?', message: `${name} and all of its connections will be removed.`, label: 'Delete', danger: true, action: () => { setLab(s => ({ devices: s.devices.filter(d => d.id !== selected), links: s.links.filter(l => l.from !== selected && l.to !== selected) })); pushLog(`Removed device ${name}`); setSelected(null); setShowConfig(false); setNotice('Device removed'); } });
  };
  const clickDevice = (id: string) => {
    if (connectMode) {
      if (!linkStart) { setLinkStart(id); setNotice('Select the second device to create a cable'); }
      else if (canConnect(lab, linkStart, id)) {
        const link: Link = { id: uid(), from: linkStart, to: id, fromPort: 'ether1', toPort: 'ether1' };
        setLab(s => ({ ...s, links: [...s.links, link] }));
        pushLog(`Connected ${nameOf(linkStart)} ↔ ${nameOf(id)}`); setNotice('Cable connected · ether1 ↔ ether1'); setLinkStart(null); setConnectMode(false);
      } else { setNotice('Cannot connect: choose a different, unconnected device'); setLinkStart(id); }
      return;
    }
    setSelected(id); setConfigTab('Overview'); setShowConfig(true);
  };
  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!drag || !canvasRef.current) return;
    const rect = canvasRef.current.getBoundingClientRect();
    patchDevice(drag.id, d => ({ ...d, x: Math.max(15, e.clientX - rect.left + canvasRef.current!.scrollLeft - drag.dx), y: Math.max(15, e.clientY - rect.top + canvasRef.current!.scrollTop - drag.dy) }));
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
  const saveProject = () => { const data = JSON.stringify({ version: 1, projectName, lab }, null, 2); const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([data], { type: 'application/json' })); a.download = `${projectName.toLowerCase().replace(/[^a-z0-9]+/g, '-') || 'netverse-lab'}.json`; a.click(); URL.revokeObjectURL(a.href); pushLog('Exported project JSON'); setNotice('Project JSON exported'); };
  const importProject = (file?: File) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(String(reader.result));
        if (!Array.isArray(parsed.lab?.devices) || !Array.isArray(parsed.lab?.links)) throw new Error('Invalid project');
        setLab(parsed.lab); setProjectName(parsed.projectName || 'Imported ISP Lab'); setSelected(null); setShowConfig(false); setSidebarOpen(false); pushLog('Imported project'); setNotice('Project imported successfully');
      } catch { setNotice('Could not import this project file'); }
    };
    reader.readAsText(file);
  };
  const clearWorkspace = () => setConfirm({ title: 'Clear workspace?', message: 'All devices and connections will be removed.', label: 'Clear', danger: true, action: () => { setLab({ devices: [], links: [] }); setSelected(null); setShowConfig(false); pushLog('Cleared workspace'); setNotice('Workspace cleared'); } });
  const resetSim = () => setConfirm({ title: 'Reset simulation?', message: 'All devices, connections, configuration, and history will be erased. This cannot be undone.', label: 'Reset', danger: true, action: () => { setLab({ devices: [], links: [] }); setSelected(null); setShowConfig(false); setLogs([]); setProjectName('Untitled ISP Lab'); setNotice('Simulation reset'); } });
  const removeLink = (id: string) => {
    const l = lab.links.find(x => x.id === id); if (!l) return;
    const a = nameOf(l.from), b = nameOf(l.to);
    setConfirm({ title: 'Delete connection?', message: `Disconnect ${a} ↔ ${b}?`, label: 'Disconnect', danger: true, action: () => { setLab(s => ({ ...s, links: s.links.filter(x => x.id !== id) })); pushLog(`Disconnected ${a} ↔ ${b}`); setNotice('Connection removed'); } });
  };
  const configUpdate = (fn: (d: Device) => Device) => { if (device) patchDevice(device.id, fn); };
  const tabs = ['Overview', 'Interfaces', 'IP', 'Bridge', 'DHCP', 'DNS', 'Firewall', 'Routing'];

  return <div className="app-shell">
    <header className="topbar">
      <button className="hamburger" onClick={() => setSidebarOpen(v => !v)} aria-label="Toggle device library"><Menu size={20}/></button>
      <div className="brand"><div className="brand-mark"><Network size={20}/></div><div><div className="brand-name">NETVERSE <span>LAB</span></div><div className="brand-sub">ISP NETWORK SIMULATOR</div></div></div>
      <div className="project-title"><span className="live-dot"/><input aria-label="Project name" value={projectName} onChange={e => setProjectName(e.target.value)}/><ChevronDown size={14}/></div>
      <div className="top-actions">
        <span className="build-label">LOCAL PROJECT</span>
        <button className="icon-btn" title="Import project" onClick={() => document.getElementById('project-import')?.click()}><FileText size={16}/></button>
        <input id="project-import" type="file" accept="application/json" hidden onChange={e => importProject(e.target.files?.[0])}/>
        <button className="secondary-btn" onClick={saveProject}><Save size={15}/> Export lab</button>
        <button className="primary-btn" onClick={() => { pushLog('Saved lab to browser'); setNotice('Lab autosaved to browser storage'); }}><Check size={15}/> Save</button>
        <button className="icon-btn" title="Reset simulation" onClick={resetSim}><RotateCcw size={16}/></button>
      </div>
    </header>
    <div className="app-body">
      <aside className="left-rail">
        <button className={activeTab === 'dashboard' ? 'rail-active' : ''} title="Dashboard" onClick={() => setActiveTab('dashboard')}><LayoutDashboard size={19}/></button>
        <button className={activeTab === 'terminal' ? 'rail-active' : ''} title="Terminal" onClick={() => setActiveTab('terminal')}><Terminal size={19}/></button>
        <button className={activeTab === 'guide' ? 'rail-active' : ''} title="Guide" onClick={() => setActiveTab('guide')}><CircleHelp size={19}/></button>
        <div className="rail-spacer"/>
        <button title="Reset" onClick={resetSim}><RotateCcw size={19}/></button>
      </aside>
      {sidebarOpen && <div className="sidebar-backdrop" onClick={() => setSidebarOpen(false)}/>}
      <aside className={`sidebar ${sidebarOpen ? 'sidebar-open' : ''}`}>
        <div className="sidebar-heading"><span>DEVICE LIBRARY</span><Search size={15}/></div>
        <div className="sidebar-hint">Click a device to add it to your lab.</div>
        <div className="device-list">{(Object.keys(kindInfo) as DeviceKind[]).map(kind => { const info = kindInfo[kind], Icon = info.icon; return <button className="device-item" key={kind} onClick={() => add(kind)}><span className="device-icon" style={{ color: info.color }}><Icon size={20}/></span><span className="device-text"><b>{info.short}</b><small>{info.label}</small></span><Plus size={15} className="add-icon"/></button>; })}</div>
        <div className="sidebar-section">
          <div className="section-title">LAB INVENTORY <span>{lab.devices.length.toString().padStart(2, '0')}</span></div>
          {lab.devices.length === 0 ? <div className="empty-inventory">Your topology is empty.<br/>Add a device to begin.</div> : lab.devices.map(d => { const Icon = kindInfo[d.kind].icon; const st = deviceStatus(d, lab); return <button key={d.id} className={`inventory-row ${selected === d.id ? 'inventory-selected' : ''}`} onClick={() => { setSelected(d.id); setConfigTab('Overview'); setShowConfig(true); setSidebarOpen(false); }}><span className="inv-dot" style={{ background: statusMeta[st].color }}/><Icon size={15}/><span>{d.name}</span><small>{statusMeta[st].label}</small></button>; })}
        </div>
        <div className="sidebar-footer"><div className="engine-status"><span className="status-led"/><div><b>SIMULATION ENGINE</b><small>Local configuration model · autosaved</small></div></div><p>RouterOS features are simulated. Not connected to a real MikroTik device.</p></div>
      </aside>
      <main className="workspace">
        <div className="workspace-toolbar"><div className="breadcrumbs"><span>LABS</span><span className="crumb-slash">/</span><b>{projectName}</b></div><div className="toolbar-actions"><button className={connectMode ? 'tool-btn tool-on' : 'tool-btn'} onClick={() => { setConnectMode(v => !v); setLinkStart(null); setNotice(connectMode ? 'Cable tool disabled' : 'Cable tool enabled · select two devices'); }}><Cable size={15}/> Cable</button><button className="tool-btn" onClick={clearWorkspace}><Trash2 size={15}/> Clear</button><div className="toolbar-divider"/><button className="tool-btn" onClick={() => setActiveTab('guide')}><CircleHelp size={15}/> Help</button></div></div>
        <div className="workspace-content">
          <div className="canvas-area" ref={canvasRef} onPointerMove={onPointerMove} onPointerUp={() => setDrag(null)}>
            <div className="canvas-grid"/>
            <div className="canvas-label"><span>LOGICAL WORKSPACE</span><span>{lab.devices.length} DEVICES · {lab.links.length} LINKS</span></div>
            <svg className="link-layer" width="100%" height="100%">{lab.links.map(l => { const a = lab.devices.find(d => d.id === l.from), b = lab.devices.find(d => d.id === l.to); if (!a || !b) return null; return <g key={l.id}><line x1={a.x + 48} y1={a.y + 40} x2={b.x + 48} y2={b.y + 40} stroke="#718096" strokeWidth="2"/><circle cx={(a.x + b.x) / 2 + 48} cy={(a.y + b.y) / 2 + 40} r="3" fill="#7ec9a6"/></g>; })}</svg>
            {lab.devices.map(d => { const info = kindInfo[d.kind], Icon = info.icon; const st = deviceStatus(d, lab); return <button key={d.id} className={`canvas-device ${selected === d.id ? 'node-selected' : ''} ${linkStart === d.id ? 'node-link-start' : ''}`} style={{ left: d.x, top: d.y, '--node-color': info.color } as CSSProperties} onClick={() => clickDevice(d.id)} onPointerDown={e => { if (connectMode) return; e.preventDefault(); const rect = (e.currentTarget as HTMLElement).getBoundingClientRect(); setDrag({ id: d.id, dx: e.clientX - rect.left, dy: e.clientY - rect.top }); setSelected(d.id); }}><span className={`node-status node-status-${st}`} title={statusMeta[st].label} style={{ background: statusMeta[st].color }}/><span className="node-symbol"><Icon size={24}/></span><b>{d.name}</b><small>{d.kind === 'router' ? 'RouterOS-style' : info.short}</small><span className="node-ports"><i/><i/><i/></span></button>; })}
            {lab.devices.length === 0 && <div className="canvas-empty"><div className="empty-symbol"><Network size={27}/></div><h2>Build your network</h2><p>This workspace starts blank by design.<br/>Add devices from the library to begin your topology.</p><button className="primary-btn" onClick={() => add('router')}><Plus size={16}/> Add first router</button><span>TIP · Select Cable, then click two devices to connect them.</span></div>}
            {connectMode && <div className="mode-banner"><Cable size={15}/>{linkStart ? 'Choose the device to connect to' : 'Cable mode · select the first device'}<button onClick={() => { setConnectMode(false); setLinkStart(null); }}>Cancel</button></div>}
          </div>
          <div className="bottom-status"><div><span className="status-led"/>{notice}</div><div><span>ZOOM 100%</span><span>GRID ON</span><span>NETVERSE 0.3</span></div></div>
        </div>
        <div className="bottom-panel">
          <div className="panel-tabs">
            <button className={activeTab === 'dashboard' ? 'panel-tab active' : 'panel-tab'} onClick={() => setActiveTab('dashboard')}><LayoutDashboard size={14}/> Dashboard</button>
            <button className={activeTab === 'terminal' ? 'panel-tab active' : 'panel-tab'} onClick={() => setActiveTab('terminal')}><Terminal size={14}/> Terminal</button>
            <button className={activeTab === 'guide' ? 'panel-tab active' : 'panel-tab'} onClick={() => setActiveTab('guide')}><CircleHelp size={14}/> Quick guide</button>
          </div>
          {activeTab === 'dashboard' && <div className="panel-content dashboard">
            <div className="dash-cards">
              <div className="dash-card"><small>TOTAL DEVICES</small><b>{lab.devices.length}</b></div>
              <div className="dash-card"><small>ACTIVE LINKS</small><b>{lab.links.length}</b></div>
              <div className="dash-card ok"><small>ONLINE</small><b>{statusCounts.up}</b></div>
              <div className="dash-card warn"><small>ERROR</small><b>{statusCounts.error}</b></div>
              <div className="dash-card"><small>IDLE</small><b>{statusCounts.idle}</b></div>
              {(Object.keys(kindInfo) as DeviceKind[]).map(k => <div className="dash-card" key={k}><small>{kindInfo[k].short.toUpperCase()}</small><b>{countByKind[k]}</b></div>)}
            </div>
            <div className="dash-side">
              <div className="dash-block"><div className="dash-block-title"><Clock size={13}/> Recent activity</div>{logs.length === 0 ? <p className="dash-empty">No activity yet.</p> : <ul className="activity-log">{logs.slice(0, 12).map(l => <li key={l.id}><span>{l.time}</span>{l.text}</li>)}</ul>}</div>
              <div className="dash-block"><div className="dash-block-title"><Cable size={13}/> Connections ({lab.links.length})</div>{lab.links.length === 0 ? <p className="dash-empty">No connections yet.</p> : <ul className="links-list">{lab.links.map(l => <li key={l.id}><span>{nameOf(l.from)} ↔ {nameOf(l.to)}</span><button onClick={() => removeLink(l.id)} title="Disconnect"><Trash2 size={13}/></button></li>)}</ul>}</div>
            </div>
          </div>}
          {activeTab === 'terminal' && <div className="terminal-panel">
            <div className="terminal-head"><Terminal size={14}/><select value={terminalRouter?.id ?? ''} onChange={e => setTerminalDevice(e.target.value)}>{lab.devices.filter(d => d.kind === 'router').map(d => <option key={d.id} value={d.id}>{d.name}</option>)}</select><span>RouterOS-style CLI · subset only</span></div>
            <div className="terminal-output">{terminalLines.map((line, i) => <div key={i} className={line.startsWith('failure:') ? 'term-error' : line.startsWith('>') ? 'term-command' : ''}>{line}</div>)}</div>
            <form className="terminal-input" onSubmit={e => { e.preventDefault(); run(); }}><span>{terminalRouter?.config.hostname ?? 'no-router'} &gt;</span><input value={command} onChange={e => setCommand(e.target.value)} onKeyDown={onTerminalKey} placeholder={terminalRouter ? 'Type /help or a supported command…' : 'Add a router to use the terminal'} disabled={!terminalRouter}/><button disabled={!terminalRouter || !command.trim()}>Run ↵</button></form>
          </div>}
          {activeTab === 'guide' && <div className="guide-panel"><div><b>01</b><span><strong>Add devices</strong><small>Choose router, switch, OLT, ONT, PC, or server in the left library.</small></span></div><div><b>02</b><span><strong>Connect the topology</strong><small>Enable Cable, then select two different devices.</small></span></div><div><b>03</b><span><strong>Configure the router</strong><small>Open a router and use Interfaces or IP. Changes sync with the CLI.</small></span></div><div><b>04</b><span><strong>Try CLI</strong><small>Example: /ip address add address=192.168.1.1/24 interface=ether1</small></span></div><p>Current scope: working topology editor, dashboard, shared in-memory + browser-persisted config. DHCP, firewall, routing protocols, packet forwarding, and real RouterOS/CHR integration are not implemented yet.</p></div>}
        </div>
      </main>
    </div>
    {showConfig && device && <div className="modal-backdrop" onMouseDown={e => { if (e.target === e.currentTarget) setShowConfig(false); }}>
      <section className="winbox-window">
        <header className="winbox-title"><div className="winbox-appicon"><Router size={16}/></div><div><b>{device.config.hostname}</b><small>Configuration · {device.kind === 'router' ? 'MikroTik RouterOS-style' : kindInfo[device.kind].label} · <span style={{ color: statusMeta[deviceStatus(device, lab)].color }}>{statusMeta[deviceStatus(device, lab)].label}</span></small></div><div className="window-actions"><button title="Close" onClick={() => setShowConfig(false)}><X size={17}/></button></div></header>
        <div className="winbox-menu"><span>File</span><span>View</span><span>Tools</span><span>Window</span><span>Help</span></div>
        <div className="winbox-body">
          <aside className="winbox-nav">{tabs.map(t => <button key={t} className={configTab === t ? 'win-nav-active' : ''} onClick={() => setConfigTab(t)}>{t === 'Overview' ? <Monitor size={15}/> : t === 'Interfaces' ? <Cable size={15}/> : t === 'IP' ? <Globe size={15}/> : t === 'Bridge' ? <Network size={15}/> : t === 'DHCP' ? <Laptop size={15}/> : t === 'DNS' ? <Search size={15}/> : t === 'Firewall' ? <Shield size={15}/> : <Activity size={15}/>}<span>{t}</span></button>)}</aside>
          <div className="winbox-main">
            {configTab === 'Overview' && <>
              <div className="win-section-title">Router identity</div>
              <label className="field-row"><span>Identity</span><input value={device.config.hostname} onChange={e => configUpdate(d => ({ ...d, name: e.target.value, config: { ...d.config, hostname: e.target.value } }))}/></label>
              <div className="overview-grid"><div><small>DEVICE TYPE</small><b>{kindInfo[device.kind].label}</b></div><div><small>INTERFACES</small><b>{Object.keys(device.config.interfaces).length} Ethernet</b></div><div><small>IP ADDRESSES</small><b>{device.config.addresses.length}</b></div><div><small>CONNECTED LINKS</small><b>{lab.links.filter(l => l.from === device.id || l.to === device.id).length}</b></div></div>
              <div className="info-strip"><Zap size={15}/> GUI and CLI changes apply to the same shared configuration, autosaved to this browser.</div>
              <div className="win-section-title">Quick actions</div>
              <div className="quick-actions"><button onClick={() => setConfigTab('Interfaces')}><Cable size={16}/> Interfaces</button><button onClick={() => setConfigTab('IP')}><Globe size={16}/> IP Address</button><button onClick={() => { setTerminalDevice(device.id); setActiveTab('terminal'); setShowConfig(false); }}><Terminal size={16}/> Open CLI</button><button className="quick-danger" onClick={removeSelected}><Trash2 size={16}/> Delete</button></div>
            </>}
            {configTab === 'Interfaces' && <>
              <div className="win-section-title">Interface list <button className="mini-action" onClick={() => configUpdate(d => ({ ...d, config: { ...d.config, interfaces: { ...d.config.interfaces, [`ether${Object.keys(d.config.interfaces).length + 1}`]: { enabled: true } } } }))}><Plus size={13}/> Add interface</button></div>
              <table className="interface-table"><thead><tr><th>Interface</th><th>Type</th><th>Status</th><th>Address</th><th>Action</th></tr></thead><tbody>{Object.entries(device.config.interfaces).map(([name, iface]) => <tr key={name}><td><span className="iface-led"/>{name}</td><td>Ethernet</td><td><span className={iface.enabled ? 'status-pill up' : 'status-pill down'}>{iface.enabled ? 'enabled' : 'disabled'}</span></td><td>{iface.address || '—'}</td><td><button className="table-action" onClick={() => configUpdate(d => ({ ...d, config: { ...d.config, interfaces: { ...d.config.interfaces, [name]: { ...d.config.interfaces[name], enabled: !d.config.interfaces[name].enabled } } } }))}>{iface.enabled ? 'Disable' : 'Enable'}</button></td></tr>)}</tbody></table>
              <p className="subtle-note">Interface changes are shared with the terminal. Physical link state is a topology-level simulation.</p>
            </>}
            {configTab === 'IP' && <>
              <div className="win-section-title">IP addresses</div>
              <div className="address-form"><label>Address / Prefix<input id="new-address" placeholder="192.168.1.1/24"/></label><label>Interface<select id="new-interface">{Object.keys(device.config.interfaces).map(n => <option key={n}>{n}</option>)}</select></label><button className="primary-btn" onClick={() => { const address = (document.getElementById('new-address') as HTMLInputElement).value.trim(), iface = (document.getElementById('new-interface') as HTMLSelectElement).value; try { const next = runCommand(device, `/ip address add address=${address} interface=${iface}`); patchDevice(device.id, next.device); pushLog(`Added IP ${address} to ${device.name}`); setNotice(next.output); (document.getElementById('new-address') as HTMLInputElement).value = ''; } catch (e) { setNotice((e as Error).message); } }}><Plus size={14}/> Apply</button></div>
              <table className="interface-table"><thead><tr><th>Address</th><th>Network interface</th><th>Status</th><th>Action</th></tr></thead><tbody>{device.config.addresses.map((a, i) => <tr key={a}><td>{a.split('@')[0]}</td><td>{a.split('@')[1] || 'ether1'}</td><td><span className="status-pill up">active config</span></td><td><button className="table-action danger" onClick={() => { const next = removeAddress(device, i); patchDevice(device.id, next); pushLog(`Removed IP ${a.split('@')[0]} from ${device.name}`); setNotice('Address removed'); }}>Remove</button></td></tr>)}</tbody></table>
              <p className="subtle-note">This applies an address to the simulator's config model. It does not configure a physical or virtual RouterOS instance.</p>
            </>}
            {configTab === 'Bridge' && <><div className="win-section-title">Bridge configuration</div><div className="info-strip">Bridge menu preview. Bridge creation and switching behavior are not yet implemented.</div><label className="field-row"><span>Bridge name</span><input placeholder="bridge-lan" disabled/></label><button className="secondary-btn" disabled><Plus size={14}/> Add bridge</button></>}
            {configTab === 'DHCP' && <><div className="win-section-title">DHCP Server settings</div><label className="field-row"><span>DHCP server</span><select value={device.config.dhcp.enabled ? 'enabled' : 'disabled'} onChange={e => configUpdate(d => ({ ...d, config: { ...d.config, dhcp: { ...d.config.dhcp, enabled: e.target.value === 'enabled' } } }))}><option value="disabled">disabled</option><option value="enabled">enabled (config only)</option></select></label><label className="field-row"><span>Pool start</span><input value={device.config.dhcp.poolStart} onChange={e => configUpdate(d => ({ ...d, config: { ...d.config, dhcp: { ...d.config.dhcp, poolStart: e.target.value } } }))}/></label><label className="field-row"><span>Pool end</span><input value={device.config.dhcp.poolEnd} onChange={e => configUpdate(d => ({ ...d, config: { ...d.config, dhcp: { ...d.config.dhcp, poolEnd: e.target.value } } }))}/></label><label className="field-row"><span>Gateway</span><input value={device.config.dhcp.gateway} onChange={e => configUpdate(d => ({ ...d, config: { ...d.config, dhcp: { ...d.config.dhcp, gateway: e.target.value } } }))}/></label><p className="subtle-note">Values are saved to the shared model. DHCP lease allocation is not implemented yet.</p></>}
            {configTab === 'DNS' && <><div className="win-section-title">DNS settings</div>{device.config.dns.map((dns, i) => <label className="field-row" key={i}><span>Server {i + 1}</span><input value={dns} onChange={e => configUpdate(d => ({ ...d, config: { ...d.config, dns: d.config.dns.map((v, j) => i === j ? e.target.value : v) } }))}/></label>)}<button className="mini-action" onClick={() => configUpdate(d => ({ ...d, config: { ...d.config, dns: [...d.config.dns, ''] } }))}><Plus size={13}/> Add DNS server</button><p className="subtle-note">DNS settings are stored; DNS forwarding is not implemented.</p></>}
            {(configTab === 'Firewall' || configTab === 'Routing') && <><div className="win-section-title">{configTab} configuration</div><div className="empty-feature"><Settings2 size={23}/><b>{configTab} engine is not implemented yet</b><p>The tab is reserved for the next development phase. We will connect its controls to the shared config model before calling it functional.</p></div></>}
          </div>
        </div>
        <footer className="winbox-footer"><span><span className="status-led"/> connected to local simulator</span><div><button className="secondary-btn" onClick={() => setShowConfig(false)}>Close</button><button className="primary-btn" onClick={() => { setShowConfig(false); setNotice(`${device.config.hostname} configuration retained in lab state`); }}><Check size={14}/> OK</button></div></footer>
      </section>
    </div>}
    {confirm && <div className="modal-backdrop" onMouseDown={e => { if (e.target === e.currentTarget) setConfirm(null); }}><section className="confirm-dialog"><div className="confirm-icon"><AlertTriangle size={20}/></div><b>{confirm.title}</b><p>{confirm.message}</p><div className="confirm-actions"><button className="secondary-btn" onClick={() => setConfirm(null)}>Cancel</button><button className="danger-btn" onClick={() => { const a = confirm.action; setConfirm(null); a(); }}>{confirm.label}</button></div></section></div>}
    <footer className="app-footer"><span>NETVERSE ISP SIMULATOR <span className="footer-muted">/ LEARNING ENVIRONMENT</span></span><span><span className="status-led"/> LOCAL MODE <span className="footer-sep">·</span> REAL CHR NOT CONNECTED</span></footer>
  </div>;
}
