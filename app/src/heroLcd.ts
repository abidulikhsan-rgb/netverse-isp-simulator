export type HeroLcdView = 'overview' | 'traffic' | 'alerts';

export type HeroLcdData = {
  cpuLoadPct?: number;
  onlineDevices?: number;
  totalDevices?: number;
  downMbps?: number;
  upMbps?: number;
  issueCount?: number;
  criticalIssueCount?: number;
  uptimeSeconds?: number;
};

export type HeroLcdSource = {
  devices: ReadonlyArray<{ reachable: boolean }>;
  issues: ReadonlyArray<{ severity: 'critical' | 'warning' }>;
  totalDown: number;
  totalUp: number;
};

export const HERO_LCD_HOSTNAME = 'CCR1072-1G-8S+';

export function nextHeroLcdView(view: HeroLcdView): HeroLcdView {
  if (view === 'overview') return 'traffic';
  if (view === 'traffic') return 'alerts';
  return 'overview';
}

function safeNumber(value: number | undefined): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function safeCount(value: number | undefined): number {
  return Math.max(0, Math.floor(safeNumber(value)));
}

export function heroLcdData(source: HeroLcdSource, uptimeSeconds: number): HeroLcdData {
  const totalDevices = source.devices.length;
  const onlineDevices = source.devices.filter(device => device.reachable).length;
  const issueCount = source.issues.length;
  const criticalIssueCount = source.issues.filter(issue => issue.severity === 'critical').length;
  const cpuLoadPct = onlineDevices > 0
    ? Math.min(100, Math.round((issueCount / onlineDevices) * 100))
    : issueCount > 0 ? 100 : 0;
  return {
    cpuLoadPct,
    onlineDevices,
    totalDevices,
    downMbps: Math.max(0, safeNumber(source.totalDown)),
    upMbps: Math.max(0, safeNumber(source.totalUp)),
    issueCount,
    criticalIssueCount,
    uptimeSeconds: safeCount(uptimeSeconds),
  };
}

function formatTraffic(mbps: number): string {
  const value = Math.max(0, mbps);
  if (value >= 1000) return `${(value / 1000).toFixed(2)} Gbps`;
  return `${Math.round(value)} Mbps`;
}

function formatUptime(seconds: number): string {
  const value = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(value / 3600);
  const minutes = Math.floor((value % 3600) / 60);
  if (hours > 0) return `${hours}h ${String(minutes).padStart(2, '0')}m`;
  return `${minutes}m`;
}

export function heroLcdLines(view: HeroLcdView, data: HeroLcdData = {}): string[] {
  const cpuLoadPct = Math.min(100, Math.max(0, Math.round(safeNumber(data.cpuLoadPct))));
  const onlineDevices = safeCount(data.onlineDevices);
  const totalDevices = safeCount(data.totalDevices);
  const downMbps = Math.max(0, safeNumber(data.downMbps));
  const upMbps = Math.max(0, safeNumber(data.upMbps));
  const issueCount = safeCount(data.issueCount);
  const criticalIssueCount = Math.min(issueCount, safeCount(data.criticalIssueCount));
  const uptimeSeconds = safeCount(data.uptimeSeconds);

  if (view === 'traffic') {
    return [
      HERO_LCD_HOSTNAME,
      `DOWN ${formatTraffic(downMbps)}`,
      `UP ${formatTraffic(upMbps)}`,
      `TOTAL ${formatTraffic(downMbps + upMbps)} [SIM]`,
    ];
  }

  if (view === 'alerts') {
    const warningCount = issueCount - criticalIssueCount;
    return [
      HERO_LCD_HOSTNAME,
      `ISSUES ${issueCount}`,
      `CRITICAL ${criticalIssueCount}`,
      warningCount > 0 ? `${warningCount} WARNINGS [SIM]` : 'NO ACTIVE ALERTS [SIM]',
    ];
  }

  return [
    HERO_LCD_HOSTNAME,
    `CPU LOAD ${cpuLoadPct}%`,
    `DEVICES ${onlineDevices}/${totalDevices} ONLINE`,
    `UPTIME ${formatUptime(uptimeSeconds)} [SIM]`,
  ];
}
