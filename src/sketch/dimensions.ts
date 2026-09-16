import { v2, type Vec2 } from '../core/math'
import { pointLookup, type PointLookup } from './curves'
import type { SketchTarget } from './inference'
import type { Constraint, NewConstraint, Sketch2D, SketchEntity } from './types'

export type DimensionConstraint = Extract<
  Constraint,
  {
    kind:
      'distance' | 'distanceX' | 'distanceY' | 'radius' | 'diameter' | 'angle' | 'pointLineDistance'
  }
>

export type NewDimension = Extract<
  NewConstraint,
  {
    kind:
      'distance' | 'distanceX' | 'distanceY' | 'radius' | 'diameter' | 'angle' | 'pointLineDistance'
  }
>

export interface DimensionGraphic {
  lines: Vec2[][]
  text: Vec2
  value: number
  angular: boolean
  prefix: string
}

const DIMENSION_KINDS = new Set([
  'distance',
  'distanceX',
  'distanceY',
  'radius',
  'diameter',
  'angle',
  'pointLineDistance',
])

export function isDimensionConstraint(c: Constraint | NewConstraint): c is DimensionConstraint {
  return DIMENSION_KINDS.has(c.kind)
}

function arrow(tip: Vec2, toward: Vec2, size: number): Vec2[] {
  const back = v2.scale(v2.norm(toward), -size)
  const side: Vec2 = [-back[1] * 0.35, back[0] * 0.35]
  return [v2.add(v2.add(tip, back), side), tip, v2.sub(v2.add(tip, back), side)]
}

function lineOf(sketch: Sketch2D, id: string) {
  const e = sketch.entities.find((x) => x.id === id)
  return e?.kind === 'line' ? e : null
}

function radiusOf(e: SketchEntity, pts: PointLookup): number {
  if (e.kind === 'circle') return Math.abs(e.r)
  if (e.kind === 'arc') return v2.dist(pts.get(e.c)!, pts.get(e.p1)!)
  if (e.kind === 'ellipse' || e.kind === 'ellipticalArc') return Math.max(e.rx, e.ry)
  return 0
}

