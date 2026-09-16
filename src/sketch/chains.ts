import type { Vec2 } from '../core/math'
import { curveOf, pointLookup, type Curve } from './curves'
import type { Sketch2D, SketchEntity } from './types'

export interface ChainPiece {
  entityId: string
  reversed: boolean
}

export interface SketchChain {
  pieces: ChainPiece[]
  closed: boolean
  start: Vec2
  end: Vec2
}

const CURVES = new Set(['line', 'arc', 'circle', 'ellipse', 'ellipticalArc', 'spline'])

export function chainCurves(sketch: Sketch2D): Array<{ entity: SketchEntity; curve: Curve }> {
  const pts = pointLookup(sketch)
  return sketch.entities.flatMap((entity) => {
    if (!CURVES.has(entity.kind) || ('construction' in entity && entity.construction)) return []
    const curve = curveOf(entity, pts)
    return curve ? [{ entity, curve }] : []
  })
}

export function sketchChains(sketch: Sketch2D, tolerance = 1e-6): SketchChain[] {
  const curves = chainCurves(sketch)
  const chains: SketchChain[] = []
  const open: Array<{ id: string; ends: [Vec2, Vec2] }> = []
  for (const { entity, curve } of curves) {
    if (curve.closed) {
      const at = curve.at(0)
      chains.push({
        pieces: [{ entityId: entity.id, reversed: false }],
        closed: true,
        start: at,
        end: at,
      })
    } else {
      open.push({ id: entity.id, ends: [curve.at(0), curve.at(1)] })
    }
  }
  const same = (a: Vec2, b: Vec2) => Math.hypot(a[0] - b[0], a[1] - b[1]) <= tolerance
  const touching = (point: Vec2, except: string) =>
    open.flatMap((candidate) =>
      candidate.id === except
        ? []
        : candidate.ends.flatMap((end, index) => (same(end, point) ? [{ candidate, index }] : [])),
    )
  const degree = (point: Vec2) => touching(point, '').length
  const used = new Set<string>()
  const walk = (seed: (typeof open)[number], reversed: boolean): SketchChain => {
    const pieces: ChainPiece[] = [{ entityId: seed.id, reversed }]
    used.add(seed.id)
    const start = seed.ends[reversed ? 1 : 0]
    let end = seed.ends[reversed ? 0 : 1]
    while (true) {
      if (degree(end) !== 2) break
      const next = touching(end, pieces[pieces.length - 1].entityId).find(
        ({ candidate }) => !used.has(candidate.id),
      )
      if (!next) break
      used.add(next.candidate.id)
      const flipped = next.index === 1
      pieces.push({ entityId: next.candidate.id, reversed: flipped })
      end = next.candidate.ends[flipped ? 0 : 1]
    }
    return { pieces, closed: pieces.length > 1 && same(start, end), start, end }
  }
  for (const seed of open) {
    if (used.has(seed.id)) continue
    if (degree(seed.ends[0]) !== 2) chains.push(walk(seed, false))
    else if (degree(seed.ends[1]) !== 2) chains.push(walk(seed, true))
  }
  for (const seed of open) {
    if (!used.has(seed.id)) chains.push(walk(seed, false))
  }
  return chains
}

export function chainTangent(sketch: Sketch2D, chain: SketchChain): { at: Vec2; direction: Vec2 } {
  const pts = pointLookup(sketch)
  const piece = chain.pieces[0]
  const entity = sketch.entities.find((candidate) => candidate.id === piece.entityId)!
  const curve = curveOf(entity, pts)!
  const s = piece.reversed ? 1 : 0
  const d = curve.d1(s)
  const sign = piece.reversed ? -1 : 1
  const size = Math.hypot(d[0], d[1]) || 1
  return { at: curve.at(s), direction: [(sign * d[0]) / size, (sign * d[1]) / size] }
}
