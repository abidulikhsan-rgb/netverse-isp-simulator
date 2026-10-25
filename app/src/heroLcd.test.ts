import { describe, expect, it } from 'vitest';
import { heroLcdData, heroLcdLines, nextHeroLcdView, type HeroLcdData } from './heroLcd';

const data: HeroLcdData = {
  cpuLoadPct: 27,
  onlineDevices: 3,
  totalDevices: 4,
  downMbps: 1250,
  upMbps: 240,
  issueCount: 2,
  criticalIssueCount: 1,
  uptimeSeconds: 3905,
};

describe('hero LCD views', () => {
  it('cycles overview, traffic, and alerts in order', () => {
    expect(nextHeroLcdView('overview')).toBe('traffic');
    expect(nextHeroLcdView('traffic')).toBe('alerts');
    expect(nextHeroLcdView('alerts')).toBe('overview');
  });

  it('shows hostname, CPU load, online devices, uptime, and SIM in overview', () => {
    expect(heroLcdLines('overview', data)).toEqual([
      'CCR1072-1G-8S+',
      'CPU LOAD 27%',
      'DEVICES 3/4 ONLINE',
      'UPTIME 1h 05m [SIM]',
    ]);
  });

  it('shows aggregate download, upload, and total traffic', () => {
    expect(heroLcdLines('traffic', data)).toEqual([
      'CCR1072-1G-8S+',
      'DOWN 1.25 Gbps',
      'UP 240 Mbps',
      'TOTAL 1.49 Gbps [SIM]',
    ]);
  });

  it('shows issue and critical counts with the SIM badge', () => {
    expect(heroLcdLines('alerts', data)).toEqual([
      'CCR1072-1G-8S+',
      'ISSUES 2',
      'CRITICAL 1',
      '1 WARNINGS [SIM]',
    ]);
  });

  it('shows a clear no-alert state', () => {
    expect(heroLcdLines('alerts', { ...data, issueCount: 0, criticalIssueCount: 0 })).toEqual([
      'CCR1072-1G-8S+',
      'ISSUES 0',
      'CRITICAL 0',
      'NO ACTIVE ALERTS [SIM]',
    ]);
  });

  it('uses zero-valued overview data when the data subset is empty', () => {
    expect(heroLcdLines('overview', {})).toEqual([
      'CCR1072-1G-8S+',
      'CPU LOAD 0%',
      'DEVICES 0/0 ONLINE',
      'UPTIME 0m [SIM]',
    ]);
  });

  it('derives aggregate metrics from the simulation source', () => {
    expect(heroLcdData({
      devices: [
        { reachable: true },
        { reachable: true },
        { reachable: true },
        { reachable: false },
      ],
      issues: [
        { severity: 'critical' },
        { severity: 'warning' },
      ],
      totalDown: 1250,
      totalUp: 240,
    }, 65)).toEqual({
      cpuLoadPct: 67,
      onlineDevices: 3,
      totalDevices: 4,
      downMbps: 1250,
      upMbps: 240,
      issueCount: 2,
      criticalIssueCount: 1,
      uptimeSeconds: 65,
    });
  });

  it('derives zero metrics from an empty simulation source', () => {
    expect(heroLcdData({ devices: [], issues: [], totalDown: 0, totalUp: 0 }, 0)).toEqual({
      cpuLoadPct: 0,
      onlineDevices: 0,
      totalDevices: 0,
      downMbps: 0,
      upMbps: 0,
      issueCount: 0,
      criticalIssueCount: 0,
      uptimeSeconds: 0,
    });
  });

  it('uses zero-valued alert data when the data subset is empty', () => {
    expect(heroLcdLines('alerts', {})).toEqual([
      'CCR1072-1G-8S+',
      'ISSUES 0',
      'CRITICAL 0',
      'NO ACTIVE ALERTS [SIM]',
    ]);
  });

  it('does not render invalid or negative metrics', () => {
    const lines = heroLcdLines('overview', {
      cpuLoadPct: Number.NaN,
      onlineDevices: -2,
      totalDevices: -4,
      uptimeSeconds: -10,
    });

    expect(lines).toEqual([
      'CCR1072-1G-8S+',
      'CPU LOAD 0%',
      'DEVICES 0/0 ONLINE',
      'UPTIME 0m [SIM]',
    ]);
    expect(lines.join(' ')).not.toContain('NaN');
  });
});