export function dimensionGraphic(
  sketch: Sketch2D,
  c: DimensionConstraint | NewDimension,
  pixel: number,
  pts: PointLookup = pointLookup(sketch),
): DimensionGraphic | null {
  const size = pixel * 9
  const gap = pixel * 3
  const over = pixel * 5
  const offset = pixel * 22
  const at = 'at' in c && c.at ? (c.at as Vec2) : null
  const base = { value: c.value, angular: false, prefix: '' }

  const linear = (a: Vec2, b: Vec2, normal: Vec2, h: number, along: Vec2): DimensionGraphic => {
    const sign = Math.sign(h) || 1
    const a2 = v2.add(a, v2.scale(normal, h))
    const b2 = v2.add(b, v2.scale(normal, h))
    const span = v2.sub(b2, a2)
    const length = v2.len(span)
    const unit = length > 1e-12 ? v2.scale(span, 1 / length) : along
    const extension = (from: Vec2, to: Vec2): Vec2[] => {
      if (v2.dist(from, to) < gap) return [to, v2.add(to, v2.scale(normal, sign * over))]
      return [v2.add(from, v2.scale(normal, sign * gap)), v2.add(to, v2.scale(normal, sign * over))]
    }
    const textAlong = at ? v2.dot(v2.sub(at, a2), unit) : length / 2
    const text = v2.add(a2, v2.scale(unit, textAlong))
    const start = Math.min(0, textAlong)
    const end = Math.max(length, textAlong)
    return {
      ...base,
      lines: [
        extension(a, a2),
        extension(b, b2),
        [v2.add(a2, v2.scale(unit, start)), v2.add(a2, v2.scale(unit, end))],
        arrow(a2, v2.scale(unit, -1), size),
        arrow(b2, unit, size),
      ],
      text,
    }
  }

  switch (c.kind) {
    case 'distance': {
      const a = pts.get(c.a)
      const b = pts.get(c.b)
      if (!a || !b) return null
      const u = v2.norm(v2.sub(b, a))
      const along: Vec2 = v2.len(u) > 0 ? u : [1, 0]
      const normal: Vec2 = [-along[1], along[0]]
      const h = at ? v2.dot(v2.sub(at, a), normal) : offset
      return linear(a, b, normal, h, along)
    }
    case 'distanceX':
    case 'distanceY': {
      const a = pts.get(c.a)
      const b = pts.get(c.b)
      if (!a || !b) return null
      const horizontal = c.kind === 'distanceX'
      const normal: Vec2 = horizontal ? [0, 1] : [1, 0]
      const reference = horizontal ? Math.max(a[1], b[1]) + offset : Math.max(a[0], b[0]) + offset
      const level = at ? (horizontal ? at[1] : at[0]) : reference
      const pa: Vec2 = horizontal ? [a[0], level] : [level, a[1]]
      const pb: Vec2 = horizontal ? [b[0], level] : [level, b[1]]
      const graphic = linear(pa, pb, normal, 0, horizontal ? [1, 0] : [0, 1])
      const sign = horizontal ? Math.sign(level - a[1]) || 1 : Math.sign(level - a[0]) || 1
      const signB = horizontal ? Math.sign(level - b[1]) || 1 : Math.sign(level - b[0]) || 1
      graphic.lines[0] = [
        v2.add(a, v2.scale(normal, sign * gap)),
        v2.add(pa, v2.scale(normal, sign * over)),
      ]
      graphic.lines[1] = [
        v2.add(b, v2.scale(normal, signB * gap)),
        v2.add(pb, v2.scale(normal, signB * over)),
      ]
      graphic.value = Math.abs(c.value)
      return graphic
    }
    case 'pointLineDistance': {
      const p = pts.get(c.p)
      const line = lineOf(sketch, c.e)
      if (!p || !line) return null
      const l1 = pts.get(line.p1)!
      const l2 = pts.get(line.p2)!
      const u = v2.norm(v2.sub(l2, l1))
      const foot = v2.add(l1, v2.scale(u, v2.dot(v2.sub(p, l1), u)))
      const across = v2.sub(p, foot)
      if (v2.len(across) < 1e-12) return null
      const shift = at ? v2.dot(v2.sub(at, foot), u) : offset
      const graphic = linear(foot, p, u, shift, v2.norm(across))
      return graphic
    }
    case 'radius':
    case 'diameter': {
      const e = sketch.entities.find((x) => x.id === c.e)
      if (!e || !('c' in e)) return null
      const centre = pts.get(e.c)
      if (!centre) return null
      const r =
        c.kind === 'radius' || !('axis' in c && c.axis) ? radiusOf(e, pts) : radiusOf(e, pts)
      const direction =
        at && v2.dist(at, centre) > 1e-12 ? v2.norm(v2.sub(at, centre)) : v2.norm([1, 1])
      const tip = v2.add(centre, v2.scale(direction, r))
      const text = at ?? v2.add(centre, v2.scale(direction, r + offset))
      const outer = v2.dist(text, centre) > r ? text : tip
      if (c.kind === 'radius') {
        return {
          ...base,
          prefix: 'R',
          lines: [[centre, outer], arrow(tip, direction, size)],
          text,
        }
      }
      const far = v2.sub(centre, v2.scale(direction, r))
      return {
        ...base,
        prefix: '⌀',
        lines: [
          [far, outer],
          arrow(tip, direction, size),
          arrow(far, v2.scale(direction, -1), size),
        ],
        text,
      }
    }
    case 'angle': {
      const la = lineOf(sketch, c.a)
      const lb = lineOf(sketch, c.b)
      if (!la || !lb) return null
      const a1 = pts.get(la.p1)!
      const a2 = pts.get(la.p2)!
      const b1 = pts.get(lb.p1)!
      const b2 = pts.get(lb.p2)!
      const da = v2.sub(a2, a1)
      const db = v2.sub(b2, b1)
      const den = v2.cross(da, db)
      if (Math.abs(den) < 1e-12) return null
      const t = v2.cross(v2.sub(b1, a1), db) / den
      const vertex = v2.add(a1, v2.scale(da, t))
      let ua = v2.norm(da)
      let ub = v2.norm(db)
      const probe = at ?? v2.add(vertex, v2.scale(v2.norm(v2.add(ua, ub)), offset * 2))
      const toward = v2.norm(v2.sub(probe, vertex))
      const inSector = (p: Vec2, q: Vec2) =>
        v2.cross(p, toward) * v2.cross(p, q) >= 0 && v2.cross(q, toward) * v2.cross(q, p) >= 0
      if (!inSector(ua, ub)) {
        const options: Array<[Vec2, Vec2]> = [
          [v2.scale(ua, -1), ub],
          [ua, v2.scale(ub, -1)],
          [v2.scale(ua, -1), v2.scale(ub, -1)],
        ]
        const found = options.find(([p, q]) => inSector(p, q))
        if (found) [ua, ub] = found
      }
      const radius = Math.max(v2.dist(probe, vertex), size * 2)
      const start = Math.atan2(ua[1], ua[0])
      let sweep = Math.atan2(v2.cross(ua, ub), v2.dot(ua, ub))
      const arc: Vec2[] = []
      const steps = Math.max(8, Math.ceil(Math.abs(sweep) / 0.1))
      for (let i = 0; i <= steps; i++) {
        const angle = start + (sweep * i) / steps
        arc.push([vertex[0] + radius * Math.cos(angle), vertex[1] + radius * Math.sin(angle)])
      }
      const endA = arc[0]
      const endB = arc[arc.length - 1]
      const tangentA: Vec2 = [-Math.sin(start), Math.cos(start)]
      const endAngle = start + sweep
      const tangentB: Vec2 = [-Math.sin(endAngle), Math.cos(endAngle)]
      sweep = Math.abs(sweep)
      return {
        value: Math.abs(c.value),
        angular: true,
        prefix: '',
        lines: [
          arc,
          [vertex, endA],
          [vertex, endB],
          arrow(endA, v2.scale(tangentA, Math.sign(-sweep) || -1), size),
          arrow(endB, tangentB, size),
        ],
        text: at ?? v2.add(vertex, v2.scale(v2.norm(v2.add(ua, ub)), radius)),
      }
    }
  }
}

