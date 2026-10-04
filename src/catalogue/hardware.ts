import type { CataloguePart, PartGeometry } from './types'

export function beltProfile(g: Extract<PartGeometry, { kind: 'belt' }>): [number, number][] {
  const points: [number, number][] = [
    [0, g.thickness],
    [g.length, g.thickness],
    [g.length, g.toothHeight],
  ]
  const half = g.pitch * 0.3
  for (
    let centre = Math.floor(g.length / g.pitch) * g.pitch - g.pitch / 2;
    centre > 0;
    centre -= g.pitch
  ) {
    points.push(
      [Math.min(g.length, centre + half), g.toothHeight],
      [centre + half * 0.65, 0],
      [centre - half * 0.65, 0],
      [Math.max(0, centre - half), g.toothHeight],
    )
  }
  points.push([0, g.toothHeight])
  return points
}

export function adjustableDimensions(
  part: CataloguePart,
): { key: string; label: string; value: number; min: number; max: number; step: number }[] {
  const g = part.geometry
  if (g.kind === 'extrusion' || g.kind === 'rod' || g.kind === 'belt')
    return [
      {
        key: 'length',
        label: 'Length',
        value: g.length,
        min: g.kind === 'belt' ? g.pitch : 1,
        max: g.kind === 'belt' ? 2000 : 10000,
        step: g.kind === 'rod' ? 1 : 10,
      },
    ]
  if (g.kind === 'board' && g.outline.shape === 'rect' && part.look?.style === 'lipo-pouch')
    return [
      { key: 'width', label: 'Width', value: g.outline.w, min: 5, max: 500, step: 1 },
      { key: 'length', label: 'Length', value: g.outline.h, min: 5, max: 500, step: 1 },
      { key: 'thickness', label: 'Thickness', value: g.thickness, min: 1, max: 50, step: 0.5 },
    ]
  return []
}
