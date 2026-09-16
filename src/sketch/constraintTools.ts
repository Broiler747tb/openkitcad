import { v2, type Vec2 } from '../core/math'
import { entityEnds, pointLookup, roundGeometry } from './curves'
import type { SketchTarget } from './inference'
import type { NewConstraint, Sketch2D, SketchEntity, SplineEnd } from './types'

export type ConstraintToolId =
  | 'horizontalVertical'
  | 'coincident'
  | 'tangent'
  | 'equal'
  | 'parallel'
  | 'perpendicular'
  | 'fix'
  | 'midpoint'
  | 'concentric'
  | 'collinear'
  | 'symmetry'
  | 'smooth'

export interface ConstraintToolSpec {
  id: ConstraintToolId
  label: string
  icon: string
  hint: string
  prompt: string
}

export type ConstraintOutcome =
  | { kind: 'more'; prompt: string }
  | { kind: 'apply'; constraints: NewConstraint[] }
  | { kind: 'toggleFix'; points: string[] }
  | { kind: 'invalid'; message: string }

export const CONSTRAINT_TOOLS: readonly ConstraintToolSpec[] = [
  {
    id: 'horizontalVertical',
    label: 'Horizontal/Vertical',
    icon: '⊢',
    hint: 'Lines up a line with the sketch axis it is closest to.',
    prompt: 'Select a line',
  },
  {
    id: 'coincident',
    label: 'Coincident',
    icon: '◦',
    hint: 'Puts a point on another point, or anywhere along a curve.',
    prompt: 'Select a point, then a point or curve',
  },
  {
    id: 'tangent',
    label: 'Tangent',
    icon: '⌒',
    hint: 'Makes two curves meet without a corner.',
    prompt: 'Select two curves',
  },
  {
    id: 'equal',
    label: 'Equal',
    icon: '=',
    hint: 'Gives two lines the same length, or two circles the same size.',
    prompt: 'Select two lines or two circles',
  },
  {
    id: 'parallel',
    label: 'Parallel',
    icon: '∥',
    hint: 'Keeps two lines running the same way.',
    prompt: 'Select two lines',
  },
  {
    id: 'perpendicular',
    label: 'Perpendicular',
    icon: '⊥',
    hint: 'Holds two lines at a right angle.',
    prompt: 'Select two lines',
  },
  {
    id: 'fix',
    label: 'Fix/UnFix',
    icon: '🔒',
    hint: 'Pins geometry where it is, or releases it.',
    prompt: 'Select points or curves to fix or release',
  },
  {
    id: 'midpoint',
    label: 'MidPoint',
    icon: '△',
    hint: 'Puts a point in the middle of a line.',
    prompt: 'Select a point and a line',
  },
  {
    id: 'concentric',
    label: 'Concentric',
    icon: '◎',
    hint: 'Gives two circles, arcs or ellipses the same centre.',
    prompt: 'Select two circles or arcs',
  },
  {
    id: 'collinear',
    label: 'Collinear',
    icon: '⋯',
    hint: 'Puts two lines on the same infinite line.',
    prompt: 'Select two lines',
  },
  {
    id: 'symmetry',
    label: 'Symmetry',
    icon: '⋈',
    hint: 'Mirrors two points or curves about a line.',
    prompt: 'Select two points or curves, then the line of symmetry',
  },
  {
    id: 'smooth',
    label: 'Smooth (G2)',
    icon: '∿',
    hint: 'Joins a spline to another curve with matching curvature.',
    prompt: 'Select a spline and a curve that share an end',
  },
]

const BY_ID = new Map(CONSTRAINT_TOOLS.map((tool) => [tool.id, tool]))

export function constraintTool(id: string): ConstraintToolSpec | undefined {
  return BY_ID.get(id as ConstraintToolId)
}

type Picked = { point: string } | { entity: SketchEntity }

function resolvePicks(sketch: Sketch2D, picks: readonly SketchTarget[]): Picked[] {
  return picks.flatMap((pick): Picked[] => {
    if (pick.kind === 'point') {
      return sketch.points.some((p) => p.id === pick.id) ? [{ point: pick.id }] : []
    }
    if (pick.kind !== 'entity') return []
    const entity = sketch.entities.find((e) => e.id === pick.id)
    return entity ? [{ entity }] : []
  })
}

const isLine = (p: Picked | undefined): p is { entity: Extract<SketchEntity, { kind: 'line' }> } =>
  !!p && 'entity' in p && p.entity.kind === 'line'
const isRound = (
  p: Picked | undefined,
): p is { entity: Extract<SketchEntity, { kind: 'circle' | 'arc' }> } =>
  !!p && 'entity' in p && (p.entity.kind === 'circle' || p.entity.kind === 'arc')
