import { describe, expect, it } from 'vitest';
import { computeRackGlbFit } from './rackGlbFit';

describe('computeRackGlbFit', () => {
  it('uses one uniform scale when the asset and target ratios match', () => {
    const fit = computeRackGlbFit(
      { min: { x: -1, y: -2, z: -3 }, max: { x: 1, y: 2, z: 6 } },
      4,
      8,
      18,
    );

    expect(fit).not.toBeNull();
    expect(fit?.scale).toBeCloseTo(2);
  });

  it('centers the fitted box horizontally and places its base at y zero', () => {
    const fit = computeRackGlbFit(
      { min: { x: -1, y: -2, z: -3 }, max: { x: 1, y: 2, z: 6 } },
      4,
      8,
      18,
    );

    expect(fit?.offset.x).toBeCloseTo(0);
    expect(fit?.offset.y).toBeCloseTo(4);
    expect(fit?.offset.z).toBeCloseTo(-3);
  });

  it('returns null when the axis scale deviation exceeds 15 percent', () => {
    const fit = computeRackGlbFit(
      { min: { x: 0, y: 0, z: 0 }, max: { x: 0.62, y: 1.82, z: 1 } },
      1.86,
      5.6,
      0.9,
    );

    expect(fit).toBeNull();
  });

  it('keeps the fit at the 15 percent deviation boundary', () => {
    const fit = computeRackGlbFit(
      { min: { x: 0, y: 0, z: 0 }, max: { x: 2, y: 4, z: 9 } },
      2.3,
      4,
      9,
    );

    expect(fit).not.toBeNull();
    expect(fit?.scale).toBeCloseTo(1);
  });

  it('returns a zero-scale fit for an empty box', () => {
    const fit = computeRackGlbFit(
      { min: { x: Infinity, y: Infinity, z: Infinity }, max: { x: -Infinity, y: -Infinity, z: -Infinity } },
      1.86,
      5.6,
      0.9,
    );

    expect(fit).toEqual({ scale: 0, offset: { x: 0, y: 0, z: 0 } });
  });
});