function pickedEntity(sketch: Sketch2D, target: SketchTarget) {
  return target.kind === 'entity' ? sketch.entities.find((e) => e.id === target.id) : undefined
}

export function dimensionCandidate(
  sketch: Sketch2D,
  picks: readonly SketchTarget[],
  cursor: Vec2,
): NewDimension | null {
  const pts = pointLookup(sketch)
  const at: [number, number] = [cursor[0], cursor[1]]
  const pairOf = (a: Vec2, b: Vec2, ida: string, idb: string): NewDimension => {
    const minX = Math.min(a[0], b[0])
    const maxX = Math.max(a[0], b[0])
    const minY = Math.min(a[1], b[1])
    const maxY = Math.max(a[1], b[1])
    const u = v2.norm(v2.sub(b, a))
    const along = v2.dot(v2.sub(cursor, a), u)
    const within = along >= 0 && along <= v2.dist(a, b)
    const axisAligned = Math.abs(u[0]) < 1e-9 || Math.abs(u[1]) < 1e-9
    const value = v2.dist(a, b)
    if (within || axisAligned) return { kind: 'distance', a: ida, b: idb, value, at }
    if (cursor[0] >= minX && cursor[0] <= maxX) {
      return { kind: 'distanceX', a: ida, b: idb, value: b[0] - a[0], at }
    }
    if (cursor[1] >= minY && cursor[1] <= maxY) {
      return { kind: 'distanceY', a: ida, b: idb, value: b[1] - a[1], at }
    }
    return { kind: 'distance', a: ida, b: idb, value, at }
  }

  if (picks.length === 1) {
    const e = pickedEntity(sketch, picks[0])
    if (!e) return null
    if (e.kind === 'line') return pairOf(pts.get(e.p1)!, pts.get(e.p2)!, e.p1, e.p2)
    if (e.kind === 'circle') return { kind: 'diameter', e: e.id, value: Math.abs(e.r) * 2, at }
    if (e.kind === 'arc') return { kind: 'radius', e: e.id, value: radiusOf(e, pts), at }
    if (e.kind === 'ellipse' || e.kind === 'ellipticalArc') {
      const centre = pts.get(e.c)!
      const angle = (e.rotation * Math.PI) / 180
      const d = v2.sub(cursor, centre)
      const major =
        Math.abs(d[0] * Math.cos(angle) + d[1] * Math.sin(angle)) >=
        Math.abs(-d[0] * Math.sin(angle) + d[1] * Math.cos(angle))
      return {
        kind: 'diameter',
        e: e.id,
        axis: major ? 'major' : 'minor',
        value: (major ? e.rx : e.ry) * 2,
        at,
      }
    }
    return null
  }
  if (picks.length !== 2) return null
  const [first, second] = picks
  const centreOf = (target: SketchTarget): string | null => {
    if (target.kind === 'point') return target.id
    const e = pickedEntity(sketch, target)
    return e && (e.kind === 'circle' || e.kind === 'arc' || e.kind === 'ellipse') ? e.c : null
  }
  const ea = pickedEntity(sketch, first)
  const eb = pickedEntity(sketch, second)
  if (ea?.kind === 'line' && eb?.kind === 'line') {
    const da = v2.sub(pts.get(ea.p2)!, pts.get(ea.p1)!)
    const db = v2.sub(pts.get(eb.p2)!, pts.get(eb.p1)!)
    const cross = v2.cross(v2.norm(da), v2.norm(db))
    if (Math.abs(cross) < 1e-6) {
      const p = pts.get(eb.p1)!
      const a1 = pts.get(ea.p1)!
      const u = v2.norm(da)
      const distance = Math.abs(v2.cross(u, v2.sub(p, a1)))
      return { kind: 'pointLineDistance', p: eb.p1, e: ea.id, value: distance, at }
    }
    const value = (Math.atan2(v2.cross(da, db), v2.dot(da, db)) * 180) / Math.PI
    return { kind: 'angle', a: ea.id, b: eb.id, value, at }
  }
  const line = ea?.kind === 'line' ? ea : eb?.kind === 'line' ? eb : null
  const other = line === ea ? second : first
  if (line) {
    const pointId = centreOf(other)
    if (!pointId) return null
    const p = pts.get(pointId)!
    const a = pts.get(line.p1)!
    const u = v2.norm(v2.sub(pts.get(line.p2)!, a))
    return {
      kind: 'pointLineDistance',
      p: pointId,
      e: line.id,
      value: Math.abs(v2.cross(u, v2.sub(p, a))),
      at,
    }
  }
  const ida = centreOf(first)
  const idb = centreOf(second)
  if (!ida || !idb || ida === idb) return null
  return pairOf(pts.get(ida)!, pts.get(idb)!, ida, idb)
}
