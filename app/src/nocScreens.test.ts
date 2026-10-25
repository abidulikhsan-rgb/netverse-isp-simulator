import { describe, expect, it } from 'vitest';
import { analyzeNetwork, createDevice, deviceStatus, type LabState } from './networkEngine';
import { planLabLayout } from './labLayout';
import { DEFAULT_POWER_GRID, powerModel, type PowerGrid } from './labMetrics';
import { drawScreen, NOC_SCREENS, pickAt, type NocData } from './nocScreens';

function fixture(grid: PowerGrid = DEFAULT_POWER_GRID): NocData {
  const online = createDevice('router', 21);
  const peer = createDevice('switch', 22);
  const standby = createDevice('olt', 23);
  const offline = { ...createDevice('ont', 24), poweredOff: true };
  const lab: LabState = {
    devices: [online, peer, standby, offline],
    links: [{ id: 'link-online', from: online.id, to: peer.id, fromPort: 'ether1', toPort: 'ether1' }],
  };
  const { places } = planLabLayout(lab.devices);
  const statusCounts = { up: 0, idle: 0, error: 0 };
  lab.devices.forEach(device => { statusCounts[deviceStatus(device, lab)] += 1; });
  return {
    lab,
    sim: { devices: [], totalDown: 0, totalUp: 0, capacityMbps: 10000, utilPct: 0, traffic: [], issues: [], issueFirstSeen: new Map() },
    statusCounts,
    analysis: analyzeNetwork(lab),
    places,
    selectedId: null,
    power: powerModel(lab, places, grid),
  };
}

function recordingCanvas(): { ctx: CanvasRenderingContext2D; texts: string[]; placedTexts: { text: string; x: number; y: number }[] } {
  const texts: string[] = [];
  const placedTexts: { text: string; x: number; y: number }[] = [];
  const ctx = {
    save() {},
    restore() {},
    fillRect() {},
    strokeRect() {},
    beginPath() {},
    moveTo() {},
    lineTo() {},
    arc() {},
    fill() {},
    stroke() {},
    measureText(text: string) { return { width: String(text).length * 6 }; },
    fillText(text: string, x: number, y: number) {
      texts.push(String(text));
      placedTexts.push({ text: String(text), x, y });
    },
  } as unknown as CanvasRenderingContext2D;
  return { ctx, texts, placedTexts };
}

describe('NOC power status screen', () => {
  it('registers the Power Status monitor', () => {
    expect(NOC_SCREENS.find(screen => screen.id === 'power')?.title).toBe('Power Status');
  });

  it('draws 24 rack tiles with real status counts and simulated watt badges', () => {
    const data = fixture();
    const { ctx, texts, placedTexts } = recordingCanvas();

    drawScreen('power', ctx, 960, 540, data);

    expect(texts).toContain('POWER STATUS — DC LORONG A/B/C');
    const rackLabels = placedTexts.filter(placed => /^LORONG [ABC] · R\d+$/.test(placed.text));
    expect(rackLabels).toHaveLength(24);
    expect(new Set(rackLabels.map(placed => Math.round(placed.x))).size).toBe(4);
    expect(new Set(rackLabels.map(placed => Math.round(placed.y))).size).toBe(6);
    expect(texts).toContain('LORONG A · R1');
    expect(texts).toContain('LORONG C · R8');
    expect(texts).toContain('online 2/4');
    expect(texts).toContain('standby 1 · offline 1');
    expect(texts.some(text => /^\d+ W · SIMULATED$/.test(text))).toBe(true);
    expect(texts.some(text => /^TOTAL BEBAN: [\d.]+ kW · SIMULATED$/.test(text))).toBe(true);
    expect(texts).toContain('Sumber: PLN — 24/24 rack');
    expect(texts).toContain('PLN');
  });

  it('marks a tripped aisle as a blackout and shows OFF rack sources', () => {
    const data = fixture({ ...DEFAULT_POWER_GRID, breakers: { A: false, B: true, C: true } });
    const { ctx, texts } = recordingCanvas();

    drawScreen('power', ctx, 960, 540, data);

    expect(texts.filter(text => text === 'OFF').length).toBeGreaterThanOrEqual(8);
    expect(texts).toContain('BLACKOUT — 1 lorong gelap');
  });

  it('shows the genset source when PLN is down', () => {
    const data = fixture({ ...DEFAULT_POWER_GRID, plnOn: false, gensetOn: true });
    const { ctx, texts } = recordingCanvas();

    drawScreen('power', ctx, 960, 540, data);

    expect(texts.filter(text => text === 'GENSET').length).toBe(24);
    expect(texts).toContain('GENSET aktif — 3 lorong');
  });

  it('does not expose device picking on the power overview', () => {
    const data = fixture();
    expect(pickAt('power', 20, 80, 960, 540, data)).toBeNull();
  });
});
