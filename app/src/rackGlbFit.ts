export type RackGlbPoint = { x: number; y: number; z: number };
export type RackGlbBounds = { min: RackGlbPoint; max: RackGlbPoint };
export type RackGlbFit = { scale: number; offset: RackGlbPoint };

export function computeRackGlbFit(
  box: RackGlbBounds,
  targetWidth: number,
  targetHeight: number,
  targetDepth: number,
): RackGlbFit | null {
  const width = box.max.x - box.min.x;
  const height = box.max.y - box.min.y;
  const depth = box.max.z - box.min.z;
  const target = [targetWidth, targetHeight, targetDepth];
  const source = [width, height, depth];

  if (
    !source.every((value) => Number.isFinite(value) && value > 0) ||
    !target.every((value) => Number.isFinite(value) && value > 0)
  ) {
    return { scale: 0, offset: { x: 0, y: 0, z: 0 } };
  }

  const axisScales = [targetWidth / width, targetHeight / height, targetDepth / depth];
  const scale = Math.min(...axisScales);
  const maxDeviation = Math.max(...axisScales.map((axisScale) => Math.abs(axisScale / scale - 1)));
  if (maxDeviation > 0.15) return null;

  return {
    scale,
    offset: {
      x: -(box.min.x + box.max.x) / 2 * scale,
      y: -box.min.y * scale,
      z: -(box.min.z + box.max.z) / 2 * scale,
    },
  };
}
