import type { CataloguePart } from './types'

type Point = [number, number]
type Extrusion = Extract<CataloguePart['geometry'], { kind: 'extrusion' }>

export function extrusionSection(g: Extrusion) {
  const s = g.size
  const d = g.depth ?? s
  const scale = s / 20
  const cells = Math.max(1, Math.round(d / s))
  const mouth = s === 30 ? 4 : 3 * scale
  const throat = 5.5 * scale
  const shoulder = 2 * scale
  const recess = 6.5 * scale
  const sides: Array<{ corner: Point; u: Point; n: Point; centres: Point[] }> = [
    {
      corner: [0, 0],
      u: [1, 0],
      n: [0, 1],
      centres: Array.from({ length: cells }, (_, i) => [((i + 0.5) * d) / cells, 0]),
    },
    { corner: [d, 0], u: [0, 1], n: [-1, 0], centres: [[d, s / 2]] },
    {
      corner: [d, s],
      u: [-1, 0],
      n: [0, -1],
      centres: Array.from({ length: cells }, (_, i) => [d - ((i + 0.5) * d) / cells, s]),
    },
    { corner: [0, s], u: [0, -1], n: [1, 0], centres: [[0, s / 2]] },
  ]
  const points: Point[] = []
  let remaining = g.slots ?? 2 * cells + 2
  for (const side of sides) {
    points.push(side.corner)
    for (const centre of side.centres) {
      if (remaining-- <= 0) break
      for (const [x, y] of [
        [-mouth, 0],
        [-mouth, shoulder],
        [-throat, shoulder],
        [-throat, recess],
        [throat, recess],
        [throat, shoulder],
        [mouth, shoulder],
        [mouth, 0],
      ])
        points.push([
          centre[0] + side.u[0] * x + side.n[0] * y,
          centre[1] + side.u[1] * x + side.n[1] * y,
        ])
    }
  }
  return {
    points,
    bores: Array.from({ length: cells }, (_, i) => ({
      x: ((i + 0.5) * d) / cells,
      y: s / 2,
      radius: 2.1 * scale,
    })),
  }
}
