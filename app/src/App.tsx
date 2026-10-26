import { useEffect, useMemo, useRef, useState } from 'react';
import { Activity, AlertTriangle, Cable, Check, FileText, Globe, Laptop, Link2, Monitor, Network, Plus, RotateCcw, Router, Save, Search, Server, Shield, Terminal, Trash2, Volume2, X, Zap } from 'lucide-react';
import { addBridgePort, addFirewallFilterRule, addFirewallNatRule, addRoute, analyzeNetwork, canConnect, createDevice, deviceStatus, firstFreeInterface, removeAddress, removeBridgePort, removeFirewallFilterRule, removeFirewallNatRule, removeLink, removeRoute, runCommand, setLinkDevicePort, type Device, type DeviceKind, type DeviceStatus, type LabState, type Link } from './networkEngine';
import Room3D from './Room3D';
import { AISLE_NAMES, planLabLayout, type Aisle } from './labLayout';
import { DEFAULT_POWER_GRID, isAislePowered, powerModel, powerSourceForAisle, simNetwork, type PowerGrid } from './labMetrics';
import { drawScreen, pickAt, NOC_SCREENS, type NocScreenId, type NocData } from './nocScreens';
import { audio, playPowerOn, type AudioSettings, type SoundName } from './audio';
import { clearRemovedLink, type Carrying, type MaintenanceAction } from './maintenance';

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
    const devices = p.lab.devices.map((d: Device) => ({ ...d, config: { ...d.config, firewall: d.config.firewall ?? { filter: [], nat: [] } } }));
    return { lab: { ...p.lab, devices }, projectName: typeof p.projectName === 'string' ? p.projectName : 'Untitled Lab', logs: Array.isArray(p.logs) ? p.logs : [] };
  } catch { return { lab: { devices: [], links: [] }, projectName: 'Untitled Lab', logs: [] }; }
}

function NocDetailPanel({ id, data, onClose, onPickDevice }: { id: NocScreenId; data: NocData; onClose: () => void; onPickDevice: (id: string) => void }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    let alive = true;
    const draw = () => {
      const c = ref.current;
      if (!c || !alive) return;
      c.width = 960; c.height = 540;
      const ctx = c.getContext('2d');
      if (ctx) drawScreen(id, ctx, 960, 540, { ...data, sim: simNetwork(data.lab) });
    };
    draw();
    const iv = setInterval(draw, 500);
    return () => { alive = false; clearInterval(iv); };
  }, [id, data]);
  const onClick = (e: { clientX: number; clientY: number }) => {
    const c = ref.current;
    if (!c) return;
    const r = c.getBoundingClientRect();
    const mx = ((e.clientX - r.left) * c.width) / r.width;
    const my = ((e.clientY - r.top) * c.height) / r.height;
    const dev = pickAt(id, mx, my, c.width, c.height, data);
    if (dev) onPickDevice(dev);
  };
  const title = NOC_SCREENS.find(sc => sc.id === id)?.title ?? id;
  return (
    <div className="noc-detail" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
      <section className="noc-detail-card">
        <header className="noc-detail-head">
          <b>{title}</b>
          <span>{id === 'dude' ? 'Simulasi gaya The Dude — bukan koneksi ke Dude asli' : id === 'power' ? 'Status perangkat nyata · watt simulasi' : 'Monitor NOC · klik perangkat untuk detail'}</span>
          <button className="icon-btn" onClick={onClose}><X size={16}/></button>
        </header>
        <canvas ref={ref} className="noc-detail-canvas" onClick={onClick} />
      </section>
    </div>
  );
}

export function RemoteOpsPanel({ onMikroTik, onSsh, onPowerOff, onClose }: { onMikroTik: () => void; onSsh: () => void; onPowerOff: () => void; onClose: () => void }) {
  return (
    <div className="remote-ops" role="dialog" aria-modal="true" aria-label="Remote Ops" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
      <section className="remote-ops-card">
        <header className="remote-ops-head">
          <div><b>Remote Ops</b><span>PC NOC aktif · pilih konsol tujuan</span></div>
          <button className="icon-btn" onClick={onClose} aria-label="Tutup Remote Ops"><X size={16}/></button>
        </header>
        <div className="remote-ops-actions">
          <button className="remote-ops-choice" onClick={onMikroTik}>
            <Terminal size={22}/>
            <span><b>MikroTik CLI (Winbox-style)</b><small>RouterOS-style terminal yang sudah ada</small></span>
          </button>
          <button className="remote-ops-choice" onClick={onSsh}>
            <Server size={22}/>
            <span><b>SSH Linux — server real</b><small>Terminal Linux asli melalui ttyd</small></span>
          </button>
        </div>
        <footer className="remote-ops-footer">
          <span>Terminal SSH memakai server VPS nyata.</span>
          <button className="btn btn-danger" onClick={onPowerOff}>Matikan PC</button>
        </footer>
      </section>
    </div>
  );
}

export function SshPanel({ pcOn, onClose }: { pcOn: boolean; onClose: () => void }) {
  return (
    <div className="ssh-panel" role="dialog" aria-modal="true" aria-label="SSH server Linux" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
      <section className="ssh-panel-card">
        <header className="ssh-panel-head">
          <div>
            <b>SSH — server-linux (VPS real)</b>
            <span>login: teknisi · password di KREDENSIAL (browser akan meminta saat pertama)</span>
          </div>
          <button className="icon-btn" onClick={onClose} aria-label="Tutup SSH"><X size={16}/></button>
        </header>
        {pcOn
          ? <iframe className="ssh-panel-frame" src="http://45.149.187.194:7681/" title="SSH Linux server-linux" style={{ width: '100%', height: '70vh', background: '#020617' }} allow="clipboard-read; clipboard-write" />
          : <div className="ssh-panel-guard">Nyalakan PC dulu</div>}
        <footer className="ssh-panel-footer">
          <span>Terminal Linux asli (SSH port 2222) — ketik command langsung di dalam panel.</span>
          <button className="btn btn-primary" onClick={onClose}>Tutup</button>
        </footer>
      </section>
    </div>
  );
}

