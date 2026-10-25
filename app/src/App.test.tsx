import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { PowerPanel, RemoteOpsPanel, SshPanel } from './App';
import { DEFAULT_POWER_GRID } from './labMetrics';

describe('NOC remote operations panels', () => {
  it('offers MikroTik CLI, real SSH, and PC power-off actions', () => {
    const markup = renderToStaticMarkup(
      <RemoteOpsPanel
        onMikroTik={() => undefined}
        onSsh={() => undefined}
        onPowerOff={() => undefined}
        onClose={() => undefined}
      />,
    );

    expect(markup).toContain('MikroTik CLI (Winbox-style)');
    expect(markup).toContain('SSH Linux — server real');
    expect(markup).toContain('Matikan PC');
  });

  it('embeds the real ttyd terminal when the NOC PC is on', () => {
    const markup = renderToStaticMarkup(<SshPanel pcOn onClose={() => undefined} />);

    expect(markup).toContain('SSH — server-linux (VPS real)');
    expect(markup).toContain('login: teknisi · password di KREDENSIAL');
    expect(markup).toContain('src="http://45.149.187.194:7681/"');
    expect(markup).toContain('height:70vh');
  });

  it('blocks SSH when the NOC PC is off', () => {
    const markup = renderToStaticMarkup(<SshPanel pcOn={false} onClose={() => undefined} />);

    expect(markup).toContain('Nyalakan PC dulu');
    expect(markup).not.toContain('<iframe');
  });

  it('renders the interactive power panel controls', () => {
    const markup = renderToStaticMarkup(
      <PowerPanel
        grid={DEFAULT_POWER_GRID}
        onChange={() => undefined}
        onClose={() => undefined}
      />,
    );

    expect(markup).toContain('Panel Listrik');
    expect(markup).toContain('Lorong A');
    expect(markup).toContain('Lorong B');
    expect(markup).toContain('Lorong C');
    expect(markup).toContain('PLN');
    expect(markup).toContain('START GENSET');
  });
});