const isCurve = (p: Picked | undefined): p is { entity: SketchEntity } =>
  !!p && 'entity' in p && p.entity.kind !== 'point' && p.entity.kind !== 'text'
const isPoint = (p: Picked | undefined): p is { point: string } => !!p && 'point' in p

function sharedEnd(a: SketchEntity, b: SketchEntity): [SplineEnd, SplineEnd] | null {
  const ea = entityEnds(a)
  const eb = entityEnds(b)
  if (!ea || !eb) return null
  for (const [i, aEnd] of (['start', 'end'] as const).entries()) {
    for (const [j, bEnd] of (['start', 'end'] as const).entries()) {
      if (ea[i] === eb[j]) return [aEnd, bEnd]
    }
  }
  return null
}

function lineSide(sketch: Sketch2D, line: Extract<SketchEntity, { kind: 'line' }>, centre: Vec2) {
  const pts = pointLookup(sketch)
  const a = pts.get(line.p1)!
  const b = pts.get(line.p2)!
  return v2.cross(v2.sub(centre, a), v2.sub(b, a)) >= 0 ? 1 : -1
}

export function resolveConstraint(
  sketch: Sketch2D,
  id: ConstraintToolId,
  targets: readonly SketchTarget[],
): ConstraintOutcome {
  const spec = BY_ID.get(id)!
  const picks = resolvePicks(sketch, targets)
  const [a, b, c] = picks
  const more = (): ConstraintOutcome => ({ kind: 'more', prompt: spec.prompt })
  const invalid = (message: string): ConstraintOutcome => ({ kind: 'invalid', message })
  const apply = (...constraints: NewConstraint[]): ConstraintOutcome => ({
    kind: 'apply',
    constraints,
  })
  const pts = pointLookup(sketch)

  switch (id) {
    case 'horizontalVertical': {
      if (!a) return more()
      if (!isLine(a)) return invalid('Horizontal/Vertical works on a line.')
      const d = v2.sub(pts.get(a.entity.p2)!, pts.get(a.entity.p1)!)
      return apply({
        kind: Math.abs(d[0]) >= Math.abs(d[1]) ? 'horizontal' : 'vertical',
        e: a.entity.id,
      })
    }
    case 'fix': {
      if (!a) return more()
      const points = new Set<string>()
      for (const pick of picks) {
        if (isPoint(pick)) points.add(pick.point)
        else {
          const ends = entityEnds(pick.entity)
          if (ends) ends.forEach((p) => points.add(p))
          if ('c' in pick.entity) points.add(pick.entity.c)
          if (pick.entity.kind === 'spline') pick.entity.points.forEach((p) => points.add(p))
          if (pick.entity.kind === 'point' || pick.entity.kind === 'text') points.add(pick.entity.p)
        }
      }
      points.delete('origin')
      return points.size ? { kind: 'toggleFix', points: [...points] } : invalid('Nothing to fix.')
    }
    case 'coincident': {
      if (!b) return more()
      if (isPoint(a) && isPoint(b)) {
        if (a.point === b.point) return invalid('Pick two different points.')
        return apply({ kind: 'coincident', a: a.point, b: b.point })
      }
      const point = isPoint(a) ? a : isPoint(b) ? b : null
      const curve = isCurve(a) ? a : isCurve(b) ? b : null
      if (!point || !curve) return invalid('Coincident needs a point and a point or curve.')
      const ends = entityEnds(curve.entity)
      if (ends?.includes(point.point)) return invalid('That point is already on the curve.')
      const e = curve.entity
      if (e.kind === 'line') return apply({ kind: 'pointOnLine', p: point.point, e: e.id })
      if (e.kind === 'circle' || e.kind === 'arc') {
        return apply({ kind: 'pointOnCircle', p: point.point, e: e.id })
      }
      return apply({ kind: 'pointOnCurve', p: point.point, e: e.id })
    }
    case 'parallel':
    case 'perpendicular':
    case 'collinear': {
      if (!b) return more()
      if (!isLine(a) || !isLine(b)) return invalid(`${spec.label} works on two lines.`)
      if (a.entity.id === b.entity.id) return invalid('Pick two different lines.')
      return apply({ kind: id, a: a.entity.id, b: b.entity.id })
    }
    case 'equal': {
      if (!b) return more()
      if (!('entity' in a) || !('entity' in b) || a.entity.id === b.entity.id) {
        return invalid('Equal works on two lines or two circles.')
      }
      if ((isLine(a) && isLine(b)) || (isRound(a) && isRound(b))) {
        return apply({ kind: 'equal', a: a.entity.id, b: b.entity.id })
      }
      return invalid('Equal works on two lines or two circles.')
    }
    case 'concentric': {
      if (!b) return more()
      const centred = (p: Picked | undefined) =>
        !!p &&
        'entity' in p &&
        ['circle', 'arc', 'ellipse', 'ellipticalArc'].includes(p.entity.kind)
      if (!centred(a) || !centred(b))
        return invalid('Concentric works on circles, arcs and ellipses.')
      const ea = (a as { entity: SketchEntity }).entity
      const eb = (b as { entity: SketchEntity }).entity
      if (ea.id === eb.id) return invalid('Pick two different curves.')
      return apply({ kind: 'concentric', a: ea.id, b: eb.id })
    }
    case 'midpoint': {
      if (!b) return more()
      const point = isPoint(a) ? a : isPoint(b) ? b : null
      const line = isLine(a) ? a : isLine(b) ? b : null
      if (!point || !line) return invalid('MidPoint needs a point and a line.')
      if (point.point === line.entity.p1 || point.point === line.entity.p2) {
        return invalid('Pick a point that is not an end of that line.')
      }
      return apply({ kind: 'midpoint', p: point.point, e: line.entity.id })
    }
    case 'tangent': {
      if (!b) return more()
      if (!isCurve(a) || !isCurve(b) || a.entity.id === b.entity.id) {
        return invalid('Tangent works on two curves.')
      }
      if (isLine(a) && isLine(b)) return invalid('Two lines cannot be tangent. Try Collinear.')
      const line = isLine(a) ? a : isLine(b) ? b : null
      const other = line === a ? b : a
      if (line && isRound(other)) {
        const centre = pts.get(other.entity.c)!
        return apply({
          kind: 'tangent',
          line: line.entity.id,
          circle: other.entity.id,
          side: lineSide(sketch, line.entity, centre),
        })
      }
      if (isRound(a) && isRound(b)) {
        const ga = roundGeometry(a.entity, pts)
        const gb = roundGeometry(b.entity, pts)
        const apart = v2.dist(ga.centre, gb.centre)
        const side = apart >= Math.abs(ga.radius - gb.radius) + 1e-9 ? 1 : -1
        return apply({ kind: 'tangentArcs', a: a.entity.id, b: b.entity.id, side })
      }
      return apply({ kind: 'tangentCurves', a: a.entity.id, b: b.entity.id })
    }
    case 'smooth': {
      if (!b) return more()
      if (!isCurve(a) || !isCurve(b) || a.entity.id === b.entity.id) {
        return invalid('Smooth works on two curves.')
      }
      if (a.entity.kind !== 'spline' && b.entity.kind !== 'spline') {
        return invalid('Smooth needs at least one spline. Use Tangent for other curves.')
      }
      const ends = sharedEnd(a.entity, b.entity)
      if (!ends) return invalid('The two curves have to share an end point.')
      return apply({ kind: 'smooth', a: a.entity.id, aEnd: ends[0], b: b.entity.id, bEnd: ends[1] })
    }
    case 'symmetry': {
      if (!c) return more()
      if (!isLine(c)) return invalid('The third pick has to be the line of symmetry.')
      if (isPoint(a) && isPoint(b)) {
        if (a.point === b.point) return invalid('Pick two different points.')
        return apply({ kind: 'symmetric', a: a.point, b: b.point, line: c.entity.id })
      }
      if (isCurve(a) && isCurve(b) && a.entity.kind === b.entity.kind) {
        if (a.entity.id === b.entity.id) return invalid('Pick two different curves.')
        return apply({
          kind: 'symmetricEntities',
          a: a.entity.id,
          b: b.entity.id,
          line: c.entity.id,
          flip: false,
        })
      }
      return invalid('Symmetry needs two points or two curves of the same kind, then a line.')
    }
  }
}

export function toggleFixes(
  sketch: Sketch2D,
  points: readonly string[],
  newId: (p: string) => string,
) {
  const wanted = new Set(points)
  const fixed = new Set(
    sketch.constraints.flatMap((c) => (c.kind === 'fix' && wanted.has(c.p) ? [c.p] : [])),
  )
  const release = fixed.size === wanted.size
  if (release) {
    sketch.constraints = sketch.constraints.filter((c) => !(c.kind === 'fix' && wanted.has(c.p)))
    return 'released'
  }
  for (const p of sketch.points) {
    if (!wanted.has(p.id) || fixed.has(p.id)) continue
    sketch.constraints.push({ id: newId('c'), kind: 'fix', p: p.id, x: p.x, y: p.y })
  }
  return 'fixed'
}