export function PowerPanel({ grid, onChange, onClose }: { grid: PowerGrid; onChange: (grid: PowerGrid) => void; onClose: () => void }) {
  const update = (next: PowerGrid) => {
    audio.play('click');
    onChange(next);
  };
  const sourceClass = (source: string) => source.toLowerCase();
  return (
    <div className="power-panel" role="dialog" aria-modal="true" aria-label="Panel Listrik" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
      <section className="power-panel-card">
        <header className="power-panel-head">
          <div><b>Panel Listrik</b><span>Distribusi PLN, breaker lorong, dan genset</span></div>
          <button className="icon-btn" onClick={onClose} aria-label="Tutup Panel Listrik"><X size={16}/></button>
        </header>
        <div className="power-panel-body">
          <div className="power-panel-aisles">
            {AISLE_NAMES.map((aisle: Aisle) => {
              const source = powerSourceForAisle(grid, aisle);
              const breakerOn = grid.breakers[aisle];
              return (
                <div className="power-panel-row" key={aisle}>
                  <div className="power-panel-row-label"><b>Lorong {aisle}</b><small>Breaker {aisle}</small></div>
                  <span className={`power-status-pill ${sourceClass(source)}`}>{source}</span>
                  <button
                    className={`power-toggle ${breakerOn ? 'on' : 'off'}`}
                    aria-pressed={breakerOn}
                    onClick={() => update({ ...grid, breakers: { ...grid.breakers, [aisle]: !breakerOn } })}
                  >
                    {breakerOn ? 'ON' : 'OFF'}
                  </button>
                </div>
              );
            })}
          </div>
          <div className="power-panel-sources">
            <div className="power-panel-source-row">
              <div><b>PLN</b><small>Jaringan utilitas</small></div>
              <button
                className={`power-toggle ${grid.plnOn ? 'on' : 'off'}`}
                aria-pressed={grid.plnOn}
                onClick={() => update({ ...grid, plnOn: !grid.plnOn })}
              >
                {grid.plnOn ? 'PLN ON' : 'PLN OFF'}
              </button>
            </div>
            <button
              className={`power-genset-button ${grid.gensetOn ? 'running' : ''}`}
              aria-pressed={grid.gensetOn}
              onClick={() => update({ ...grid, gensetOn: !grid.gensetOn })}
            >
              {grid.gensetOn ? 'STOP GENSET' : 'START GENSET'}
            </button>
          </div>
        </div>
        <footer className="power-panel-footer">
          <span>Perubahan sumber daya langsung diterapkan ke seluruh lorong.</span>
          <button className="btn btn-primary" onClick={onClose}>Tutup</button>
        </footer>
      </section>
    </div>
  );
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
  const [room, setRoom] = useState<'dc' | 'noc' | 'power' | 'gudang'>('dc');
  const [powerGrid, setPowerGrid] = useState<PowerGrid>(DEFAULT_POWER_GRID);
  const [panelOpen, setPanelOpen] = useState(false);
  const [nocPanel, setNocPanel] = useState<NocScreenId | null>(null);
  const [pcOn, setPcOn] = useState(false);
  const [showRemoteOps, setShowRemoteOps] = useState(false);
  const [sshPanel, setSshPanel] = useState(false);
  const [audioOn, setAudioOn] = useState(audio.isReady());
  const [audioDismissed, setAudioDismissed] = useState(false);
  const [showAudioPanel, setShowAudioPanel] = useState(false);
  const [audioSettings, setAudioSettings] = useState<AudioSettings>(audio.getSettings());
  const [carrying, setCarrying] = useState<Carrying | null>(null);
  const [removedLinks, setRemovedLinks] = useState<Set<string>>(() => new Set());
  const [removedDevices, setRemovedDevices] = useState<Set<string>>(() => new Set());
  const historyRef = useRef<string[]>([]);
  const heroTerminalPoweredRef = useRef(false);
  const previousPowerGridRef = useRef<PowerGrid>(powerGrid);
  const chaosBlackoutNoticeRef = useRef(false);
  const [histIdx, setHistIdx] = useState(-1);

  const device = lab.devices.find(d => d.id === selected) ?? null;
  const terminalRouter = lab.devices.find(d => d.id === terminalDevice) ?? lab.devices.find(d => d.kind === 'router') ?? null;
  const countByKind = useMemo(() => Object.fromEntries((Object.keys(kindInfo) as DeviceKind[]).map(k => [k, lab.devices.filter(d => d.kind === k).length])) as Record<DeviceKind, number>, [lab.devices]);
  const statusCounts = useMemo(() => { const c: Record<DeviceStatus, number> = { up: 0, idle: 0, error: 0 }; lab.devices.forEach(d => { c[deviceStatus(d, lab)]++; }); return c; }, [lab]);
  const networkAnalysis = useMemo(() => analyzeNetwork(lab), [lab]);
  const nameOf = (id: string) => lab.devices.find(d => d.id === id)?.name ?? '?';
  const deviceLinks = device ? lab.links.filter(l => l.from === device.id || l.to === device.id) : [];
  const nocPlaces = useMemo(() => planLabLayout(lab.devices).places, [lab.devices]);
  const nocPower = useMemo(() => powerModel(lab, nocPlaces, powerGrid), [lab, nocPlaces, powerGrid]);
  const nocData: NocData = useMemo(() => ({ lab, sim: simNetwork(lab), statusCounts, analysis: networkAnalysis, places: nocPlaces, selectedId: selected, power: nocPower }), [lab, statusCounts, networkAnalysis, nocPlaces, selected, nocPower]);
  const openDevice = (id: string) => { setNocPanel(null); setSelected(id); setConfigTab('Overview'); setShowConfig(true); };
  const updAudio = (key: 'master' | 'ambience' | 'effects' | 'alarms' | 'muted', val: number | boolean) => setAudioSettings(audio.setSettings({ [key]: val }));
  const enableAudio = () => { audio.unlock().then(() => setAudioOn(audio.isReady())); };

  useEffect(() => { try { localStorage.setItem(STORAGE_KEY, JSON.stringify({ version: 1, projectName, lab, logs })); } catch { /* storage unavailable */ } }, [lab, projectName, logs]);

  useEffect(() => {
    const h = (e: MouseEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && t.closest('button') && !t.closest('.power-panel')) audio.play('click');
    };
    document.addEventListener('click', h);
    return () => document.removeEventListener('click', h);
  }, []);

  const prevIssuesRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    const cur = new Set(nocData.sim.issues.map(i => i.key));
    const byKey = new Map(nocData.sim.issues.map(i => [i.key, i]));
    const newIssueKeys = [...cur].filter(key => !prevIssuesRef.current.has(key));
    const hasDarkAisle = AISLE_NAMES.some(aisle => !isAislePowered(powerGrid, aisle));
    if (hasDarkAisle && newIssueKeys.length > 0) {
      audio.play('alarm-offline');
    } else {
      newIssueKeys.forEach(key => {
        const iss = byKey.get(key)!;
        let kind: 'warning' | 'offline' | 'linkdown' | 'critical' = 'warning';
        if (iss.type === 'link') kind = 'linkdown';
        else if (iss.type === 'device') {
          const dev = lab.devices.find(d => d.id === iss.deviceId);
          kind = dev?.kind === 'server' ? 'critical' : 'offline';
        }
        audio.play(`alarm-${kind}` as SoundName);
      });
    }
    if ([...prevIssuesRef.current].some(key => !cur.has(key))) audio.play('resolve');
    prevIssuesRef.current = cur;
  }, [nocData, lab.devices, powerGrid]);

  const pushLog = (text: string) => setLogs(l => [{ id: uid(), time: new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' }), text }, ...l].slice(0, 60));
  const powerOnNocPc = () => {
    if (pcOn) return;
    setPcOn(true);
    void playPowerOn().then(() => setAudioOn(audio.isReady()));
    pushLog('NOC PC powered ON');
    setNotice('NOC PC menyala — Remote Ops tersedia');
  };
  const powerOffNocPc = () => {
    setPcOn(false);
    setShowRemoteOps(false);
    setSshPanel(false);
    audio.play('click');
    pushLog('NOC PC powered OFF');
    setNotice('NOC PC dimatikan');
  };
  const openRemoteOps = () => {
    if (!pcOn) {
      setNotice('Nyalakan PC dulu');
      return;
    }
    setNocPanel(null);
    setSshPanel(false);
    setShowRemoteOps(true);
  };
  const openHeroTerminal = () => {
    const router = lab.devices.find(device => device.kind === 'router' && !removedDevices.has(device.id));
    if (!router) {
      setNotice('CCR1072 tidak dapat membuka terminal — tambahkan Router ke lab terlebih dahulu');
      return;
    }
    setTerminalDevice(router.id);
    setShowTerminal(true);
    setNotice(`Terminal CCR1072 terhubung ke ${router.name}`);
    if (!heroTerminalPoweredRef.current) {
      heroTerminalPoweredRef.current = true;
      audio.play('poweron');
    }
  };
  const patchDevice = (id: string, patch: Partial<Device> | ((d: Device) => Device)) => setLab(s => ({ ...s, devices: s.devices.map(d => d.id !== id ? d : typeof patch === 'function' ? patch(d) : { ...d, ...patch }) }));
  useEffect(() => {
    const previousGrid = previousPowerGridRef.current;
    previousPowerGridRef.current = powerGrid;
    const { places } = planLabLayout(lab.devices);
    const darkenedAisles = new Set<Aisle>();
    const restoredAisles = new Set<Aisle>();
    lab.devices.forEach(device => {
      const place = places.get(device.id);
      if (!place || removedDevices.has(device.id)) return;
      const powered = isAislePowered(powerGrid, place.aisle);
      const wasPowered = isAislePowered(previousGrid, place.aisle);
      if (!powered && !device.poweredOff) {
        patchDevice(device.id, { poweredOff: true });
        darkenedAisles.add(place.aisle);
      } else if (powered && !wasPowered && device.poweredOff) {
        patchDevice(device.id, { poweredOff: false });
        restoredAisles.add(place.aisle);
      }
    });
    if (darkenedAisles.size > 0) {
      const aisles = [...darkenedAisles].sort().join(', ');
      if (!chaosBlackoutNoticeRef.current) setNotice(`Blackout — lorong ${aisles} gelap`);
      chaosBlackoutNoticeRef.current = false;
    } else {
      chaosBlackoutNoticeRef.current = false;
    }
    if (restoredAisles.size > 0) {
      const aisles = [...restoredAisles].sort().join(', ');
      setNotice(`Power cycle menyala ulang semua perangkat lorong ${aisles}`);
    }
  }, [powerGrid, lab.devices, removedDevices]);
  const handleMaintenance = (action: MaintenanceAction) => {
    if (action.type === 'removeCable') {
      const link = lab.links.find(item => item.id === action.linkId);
      if (!link) return;
      setRemovedLinks(previous => new Set(previous).add(action.linkId));
      audio.play('click');
      audio.play('unplug');
      pushLog(`Removed faulty cable ${nameOf(link.from)} ↔ ${nameOf(link.to)}`);
      setNotice('Ambil patch cord di Gudang');
      return;
    }
    if (action.type === 'installCable') {
      const link = lab.links.find(item => item.id === action.linkId);
      if (!link) return;
      setLab(current => ({ ...current, links: current.links.map(item => item.id === action.linkId ? { ...item, faulty: false } : item) }));
      setRemovedLinks(previous => clearRemovedLink(previous, action.linkId));
      setCarrying(null);
      audio.play('resolve');
      audio.play('install', 0.35);
      pushLog(`Installed patch cord ${nameOf(link.from)} ↔ ${nameOf(link.to)}`);
      setNotice('Kabel terpasang — link pulih');
      return;
    }
    if (action.type === 'removeDevice') {
      const target = lab.devices.find(item => item.id === action.id);
      if (!target) return;
      patchDevice(action.id, { poweredOff: true });
      setRemovedDevices(previous => new Set(previous).add(action.id));
      audio.play('click');
      audio.play('unplug');
      pushLog(`Removed failed device ${target.name}`);
      setNotice('Perangkat dilepas — ambil pengganti di Gudang');
      return;
    }
    const target = lab.devices.find(item => item.id === action.id);
    if (!target) return;
    patchDevice(action.id, { poweredOff: false, faulty: false });
    setRemovedDevices(previous => {
      const next = new Set(previous);
      next.delete(action.id);
      return next;
    });
    setCarrying(null);
    audio.play('resolve');
    audio.play('install', 0.35);
    pushLog(`Installed replacement device ${target.name}`);
    setNotice('Perangkat terpasang — kembali online');
  };

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
        const a = lab.devices.find(d => d.id === linkStart)!;
        const b = lab.devices.find(d => d.id === id)!;
        const link: Link = { id: uid(), from: linkStart, to: id, fromPort: firstFreeInterface(a, lab)!, toPort: firstFreeInterface(b, lab)! };
        setLab(s => ({ ...s, links: [...s.links, link] }));
        pushLog(`Connected ${nameOf(linkStart)} ↔ ${nameOf(id)}`); setNotice(`Cable connected (${link.fromPort} ↔ ${link.toPort})`); setLinkStart(null); setConnectMode(false);
      } else { setNotice('Cannot connect: choose a different, unconnected device'); setLinkStart(id); }
      return;
    }
    setSelected(id); setConfigTab('Overview'); setShowConfig(true);
  };
  const changeLinkPort = (linkId: string, deviceId: string, port: string) => {
    try {
      const nextLab = setLinkDevicePort(lab, linkId, deviceId, port);
      setLab({ ...nextLab, links: nextLab.links.map(l => l.id === linkId ? { ...l, faulty: false } : l) });
      setRemovedLinks(previous => clearRemovedLink(previous, linkId));
      const l = lab.links.find(x => x.id === linkId);
      pushLog(`Moved ${nameOf(l?.from ?? '')} ↔ ${nameOf(l?.to ?? '')} to port ${port} (Resetting link)`);
      setNotice(`Port set to ${port} - Link restored`);
    } catch (e) { setNotice((e as Error).message); }
  };
  const unplugLink = (linkId: string) => {
    const l = lab.links.find(x => x.id === linkId);
    setLab(removeLink(lab, linkId));
    pushLog(`Unplugged ${nameOf(l?.from ?? '')} ↔ ${nameOf(l?.to ?? '')}`);
    setNotice('Cable unplugged');
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
        setLab(parsed.lab); setProjectName(parsed.projectName || 'Imported Lab'); setSelected(null); setShowConfig(false); setCarrying(null); setRemovedLinks(new Set<string>()); setRemovedDevices(new Set<string>()); setNotice('Project imported');
      } catch { setNotice('Could not import this project file'); }
    };
    reader.readAsText(file);
  };
  const resetSim = () => setConfirm({ title: 'Reset everything?', message: 'All devices, connections, and configuration will be erased.', label: 'Reset', danger: true, action: () => { setLab({ devices: [], links: [] }); setSelected(null); setShowConfig(false); setLogs([]); setProjectName('Untitled Lab'); setCarrying(null); setRemovedLinks(new Set<string>()); setRemovedDevices(new Set<string>()); setPowerGrid(DEFAULT_POWER_GRID); setPanelOpen(false); chaosBlackoutNoticeRef.current = false; setNotice('Simulation reset'); } });
  const configUpdate = (fn: (d: Device) => Device) => { if (device) patchDevice(device.id, fn); };
  const tabs = ['Overview', 'Interfaces', 'Links', 'IP', 'Bridge', 'DHCP', 'DNS', 'Firewall', 'Routing'];

  return <div className="app-shell app-immersive">
    <div className="float-toolbar">
      <input className="ft-title" aria-label="Project name" value={projectName} onChange={e => setProjectName(e.target.value)} />
      <button className="ft-btn" title="Add device" onClick={() => setShowDevicePanel(v => !v)}><Plus size={16}/></button>
      <button className={`ft-btn ${connectMode ? 'ft-active' : ''}`} title="Cable mode" onClick={() => { setConnectMode(v => !v); setLinkStart(null); setNotice(connectMode ? 'Cable mode off' : 'Cable mode on — click two devices'); }}><Cable size={16}/></button>
      <button className="ft-btn ft-danger" title="Chaos: random fault" onClick={() => {
        if (Math.random() < 0.25) {
          chaosBlackoutNoticeRef.current = true;
          setPowerGrid(current => ({ ...current, plnOn: false }));
          pushLog('BLACKOUT: PLN padam');
          setNotice('⚠ PLN PADAM — nyalakan genset di Power Room!');
          return;
        }
        if (!lab.devices.length && !lab.links.length) return;
        const isDevice = Math.random() > 0.5;
        if (isDevice && lab.devices.length) {
          const d = lab.devices[Math.floor(Math.random() * lab.devices.length)];
          patchDevice(d.id, { faulty: !d.faulty });
          pushLog(`FAULT: ${d.name} internal failure toggled`);
          setNotice(`Fault triggered on ${d.name}`);
        } else if (lab.links.length) {
          const l = lab.links[Math.floor(Math.random() * lab.links.length)];
          setLab(sv => ({ ...sv, links: sv.links.map(item => item.id === l.id ? { ...item, faulty: !item.faulty } : item) }));
          pushLog(`FAULT: Cable ${nameOf(l.from)} ↔ ${nameOf(l.to)} toggled`);
          setNotice('Cable failure triggered');
        }
      }}><AlertTriangle size={16}/></button>
      <button className={`ft-btn ${showTerminal ? 'ft-active' : ''}`} title="Terminal" onClick={() => setShowTerminal(v => !v)}><Terminal size={16}/></button>
      {!audioOn
        ? <button className="ft-btn ft-active" title="Aktifkan audio" onClick={enableAudio}><Volume2 size={16}/></button>
        : <button className={`ft-btn ${showAudioPanel ? 'ft-active' : ''}`} title="Pengaturan audio" onClick={() => setShowAudioPanel(v => !v)}><Volume2 size={16}/></button>}
      <button className="ft-btn" title="Import project" onClick={() => document.getElementById('project-import')?.click()}><FileText size={15}/></button>
      <input id="project-import" type="file" accept="application/json" hidden onChange={e => importProject(e.target.files?.[0])}/>
      <button className="ft-btn" title="Export project" onClick={saveProject}><Save size={15}/></button>
      <button className="ft-btn ft-danger" title="Reset" onClick={resetSim}><RotateCcw size={15}/></button>
    </div>
    <div className="room-pill">
      <button className={room === 'dc' ? 'rp-active' : ''} onClick={() => setRoom('dc')}>Server Room</button>
      <button className={room === 'noc' ? 'rp-active' : ''} onClick={() => setRoom('noc')}>NOC Room</button>
      <button className={room === 'power' ? 'rp-active' : ''} onClick={() => setRoom('power')}>Power Room</button>
      <button className={room === 'gudang' ? 'rp-active' : ''} onClick={() => setRoom('gudang')}>Gudang</button>
    </div>

    <main className="workspace">
      <div className="canvas-area">
        <Room3D devices={lab.devices} links={lab.links} selectedId={selected} linkStartId={linkStart} onDeviceClick={clickDevice} onEmptyClick={() => setSelected(null)} room={room} onRoomChange={setRoom} onScreenClick={(id) => setNocPanel(id)} nocData={nocData} powerGrid={powerGrid} carrying={carrying} onCarry={setCarrying} onMaintain={handleMaintenance} removedLinks={removedLinks} removedDevices={removedDevices} pcOn={pcOn} interactionLocked={showRemoteOps || sshPanel || nocPanel !== null || showConfig || confirm !== null || panelOpen} onPowerOn={powerOnNocPc} onPowerOff={powerOffNocPc} onRemoteOps={openRemoteOps} onHeroTerminal={openHeroTerminal} onOpenPowerPanel={() => setPanelOpen(true)} />
        {connectMode && <div className="mode-banner"><Cable size={14}/>{linkStart ? 'Choose the second device' : 'Cable mode — click the first device'}<button onClick={() => { setConnectMode(false); setLinkStart(null); }}>Cancel</button></div>}
      </div>
    </main>

    {carrying && (
      <div className="carry-hud" role="status">
        <span className="carry-hud-icon">{carrying.type === 'patchcord' ? <Cable size={18}/> : <Server size={18}/>}</span>
        <span>Membawa: <b>{carrying.label}</b></span>
        <button onClick={() => setCarrying(null)}>Taruh</button>
      </div>
    )}
    <div className="maintenance-notice" role="status">{notice}</div>

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
          <aside className="winbox-nav">{tabs.map(t => <button key={t} className={configTab === t ? 'win-nav-active' : ''} onClick={() => setConfigTab(t)}>{t === 'Overview' ? <Monitor size={15}/> : t === 'Interfaces' ? <Cable size={15}/> : t === 'Links' ? <Link2 size={15}/> : t === 'IP' ? <Globe size={15}/> : t === 'Bridge' ? <Network size={15}/> : t === 'DHCP' ? <Laptop size={15}/> : t === 'DNS' ? <Search size={15}/> : t === 'Firewall' ? <Shield size={15}/> : <Activity size={15}/>}<span>{t}</span></button>)}</aside>
          <div className="winbox-main">
            {configTab === 'Overview' && <>
              <div className="win-section-title">Identity</div>
              <label className="field-row"><span>Name</span><input value={device.config.hostname} onChange={e => configUpdate(d => ({ ...d, name: e.target.value, config: { ...d.config, hostname: e.target.value } }))}/></label>
              <div className="overview-grid"><div><small>TYPE</small><b>{kindInfo[device.kind].label}</b></div><div><small>INTERFACES</small><b>{Object.keys(device.config.interfaces).length}</b></div><div><small>IP ADDRESSES</small><b>{device.config.addresses.length}</b></div><div><small>LINKS</small><b>{lab.links.filter(l => l.from === device.id || l.to === device.id).length}</b></div></div>
              <div className="info-strip"><Zap size={15}/> GUI and CLI edit the same configuration, autosaved to this browser.</div>
              <div className="win-section-title">Quick actions</div>
              <div className="quick-actions">
                <button className={device.poweredOff ? "power-action power-on" : "power-action"} onClick={() => { const nextOff = !device.poweredOff; patchDevice(device.id, { poweredOff: nextOff }); pushLog(`${device.name} powered ${nextOff ? "OFF" : "ON"}`); setNotice(`${device.name}: ${nextOff ? "Power Off" : "Power On"}`); }}><Zap size={16}/>{device.poweredOff ? "Power On" : "Power Off"}</button>
                <button className="btn" onClick={() => { patchDevice(device.id, { faulty: false, poweredOff: false }); pushLog(`${device.name} has been rebooted`); setNotice(`${device.name} rebooted successfully`); }}><RotateCcw size={16}/> Reboot</button>
                <button onClick={() => setConfigTab('Interfaces')}><Cable size={16}/> Interfaces</button>
                <button onClick={() => setConfigTab('IP')}><Globe size={16}/> IP</button>
                <button onClick={() => { setTerminalDevice(device.id); setShowTerminal(true); setShowConfig(false); }}><Terminal size={16}/> CLI</button>
                <button className="quick-danger" onClick={removeSelected}><Trash2 size={16}/> Remove</button>
              </div>
            </>}
            {configTab === 'Interfaces' && <>
              <div className="win-section-title">Interfaces <button className="mini-action" onClick={() => configUpdate(d => ({ ...d, config: { ...d.config, interfaces: { ...d.config.interfaces, [`ether${Object.keys(d.config.interfaces).length + 1}`]: { enabled: true } } } }))}><Plus size={13}/> Add</button></div>
              <table className="interface-table"><thead><tr><th>Interface</th><th>Status</th><th>Address</th><th>Action</th></tr></thead><tbody>{Object.entries(device.config.interfaces).map(([name, iface]) => <tr key={name}><td><span className="iface-led"/>{name}</td><td><span className={iface.enabled ? 'status-pill up' : 'status-pill down'}>{iface.enabled ? 'enabled' : 'disabled'}</span></td><td>{iface.address || '—'}</td><td><button className="table-action" onClick={() => configUpdate(d => ({ ...d, config: { ...d.config, interfaces: { ...d.config.interfaces, [name]: { ...d.config.interfaces[name], enabled: !d.config.interfaces[name].enabled } } } }))}>{iface.enabled ? 'Disable' : 'Enable'}</button></td></tr>)}</tbody></table>
            </>}
            {configTab === 'Links' && <>
              <div className="win-section-title">Cables <span className="muted-sub">{deviceLinks.length} connected</span></div>
              {deviceLinks.length === 0 ? <div className="empty-feature"><Cable size={23}/><b>No cables connected to this device</b></div> : deviceLinks.map(l => {
                const isFrom = l.from === device.id;
                const other = lab.devices.find(d => d.id === (isFrom ? l.to : l.from));
                const myPort = isFrom ? l.fromPort : l.toPort;
                const otherPort = isFrom ? l.toPort : l.fromPort;
                return <div className="link-row" key={l.id}>
                  <label className="port-sel">This port<select value={myPort} onChange={e => changeLinkPort(l.id, device.id, e.target.value)}>{Object.keys(device.config.interfaces).map(n => <option key={n}>{n}</option>)}</select></label>
                  <span className="link-arrow"><Network size={14}/></span>
                  <div className="link-peer"><b>{other?.name ?? '?'}</b><label className="port-sel">port<select value={otherPort} disabled={!other} onChange={e => other && changeLinkPort(l.id, other.id, e.target.value)}>{other ? Object.keys(other.config.interfaces).map(n => <option key={n}>{n}</option>) : null}</select></label></div>
                  <button className="table-action danger" onClick={() => unplugLink(l.id)}>Unplug</button>
                </div>;
              })}
            </>}
            {configTab === 'IP' && <>
              <div className="win-section-title">IP addresses</div>
              <div className="address-form"><label>Address / Prefix<input id="new-address" placeholder="192.168.1.1/24"/></label><label>Interface<select id="new-interface">{Object.keys(device.config.interfaces).map(n => <option key={n}>{n}</option>)}</select></label><button className="btn btn-primary" onClick={() => { const address = (document.getElementById('new-address') as HTMLInputElement).value.trim(), iface = (document.getElementById('new-interface') as HTMLSelectElement).value; try { const next = runCommand(device, `/ip address add address=${address} interface=${iface}`); patchDevice(device.id, next.device); pushLog(`Added IP ${address} to ${device.name}`); setNotice(next.output); (document.getElementById('new-address') as HTMLInputElement).value = ''; } catch (e) { setNotice((e as Error).message); } }}>Apply</button></div>
              <table className="interface-table"><thead><tr><th>Address</th><th>Interface</th><th>Action</th></tr></thead><tbody>{device.config.addresses.map((a, i) => <tr key={a}><td>{a.split('@')[0]}</td><td>{a.split('@')[1] || 'ether1'}</td><td><button className="table-action danger" onClick={() => { const next = removeAddress(device, i); patchDevice(device.id, next); pushLog(`Removed IP ${a.split('@')[0]}`); setNotice('Address removed'); }}>Remove</button></td></tr>)}</tbody></table>
            </>}
            {configTab === 'Bridge' && <>
              <div className="win-section-title">Bridge <span className="muted-sub">bridge1</span></div>
              <div className="form-grid">
                <label>Add port<select id="bridge-port">{Object.keys(device.config.interfaces).filter(n => !device.config.bridgePorts.includes(n)).map(n => <option key={n}>{n}</option>)}</select></label>
                <button className="btn btn-primary" disabled={Object.keys(device.config.interfaces).every(n => device.config.bridgePorts.includes(n))} onClick={() => { const iface = (document.getElementById('bridge-port') as HTMLSelectElement).value; if (!iface) return; try { const next = addBridgePort(device, iface); patchDevice(device.id, next); pushLog(`Added ${iface} to bridge1 on ${device.name}`); setNotice(`${iface} added to bridge1`); } catch (e) { setNotice((e as Error).message); } }}>Add</button>
              </div>
              {device.config.bridgePorts.length === 0 ? <div className="empty-feature"><Network size={23}/><b>No bridge ports yet</b></div> : <table className="interface-table"><thead><tr><th>Port</th><th>Status</th><th/></tr></thead><tbody>{device.config.bridgePorts.map(p => <tr key={p}><td><span className="iface-led"/>{p}</td><td><span className="status-pill up">member</span></td><td><button className="table-action danger" onClick={() => { try { const next = removeBridgePort(device, p); patchDevice(device.id, next); pushLog(`Removed ${p} from bridge1`); setNotice(`${p} removed from bridge1`); } catch (e) { setNotice((e as Error).message); } }}>Remove</button></td></tr>)}</tbody></table>}
            </>}
            {configTab === 'DHCP' && <><div className="win-section-title">DHCP Server</div><label className="field-row"><span>DHCP server</span><select value={device.config.dhcp.enabled ? 'enabled' : 'disabled'} onChange={e => configUpdate(d => ({ ...d, config: { ...d.config, dhcp: { ...d.config.dhcp, enabled: e.target.value === 'enabled' } } }))}><option value="disabled">disabled</option><option value="enabled">enabled (config only)</option></select></label><label className="field-row"><span>Pool start</span><input value={device.config.dhcp.poolStart} onChange={e => configUpdate(d => ({ ...d, config: { ...d.config, dhcp: { ...d.config.dhcp, poolStart: e.target.value } } }))}/></label><label className="field-row"><span>Pool end</span><input value={device.config.dhcp.poolEnd} onChange={e => configUpdate(d => ({ ...d, config: { ...d.config, dhcp: { ...d.config.dhcp, poolEnd: e.target.value } } }))}/></label><label className="field-row"><span>Gateway</span><input value={device.config.dhcp.gateway} onChange={e => configUpdate(d => ({ ...d, config: { ...d.config, dhcp: { ...d.config.dhcp, gateway: e.target.value } } }))}/></label></>}
            {configTab === 'DNS' && <><div className="win-section-title">DNS</div>{device.config.dns.map((dns, i) => <label className="field-row" key={i}><span>Server {i + 1}</span><input value={dns} onChange={e => configUpdate(d => ({ ...d, config: { ...d.config, dns: d.config.dns.map((v, j) => i === j ? e.target.value : v) } }))}/></label>)}<button className="mini-action" onClick={() => configUpdate(d => ({ ...d, config: { ...d.config, dns: [...d.config.dns, ''] } }))}><Plus size={13}/> Add DNS server</button></>}
            {configTab === 'Routing' && <>
              <div className="win-section-title">Static Routes</div>
              <div className="form-grid">
                <label>Destination<input id="route-dst" placeholder="0.0.0.0/0"/></label>
                <label>Gateway<input id="route-gw" placeholder="192.168.1.1"/></label>
                <button className="btn btn-primary" onClick={() => { const dst = (document.getElementById('route-dst') as HTMLInputElement).value.trim(), gw = (document.getElementById('route-gw') as HTMLInputElement).value.trim(); try { const next = addRoute(device, dst, gw); patchDevice(device.id, next); pushLog(`Added route ${dst} via ${gw}`); setNotice(`Route ${dst} added`); (document.getElementById('route-dst') as HTMLInputElement).value = ''; (document.getElementById('route-gw') as HTMLInputElement).value = ''; } catch (e) { setNotice((e as Error).message); } }}>Add</button>
              </div>
              {device.config.routes.length === 0 ? <div className="empty-feature"><Activity size={23}/><b>No static routes</b></div> : <table className="interface-table"><thead><tr><th>Dst-address</th><th>Gateway</th><th/></tr></thead><tbody>{device.config.routes.map((r, i) => <tr key={r}><td>{r.split('@')[0]}</td><td>{r.split('@')[1] ?? '?'}</td><td><button className="table-action danger" onClick={() => { try { const next = removeRoute(device, i); patchDevice(device.id, next); pushLog(`Removed route ${r.split('@')[0]}`); setNotice('Route removed'); } catch (e) { setNotice((e as Error).message); } }}>Remove</button></td></tr>)}</tbody></table>}
            </>}
            {configTab === 'Firewall' && <>
              <div className="win-section-title">Filter Rules</div>
              <div className="form-grid">
                <label>Chain<select id="fw-chain"><option>input</option><option>forward</option><option>output</option></select></label>
                <label>Action<select id="fw-action"><option>accept</option><option>drop</option><option>reject</option></select></label>
                <label>Comment<input id="fw-comment" placeholder="optional"/></label>
                <button className="btn btn-primary" onClick={() => { const chain = (document.getElementById('fw-chain') as HTMLSelectElement).value, action = (document.getElementById('fw-action') as HTMLSelectElement).value, comment = (document.getElementById('fw-comment') as HTMLInputElement).value.trim(); try { const next = addFirewallFilterRule(device, chain, action, comment); patchDevice(device.id, next); pushLog(`Added filter rule chain=${chain} action=${action}`); setNotice('Filter rule added'); (document.getElementById('fw-comment') as HTMLInputElement).value = ''; } catch (e) { setNotice((e as Error).message); } }}>Add</button>
              </div>
              {device.config.firewall.filter.length === 0 ? <div className="empty-feature"><Shield size={23}/><b>No filter rules</b></div> : <table className="interface-table"><thead><tr><th>Chain</th><th>Action</th><th>Comment</th><th/></tr></thead><tbody>{device.config.firewall.filter.map((r, i) => <tr key={r.id}><td>{r.chain}</td><td><span className={`status-pill ${r.action === 'accept' ? 'up' : 'down'}`}>{r.action}</span></td><td>{r.comment || '—'}</td><td><button className="table-action danger" onClick={() => { try { const next = removeFirewallFilterRule(device, i); patchDevice(device.id, next); pushLog(`Removed filter rule ${r.chain}`); setNotice('Filter rule removed'); } catch (e) { setNotice((e as Error).message); } }}>Remove</button></td></tr>)}</tbody></table>}
              <div className="win-section-title" style={{ marginTop: 22 }}>NAT Rules</div>
              <div className="form-grid">
                <label>Chain<select id="nat-chain"><option>srcnat</option><option>dstnat</option></select></label>
                <label>Action<select id="nat-action"><option>accept</option><option>masquerade</option></select></label>
                <label>To-addresses<input id="nat-to" placeholder="optional"/></label>
                <button className="btn btn-primary" onClick={() => { const chain = (document.getElementById('nat-chain') as HTMLSelectElement).value, action = (document.getElementById('nat-action') as HTMLSelectElement).value, to = (document.getElementById('nat-to') as HTMLInputElement).value.trim(); try { const next = addFirewallNatRule(device, chain, action, to); patchDevice(device.id, next); pushLog(`Added NAT rule chain=${chain} action=${action}`); setNotice('NAT rule added'); (document.getElementById('nat-to') as HTMLInputElement).value = ''; } catch (e) { setNotice((e as Error).message); } }}>Add</button>
              </div>
              {device.config.firewall.nat.length === 0 ? <div className="empty-feature"><Shield size={23}/><b>No NAT rules</b></div> : <table className="interface-table"><thead><tr><th>Chain</th><th>Action</th><th>To-addresses</th><th/></tr></thead><tbody>{device.config.firewall.nat.map((r, i) => <tr key={r.id}><td>{r.chain}</td><td><span className="status-pill up">{r.action}</span></td><td>{r.toAddresses || '—'}</td><td><button className="table-action danger" onClick={() => { try { const next = removeFirewallNatRule(device, i); patchDevice(device.id, next); pushLog(`Removed NAT rule ${r.chain}`); setNotice('NAT rule removed'); } catch (e) { setNotice((e as Error).message); } }}>Remove</button></td></tr>)}</tbody></table>}
            </>}
          </div>
        </div>
        <footer className="winbox-footer"><span>{notice}</span><div><button className="btn btn-ghost" onClick={() => setShowConfig(false)}>Close</button><button className="btn btn-primary" onClick={() => { setShowConfig(false); setNotice(`${device.config.hostname} updated`); }}><Check size={14}/> Done</button></div></footer>
      </section>
    </div>}

    {!audioOn && !audioDismissed && (
      <div className="audio-cta">
        <span>Suara ambience & alarm NetVerse</span>
        <button onClick={enableAudio}>&#128266; Aktifkan</button>
        <button className="audio-x" onClick={() => setAudioDismissed(true)}><X size={14}/></button>
      </div>
    )}
    {showAudioPanel && audioOn && (
      <div className="audio-panel">
        <div className="audio-panel-head"><Volume2 size={14}/><b>Audio</b><button className="icon-btn" onClick={() => setShowAudioPanel(false)}><X size={14}/></button></div>
        {(['master', 'ambience', 'effects', 'alarms'] as const).map(k => (
          <label key={k} className="audio-row">
            <span>{k === 'master' ? 'Master' : k === 'ambience' ? 'Ambience' : k === 'effects' ? 'Efek' : 'Alarm'}</span>
            <input type="range" min={0} max={1} step={0.05} value={audioSettings[k]} onChange={e => updAudio(k, parseFloat(e.target.value))} />
            <b>{Math.round(audioSettings[k] * 100)}%</b>
          </label>
        ))}
        <button className={`audio-mute ${audioSettings.muted ? 'on' : ''}`} onClick={() => updAudio('muted', !audioSettings.muted)}>
          {audioSettings.muted ? 'Muted — klik untuk bunyi' : 'Mute semua audio'}
        </button>
      </div>
    )}
    {nocPanel && <NocDetailPanel id={nocPanel} data={nocData} onClose={() => setNocPanel(null)} onPickDevice={openDevice} />}
    {panelOpen && <PowerPanel grid={powerGrid} onChange={setPowerGrid} onClose={() => setPanelOpen(false)} />}
    {showRemoteOps && <RemoteOpsPanel onMikroTik={() => { setShowRemoteOps(false); setShowTerminal(true); }} onSsh={() => { setShowRemoteOps(false); setSshPanel(true); }} onPowerOff={powerOffNocPc} onClose={() => setShowRemoteOps(false)} />}
    {sshPanel && <SshPanel pcOn={pcOn} onClose={() => setSshPanel(false)} />}

    {confirm && <div className="modal-backdrop" onMouseDown={e => { if (e.target === e.currentTarget) setConfirm(null); }}><section className="confirm-dialog"><div className="confirm-icon"><AlertTriangle size={20}/></div><b>{confirm.title}</b><p>{confirm.message}</p><div className="confirm-actions"><button className="btn btn-ghost" onClick={() => setConfirm(null)}>Cancel</button><button className="btn btn-danger" onClick={() => { const a = confirm.action; setConfirm(null); a(); }}>{confirm.label}</button></div></section></div>}
  </div>;
}
