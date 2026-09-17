import { v2, type Vec2 } from '../core/math'
import {
  bezierSegments,
  evaluateBSpline,
  fitBSpline,
  splineDegree,
  validKnots,
  type BSpline,
} from './bspline'
import { outlineBounds, textPolygons } from './text'
import type {
  ArcEntity,
  EllipseEntity,
  EllipticalArcEntity,
  Sketch2D,
  SketchEntity,
  SplineEntity,
  TextEntity,
} from './types'

export type PointLookup = Map<string, Vec2>

export const TAU = Math.PI * 2
export const DEG = Math.PI / 180

export function pointLookup(sketch: Pick<Sketch2D, 'points'>): PointLookup {
  const pts: PointLookup = new Map()
  for (const p of sketch.points) pts.set(p.id, [p.x, p.y])
  return pts
}

export function entityPointIds(e: SketchEntity): string[] {
  switch (e.kind) {
    case 'line':
      return [e.p1, e.p2]
    case 'circle':
    case 'ellipse':
      return [e.c]
    case 'arc':
    case 'ellipticalArc':
      return [e.c, e.p1, e.p2]
    case 'point':
    case 'text':
      return [e.p]
    case 'spline':
      return [...e.points]
  }
}

export function entityEnds(e: SketchEntity): [string, string] | null {
  switch (e.kind) {
    case 'line':
    case 'arc':
    case 'ellipticalArc':
      return [e.p1, e.p2]
    case 'spline':
      return e.points.length >= 2 ? [e.points[0], e.points[e.points.length - 1]] : null
    default:
      return null
  }
}

export function entityCentre(e: SketchEntity): string | null {
  return e.kind === 'circle' ||
    e.kind === 'arc' ||
    e.kind === 'ellipse' ||
    e.kind === 'ellipticalArc'
    ? e.c
    : null
}

export function isCurveEntity(e: SketchEntity): boolean {
  return e.kind !== 'point' && e.kind !== 'text'
}

export function isClosedEntity(e: SketchEntity): boolean {
  return e.kind === 'circle' || e.kind === 'ellipse'
}

export function isRoundEntity(
  e: SketchEntity,
): e is Extract<SketchEntity, { kind: 'circle' | 'arc' }> {
  return e.kind === 'circle' || e.kind === 'arc'
}

export function isEllipticEntity(e: SketchEntity): e is EllipseEntity | EllipticalArcEntity {
  return e.kind === 'ellipse' || e.kind === 'ellipticalArc'
}

export function normalizeAngle(a: number): number {
  return ((a % TAU) + TAU) % TAU
}

export function signedSweep(start: number, end: number, ccw: boolean): number {
  let sweep = normalizeAngle(ccw ? end - start : start - end)
  if (sweep < 1e-9) sweep = TAU
  return ccw ? sweep : -sweep
}

export function angleInSweep(theta: number, start: number, sweep: number, eps = 1e-9): boolean {
  const offset = sweep >= 0 ? normalizeAngle(theta - start) : normalizeAngle(start - theta)
  return offset <= Math.abs(sweep) + eps || offset >= TAU - eps
}

export interface ArcGeometry {
  centre: Vec2
  radius: number
  start: number
  sweep: number
}

export function arcGeometry(arc: ArcEntity, pts: PointLookup): ArcGeometry {
  const centre = pts.get(arc.c)!
  const p1 = pts.get(arc.p1)!
  const p2 = pts.get(arc.p2)!
  const start = Math.atan2(p1[1] - centre[1], p1[0] - centre[0])
  const end = Math.atan2(p2[1] - centre[1], p2[0] - centre[0])
  return { centre, radius: v2.dist(centre, p1), start, sweep: signedSweep(start, end, arc.ccw) }
}

export function roundGeometry(
  e: Extract<SketchEntity, { kind: 'circle' | 'arc' }>,
  pts: PointLookup,
): ArcGeometry {
  if (e.kind === 'arc') return arcGeometry(e, pts)
  return { centre: pts.get(e.c)!, radius: Math.abs(e.r), start: 0, sweep: TAU }
}

export interface EllipseGeometry {
  centre: Vec2
  rx: number
  ry: number
  rotation: number
  start: number
  sweep: number
}

export function ellipsePoint(g: EllipseGeometry, theta: number): Vec2 {
  const c = Math.cos(g.rotation)
  const s = Math.sin(g.rotation)
  const x = g.rx * Math.cos(theta)
  const y = g.ry * Math.sin(theta)
  return [g.centre[0] + c * x - s * y, g.centre[1] + s * x + c * y]
}

export function ellipseParamOf(g: Omit<EllipseGeometry, 'start' | 'sweep'>, p: Vec2): number {
  const c = Math.cos(g.rotation)
  const s = Math.sin(g.rotation)
  const dx = p[0] - g.centre[0]
  const dy = p[1] - g.centre[1]
  const lx = c * dx + s * dy
  const ly = -s * dx + c * dy
  return Math.atan2(ly / (g.ry || 1e-12), lx / (g.rx || 1e-12))
}

export function ellipseGeometry(
  e: EllipseEntity | EllipticalArcEntity,
  pts: PointLookup,
): EllipseGeometry {
  const base = {
    centre: pts.get(e.c)!,
    rx: Math.abs(e.rx),
    ry: Math.abs(e.ry),
    rotation: e.rotation * DEG,
  }
  if (e.kind === 'ellipse') return { ...base, start: 0, sweep: TAU }
  const start = ellipseParamOf(base, pts.get(e.p1)!)
  const end = ellipseParamOf(base, pts.get(e.p2)!)
  return { ...base, start, sweep: signedSweep(start, end, e.ccw) }
}

export function splineGeometry(e: SplineEntity, pts: PointLookup): BSpline {
  const positions = e.points.map((id) => pts.get(id) ?? ([0, 0] as Vec2))
  if (e.mode === 'fit') return fitBSpline(positions, e.startHandle, e.endHandle)
  if (positions.length < 2) {
    const only = positions[0] ?? [0, 0]
    return { ctrl: [only, only], knots: [0, 0, 1, 1], degree: 1 }
  }
  const knots = validKnots(e.knots, positions.length)
  return { ctrl: positions, knots, degree: splineDegree(positions.length, knots) }
}

export interface Curve {
  closed: boolean
  at(s: number): Vec2
  d1(s: number): Vec2
  d2(s: number): Vec2
  breaks: number[]
}

function circleCurve(
  centre: Vec2,
  radius: number,
  start: number,
  sweep: number,
  closed: boolean,
): Curve {
  return {
    closed,
    at: (s) => {
      const t = start + sweep * s
      return [centre[0] + radius * Math.cos(t), centre[1] + radius * Math.sin(t)]
    },
    d1: (s) => {
      const t = start + sweep * s
      return [-radius * sweep * Math.sin(t), radius * sweep * Math.cos(t)]
    },
    d2: (s) => {
      const t = start + sweep * s
      const k = -radius * sweep * sweep
      return [k * Math.cos(t), k * Math.sin(t)]
    },
    breaks: [0.25, 0.5, 0.75],
  }
}

function ellipseCurve(g: EllipseGeometry, closed: boolean): Curve {
  const cr = Math.cos(g.rotation)
  const sr = Math.sin(g.rotation)
  const map = (x: number, y: number): Vec2 => [cr * x - sr * y, sr * x + cr * y]
  return {
    closed,
    at: (s) => ellipsePoint(g, g.start + g.sweep * s),
    d1: (s) => {
      const t = g.start + g.sweep * s
      return map(-g.rx * Math.sin(t) * g.sweep, g.ry * Math.cos(t) * g.sweep)
    },
    d2: (s) => {
      const t = g.start + g.sweep * s
      const k = g.sweep * g.sweep
      return map(-g.rx * Math.cos(t) * k, -g.ry * Math.sin(t) * k)
    },
    breaks: [0.125, 0.25, 0.375, 0.5, 0.625, 0.75, 0.875],
  }
}

export function bsplineCurve(spline: BSpline): Curve {
  const lo = spline.knots[spline.degree]
  const hi = spline.knots[spline.ctrl.length]
  const span = hi - lo || 1
  const u = (s: number) => lo + span * s
  return {
    closed: false,
    at: (s) => evaluateBSpline(spline, u(s), 0)[0],
    d1: (s) => v2.scale(evaluateBSpline(spline, u(s), 1)[1], span),
    d2: (s) => v2.scale(evaluateBSpline(spline, u(s), 2)[2], span * span),
    breaks: [...new Set(spline.knots.filter((k) => k > lo && k < hi))].map((k) => (k - lo) / span),
  }
}

export function curveOf(e: SketchEntity, pts: PointLookup): Curve | null {
  switch (e.kind) {
    case 'line': {
      const a = pts.get(e.p1)!
      const d = v2.sub(pts.get(e.p2)!, a)
      return {
        closed: false,
        at: (s) => [a[0] + d[0] * s, a[1] + d[1] * s],
        d1: () => d,
        d2: () => [0, 0],
        breaks: [],
      }
    }
    case 'circle':
      return circleCurve(pts.get(e.c)!, Math.abs(e.r), 0, TAU, true)
    case 'arc': {
      const g = arcGeometry(e, pts)
      return circleCurve(g.centre, g.radius, g.start, g.sweep, false)
    }
    case 'ellipse':
    case 'ellipticalArc':
      return ellipseCurve(ellipseGeometry(e, pts), e.kind === 'ellipse')
    case 'spline':
      return bsplineCurve(splineGeometry(e, pts))
    default:
      return null
  }
}

export function textWidth(e: TextEntity): number {
  if (e.outline) return Math.max(e.outline.width, 0.1) * e.height
  return Math.max(1, e.text.length) * e.height * 0.6
}

export function textCorners(e: TextEntity, pts: PointLookup): Vec2[] {
  const p = pts.get(e.p)!
  const a = e.angle * DEG
  const u: Vec2 = [Math.cos(a), Math.sin(a)]
  const v: Vec2 = [-Math.sin(a), Math.cos(a)]
  const bounds = e.outline ? outlineBounds(e.outline) : null
  const x0 = bounds ? Math.min(0, bounds.min[0]) * e.height : 0
  const x1 = bounds ? Math.max(textWidth(e), bounds.max[0] * e.height) : textWidth(e)
  const y0 = bounds ? Math.min(0, bounds.min[1]) * e.height : 0
  const y1 = bounds ? Math.max(1, bounds.max[1]) * e.height : e.height
  const at = (x: number, y: number): Vec2 => [
    p[0] + u[0] * x + v[0] * y,
    p[1] + u[1] * x + v[1] * y,
  ]
  return [at(x0, y0), at(x1, y0), at(x1, y1), at(x0, y1)]
}

export function entityPolylines(e: SketchEntity, pts: PointLookup, tolerance: number): Vec2[][] {
  if (e.kind === 'text' && e.outline?.contours.length) {
    const origin = pts.get(e.p)
    if (origin) {
      return textPolygons(e, origin, 12).map((polygon) => [...polygon, polygon[0]])
    }
  }
  return [tessellate(e, pts, tolerance)]
}

function segmentProjection(p: Vec2, a: Vec2, b: Vec2): { t: number; d: number } {
  const ab = v2.sub(b, a)
  const len2 = v2.dot(ab, ab)
  if (len2 < 1e-24) return { t: 0, d: v2.dist(p, a) }
  const t = Math.max(0, Math.min(1, v2.dot(v2.sub(p, a), ab) / len2))
  return { t, d: v2.dist(p, [a[0] + ab[0] * t, a[1] + ab[1] * t]) }
}

export interface ParamSamples {
  s: number[]
  p: Vec2[]
}

export function sampleCurve(curve: Curve, tolerance: number, s0 = 0, s1 = 1): ParamSamples {
  const tol = Math.max(tolerance, 1e-9)
  const edges = [s0, ...curve.breaks.filter((b) => b > s0 + 1e-12 && b < s1 - 1e-12), s1]
  const s: number[] = [s0]
  const p: Vec2[] = [curve.at(s0)]
  const refine = (ta: number, tb: number, pa: Vec2, pb: Vec2, depth: number) => {
    const tm = (ta + tb) / 2
    const pm = curve.at(tm)
    const q1 = curve.at(ta + (tb - ta) / 4)
    const q3 = curve.at(ta + ((tb - ta) * 3) / 4)
    const dev = Math.max(
      segmentProjection(pm, pa, pb).d,
      segmentProjection(q1, pa, pb).d,
      segmentProjection(q3, pa, pb).d,
    )
    if (dev > tol && depth < 18) {
      refine(ta, tm, pa, pm, depth + 1)
      refine(tm, tb, pm, pb, depth + 1)
    } else {
      s.push(tb)
      p.push(pb)
    }
  }
  for (let i = 0; i + 1 < edges.length; i++) {
    const a = edges[i]
    const b = edges[i + 1]
    const mid = (a + b) / 2
    const pa = p[p.length - 1]
    const pm = curve.at(mid)
    refine(a, mid, pa, pm, 0)
    refine(mid, b, pm, curve.at(b), 0)
  }
  return { s, p }
}

export function tessellate(e: SketchEntity, pts: PointLookup, tolerance: number): Vec2[] {
  const tol = Math.max(tolerance, 1e-9)
  switch (e.kind) {
    case 'point':
      return [pts.get(e.p)!]
    case 'text': {
      const corners = textCorners(e, pts)
      return [...corners, corners[0]]
    }
    case 'line':
      return [pts.get(e.p1)!, pts.get(e.p2)!]
    case 'circle':
    case 'arc': {
      const g = roundGeometry(e, pts)
      const r = Math.abs(g.radius)
      const step = r <= tol ? Math.PI / 2 : 2 * Math.acos(Math.max(-1, Math.min(1, 1 - tol / r)))
      const count = Math.min(
        65536,
        Math.max(e.kind === 'circle' ? 8 : 2, Math.ceil(Math.abs(g.sweep) / Math.max(step, 1e-9))),
      )
      const out: Vec2[] = []
      for (let i = 0; i <= count; i++) {
        const t = g.start + (g.sweep * i) / count
        out.push([g.centre[0] + r * Math.cos(t), g.centre[1] + r * Math.sin(t)])
      }
      return out
    }
    default:
      return sampleCurve(curveOf(e, pts)!, tol).p
  }
}

export interface Bounds {
  min: Vec2
  max: Vec2
}

export function boundsOfPoints(points: Vec2[]): Bounds {
  const min: Vec2 = [Infinity, Infinity]
  const max: Vec2 = [-Infinity, -Infinity]
  for (const p of points) {
    min[0] = Math.min(min[0], p[0])
    min[1] = Math.min(min[1], p[1])
    max[0] = Math.max(max[0], p[0])
    max[1] = Math.max(max[1], p[1])
  }
  return { min, max }
}

export function bezierPoint(seg: [Vec2, Vec2, Vec2, Vec2], t: number): Vec2 {
  const u = 1 - t
  const a = u * u * u
  const b = 3 * u * u * t
  const c = 3 * u * t * t
  const d = t * t * t
  return [
    a * seg[0][0] + b * seg[1][0] + c * seg[2][0] + d * seg[3][0],
    a * seg[0][1] + b * seg[1][1] + c * seg[2][1] + d * seg[3][1],
  ]
}

function bezierExtremes(seg: [Vec2, Vec2, Vec2, Vec2]): number[] {
  const out: number[] = []
  for (const axis of [0, 1]) {
    const [p0, p1, p2, p3] = seg.map((p) => p[axis])
    const a = -p0 + 3 * p1 - 3 * p2 + p3
    const b = 2 * (p0 - 2 * p1 + p2)
    const c = p1 - p0
    if (Math.abs(a) < 1e-12) {
      if (Math.abs(b) > 1e-12) out.push(-c / b)
      continue
    }
    const disc = b * b - 4 * a * c
    if (disc < 0) continue
    const root = Math.sqrt(disc)
    out.push((-b + root) / (2 * a), (-b - root) / (2 * a))
  }
  return out.filter((t) => t > 0 && t < 1)
}

export function ellipseExtremeParams(g: EllipseGeometry): number[] {
  const cr = Math.cos(g.rotation)
  const sr = Math.sin(g.rotation)
  const tx = Math.atan2(-g.ry * sr, g.rx * cr)
  const ty = Math.atan2(g.ry * cr, g.rx * sr)
  return [tx, tx + Math.PI, ty, ty + Math.PI]
}

export function entityBounds(e: SketchEntity, pts: PointLookup): Bounds {
  switch (e.kind) {
    case 'point':
      return boundsOfPoints([pts.get(e.p)!])
    case 'text':
      return boundsOfPoints(textCorners(e, pts))
    case 'line':
      return boundsOfPoints([pts.get(e.p1)!, pts.get(e.p2)!])
    case 'circle':
    case 'arc': {
      const g = roundGeometry(e, pts)
      const at = (t: number): Vec2 => [
        g.centre[0] + g.radius * Math.cos(t),
        g.centre[1] + g.radius * Math.sin(t),
      ]
      const list: Vec2[] = [at(g.start), at(g.start + g.sweep)]
      for (let k = 0; k < 4; k++) {
        const t = (k * Math.PI) / 2
        if (angleInSweep(t, g.start, g.sweep, 0)) list.push(at(t))
      }
      return boundsOfPoints(list)
    }
    case 'ellipse':
    case 'ellipticalArc': {
      const g = ellipseGeometry(e, pts)
      const list: Vec2[] = [ellipsePoint(g, g.start), ellipsePoint(g, g.start + g.sweep)]
      for (const t of ellipseExtremeParams(g)) {
        if (e.kind === 'ellipse' || angleInSweep(t, g.start, g.sweep, 0)) {
          list.push(ellipsePoint(g, t))
        }
      }
      return boundsOfPoints(list)
    }
    case 'spline': {
      const list: Vec2[] = []
      for (const seg of bezierSegments(splineGeometry(e, pts))) {
        list.push(seg[0], seg[3])
        for (const t of bezierExtremes(seg)) list.push(bezierPoint(seg, t))
      }
      return boundsOfPoints(list)
    }
  }
}

export function unionBounds(list: Bounds[]): Bounds | null {
  if (!list.length) return null
  return boundsOfPoints(list.flatMap((b) => [b.min, b.max]))
}

export function sketchBounds(sketch: Sketch2D, ids?: string[]): Bounds | null {
  const pts = pointLookup(sketch)
  const chosen = ids ? sketch.entities.filter((e) => ids.includes(e.id)) : sketch.entities
  return unionBounds(chosen.map((e) => entityBounds(e, pts)))
}

function scaleOf(b: Bounds): number {
  return Math.max(Math.hypot(b.max[0] - b.min[0], b.max[1] - b.min[1]), 1e-6)
}

export interface Closest {
  point: Vec2
  s: number
  distance: number
}

export function closestOnCurve(curve: Curve, q: Vec2, scale: number): Closest {
  const samples = sampleCurve(curve, Math.max(scale * 2e-3, 1e-7))
  let bestS = 0
  let bestD = Infinity
  for (let i = 0; i + 1 < samples.p.length; i++) {
    const { t, d } = segmentProjection(q, samples.p[i], samples.p[i + 1])
    if (d < bestD) {
      bestD = d
      bestS = samples.s[i] + (samples.s[i + 1] - samples.s[i]) * t
    }
  }
  if (samples.p.length === 1) bestD = v2.dist(samples.p[0], q)
  let s = bestS
  for (let iter = 0; iter < 40; iter++) {
    const c = curve.at(s)
    const d1 = curve.d1(s)
    const d2 = curve.d2(s)
    const w = v2.sub(c, q)
    const f = v2.dot(w, d1)
    const fp = v2.dot(d1, d1) + v2.dot(w, d2)
    if (Math.abs(fp) < 1e-30) break
    let next = s - f / fp
    if (curve.closed) next = ((next % 1) + 1) % 1
    else next = Math.max(0, Math.min(1, next))
    const done = Math.abs(next - s) < 1e-14
    s = next
    if (done) break
  }
  const point = curve.at(s)
  const distance = v2.dist(point, q)
  if (distance <= bestD + 1e-12) return { point, s, distance }
  return { point: curve.at(bestS), s: bestS, distance: v2.dist(curve.at(bestS), q) }
}

function pointInPolygon(pt: Vec2, poly: Vec2[]): boolean {
  let inside = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const yi = poly[i][1]
    const yj = poly[j][1]
    if (yi > pt[1] !== yj > pt[1]) {
      const x = ((poly[j][0] - poly[i][0]) * (pt[1] - yi)) / (yj - yi) + poly[i][0]
      if (pt[0] < x) inside = !inside
    }
  }
  return inside
}

export function roundParamOf(g: ArcGeometry, p: Vec2, closed: boolean): number | null {
  const theta = Math.atan2(p[1] - g.centre[1], p[0] - g.centre[0])
  if (closed) return normalizeAngle(theta) / TAU
  const offset = g.sweep >= 0 ? normalizeAngle(theta - g.start) : normalizeAngle(g.start - theta)
  const span = Math.abs(g.sweep)
  if (offset <= span + 1e-9) return Math.min(1, offset / span)
  if (offset >= TAU - 1e-9) return 0
  return null
}

export function closestPoint(e: SketchEntity, pts: PointLookup, q: Vec2): Closest {
  switch (e.kind) {
    case 'point': {
      const p = pts.get(e.p)!
      return { point: p, s: 0, distance: v2.dist(p, q) }
    }
    case 'text': {
      const corners = textCorners(e, pts)
      if (pointInPolygon(q, corners)) return { point: q, s: 0, distance: 0 }
      let best: Closest = { point: corners[0], s: 0, distance: Infinity }
      for (let i = 0; i < 4; i++) {
        const a = corners[i]
        const b = corners[(i + 1) % 4]
        const { t, d } = segmentProjection(q, a, b)
        if (d < best.distance) {
          best = { point: [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t], s: 0, distance: d }
        }
      }
      return best
    }
    case 'line': {
      const a = pts.get(e.p1)!
      const b = pts.get(e.p2)!
      const { t, d } = segmentProjection(q, a, b)
      return { point: [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t], s: t, distance: d }
    }
    case 'circle':
    case 'arc': {
      const g = roundGeometry(e, pts)
      const dir = v2.sub(q, g.centre)
      const theta = v2.len(dir) < 1e-12 ? g.start : Math.atan2(dir[1], dir[0])
      const onCircle: Vec2 = [
        g.centre[0] + g.radius * Math.cos(theta),
        g.centre[1] + g.radius * Math.sin(theta),
      ]
      const s = roundParamOf(g, onCircle, e.kind === 'circle')
      if (s !== null) return { point: onCircle, s, distance: v2.dist(onCircle, q) }
      const a = pts.get((e as ArcEntity).p1)!
      const b = pts.get((e as ArcEntity).p2)!
      return v2.dist(a, q) <= v2.dist(b, q)
        ? { point: a, s: 0, distance: v2.dist(a, q) }
        : { point: b, s: 1, distance: v2.dist(b, q) }
    }
    default:
      return closestOnCurve(curveOf(e, pts)!, q, scaleOf(entityBounds(e, pts)))
  }
}

export function distanceToEntity(e: SketchEntity, pts: PointLookup, q: Vec2): number {
  return closestPoint(e, pts, q).distance
}

export function pointAt(e: SketchEntity, pts: PointLookup, s: number): Vec2 {
  const curve = curveOf(e, pts)
  if (curve) return curve.at(s)
  return pts.get((e as { p: string }).p)!
}

export function tangentAt(e: SketchEntity, pts: PointLookup, s: number): Vec2 {
  const curve = curveOf(e, pts)
  return curve ? v2.norm(curve.d1(s)) : [1, 0]
}

export interface Crossing {
  point: Vec2
  sa: number
  sb: number
}

function lineLine(a: Vec2, b: Vec2, c: Vec2, d: Vec2): Crossing[] {
  const r = v2.sub(b, a)
  const f = v2.sub(d, c)
  const den = v2.cross(r, f)
  if (Math.abs(den) < 1e-12 * Math.max(1, v2.dot(r, r), v2.dot(f, f))) return []
  const t = v2.cross(v2.sub(c, a), f) / den
  const u = v2.cross(v2.sub(c, a), r) / den
  const eps = 1e-9
  if (t < -eps || t > 1 + eps || u < -eps || u > 1 + eps) return []
  return [
    {
      point: [a[0] + r[0] * t, a[1] + r[1] * t],
      sa: Math.max(0, Math.min(1, t)),
      sb: Math.max(0, Math.min(1, u)),
    },
  ]
}

function lineRound(a: Vec2, b: Vec2, g: ArcGeometry, closed: boolean): Crossing[] {
  const d = v2.sub(b, a)
  const m = v2.sub(a, g.centre)
  const qa = v2.dot(d, d)
  if (qa < 1e-24) return []
  const qb = 2 * v2.dot(m, d)
  const qc = v2.dot(m, m) - g.radius * g.radius
  let disc = qb * qb - 4 * qa * qc
  if (disc < 0) {
    if (disc > -1e-9 * Math.max(1, qb * qb)) disc = 0
    else return []
  }
  const root = Math.sqrt(disc)
  const roots = root === 0 ? [-qb / (2 * qa)] : [(-qb - root) / (2 * qa), (-qb + root) / (2 * qa)]
  const out: Crossing[] = []
  for (const t of roots) {
    if (t < -1e-9 || t > 1 + 1e-9) continue
    const point: Vec2 = [a[0] + d[0] * t, a[1] + d[1] * t]
    const s = roundParamOf(g, point, closed)
    if (s === null) continue
    out.push({ point, sa: Math.max(0, Math.min(1, t)), sb: s })
  }
  return out
}

function roundRound(ga: ArcGeometry, ca: boolean, gb: ArcGeometry, cb: boolean): Crossing[] {
  const d = v2.dist(ga.centre, gb.centre)
  if (d < 1e-12) return []
  const eps = 1e-9 * Math.max(1, ga.radius, gb.radius)
  if (d > ga.radius + gb.radius + eps || d < Math.abs(ga.radius - gb.radius) - eps) return []
  const x = (d * d - gb.radius * gb.radius + ga.radius * ga.radius) / (2 * d)
  const h = Math.sqrt(Math.max(0, ga.radius * ga.radius - x * x))
  const u = v2.scale(v2.sub(gb.centre, ga.centre), 1 / d)
  const mid = v2.add(ga.centre, v2.scale(u, x))
  const n: Vec2 = [-u[1], u[0]]
  const candidates = h < 1e-9 ? [mid] : [v2.add(mid, v2.scale(n, h)), v2.sub(mid, v2.scale(n, h))]
  const out: Crossing[] = []
  for (const point of candidates) {
    const sa = roundParamOf(ga, point, ca)
    const sb = roundParamOf(gb, point, cb)
    if (sa === null || sb === null) continue
    out.push({ point, sa, sb })
  }
  return out
}

function refineCrossing(
  ca: Curve,
  cb: Curve,
  sa0: number,
  sb0: number,
  scale: number,
): { sa: number; sb: number; error: number } {
  let sa = sa0
  let sb = sb0
  let error = Infinity
  for (let iter = 0; iter < 40; iter++) {
    const f = v2.sub(ca.at(sa), cb.at(sb))
    error = v2.len(f)
    if (error < 1e-12 * Math.max(1, scale)) break
    const da = ca.d1(sa)
    const db = cb.d1(sb)
    const det = -da[0] * db[1] + db[0] * da[1]
    if (Math.abs(det) < 1e-24) break
    const stepA = (-f[0] * -db[1] - -db[0] * -f[1]) / det
    const stepB = (da[0] * -f[1] - da[1] * -f[0]) / det
    sa += stepA
    sb += stepB
    if (ca.closed) sa = ((sa % 1) + 1) % 1
    else sa = Math.max(-0.05, Math.min(1.05, sa))
    if (cb.closed) sb = ((sb % 1) + 1) % 1
    else sb = Math.max(-0.05, Math.min(1.05, sb))
  }
  error = v2.len(v2.sub(ca.at(sa), cb.at(sb)))
  return { sa, sb, error }
}

export function intersectCurves(ca: Curve, cb: Curve, scale: number): Crossing[] {
  const tol = Math.max(scale * 1e-3, 1e-7)
  const A = sampleCurve(ca, tol)
  const B = sampleCurve(cb, tol)
  const out: Crossing[] = []
  const margin = tol * 2
  for (let i = 0; i + 1 < A.p.length; i++) {
    const a0 = A.p[i]
    const a1 = A.p[i + 1]
    const minAx = Math.min(a0[0], a1[0]) - margin
    const maxAx = Math.max(a0[0], a1[0]) + margin
    const minAy = Math.min(a0[1], a1[1]) - margin
    const maxAy = Math.max(a0[1], a1[1]) + margin
    for (let j = 0; j + 1 < B.p.length; j++) {
      const b0 = B.p[j]
      const b1 = B.p[j + 1]
      if (Math.max(b0[0], b1[0]) < minAx || Math.min(b0[0], b1[0]) > maxAx) continue
      if (Math.max(b0[1], b1[1]) < minAy || Math.min(b0[1], b1[1]) > maxAy) continue
      const hit = lineLine(a0, a1, b0, b1)
      if (!hit.length) continue
      const sa0 = A.s[i] + (A.s[i + 1] - A.s[i]) * hit[0].sa
      const sb0 = B.s[j] + (B.s[j + 1] - B.s[j]) * hit[0].sb
      const refined = refineCrossing(ca, cb, sa0, sb0, scale)
      let { sa, sb } = refined
      if (refined.error > 1e-7 * Math.max(1, scale)) {
        if (v2.dist(ca.at(sa0), cb.at(sb0)) > tol * 4) continue
        sa = sa0
        sb = sb0
      }
      if (!ca.closed && (sa < -1e-9 || sa > 1 + 1e-9)) continue
      if (!cb.closed && (sb < -1e-9 || sb > 1 + 1e-9)) continue
      sa = ca.closed ? sa : Math.max(0, Math.min(1, sa))
      sb = cb.closed ? sb : Math.max(0, Math.min(1, sb))
      const point = ca.at(sa)
      if (out.some((c) => v2.dist(c.point, point) < 1e-6 * Math.max(1, scale))) continue
      out.push({ point, sa, sb })
    }
  }
  return out.sort((x, y) => x.sa - y.sa)
}

export function intersectEntities(a: SketchEntity, b: SketchEntity, pts: PointLookup): Crossing[] {
  if (a.id === b.id || !isCurveEntity(a) || !isCurveEntity(b)) return []
  if (a.kind === 'line' && b.kind === 'line') {
    return lineLine(pts.get(a.p1)!, pts.get(a.p2)!, pts.get(b.p1)!, pts.get(b.p2)!)
  }
  if (a.kind === 'line' && isRoundEntity(b)) {
    return lineRound(pts.get(a.p1)!, pts.get(a.p2)!, roundGeometry(b, pts), b.kind === 'circle')
  }
  if (isRoundEntity(a) && b.kind === 'line') {
    return lineRound(pts.get(b.p1)!, pts.get(b.p2)!, roundGeometry(a, pts), a.kind === 'circle')
      .map((c) => ({ point: c.point, sa: c.sb, sb: c.sa }))
      .sort((x, y) => x.sa - y.sa)
  }
  if (isRoundEntity(a) && isRoundEntity(b)) {
    return roundRound(
      roundGeometry(a, pts),
      a.kind === 'circle',
      roundGeometry(b, pts),
      b.kind === 'circle',
    ).sort((x, y) => x.sa - y.sa)
  }
  const scale = scaleOf(unionBounds([entityBounds(a, pts), entityBounds(b, pts)])!)
  return intersectCurves(curveOf(a, pts)!, curveOf(b, pts)!, scale)
}

const GAUSS_X = [-0.906179845938664, -0.5384693101056831, 0, 0.5384693101056831, 0.906179845938664]
const GAUSS_W = [
  0.23692688505618908, 0.47862867049936647, 0.5688888888888889, 0.47862867049936647,
  0.23692688505618908,
]

export function curveLength(curve: Curve, s0 = 0, s1 = 1): number {
  const edges = [s0, ...curve.breaks.filter((b) => b > s0 && b < s1), s1]
  let total = 0
  for (let i = 0; i + 1 < edges.length; i++) {
    const pieces = 16
    for (let k = 0; k < pieces; k++) {
      const a = edges[i] + ((edges[i + 1] - edges[i]) * k) / pieces
      const b = edges[i] + ((edges[i + 1] - edges[i]) * (k + 1)) / pieces
      const half = (b - a) / 2
      const mid = (a + b) / 2
      for (let g = 0; g < 5; g++)
        total += GAUSS_W[g] * half * v2.len(curve.d1(mid + half * GAUSS_X[g]))
    }
  }
  return total
}

export function entityLength(e: SketchEntity, pts: PointLookup): number {
  if (e.kind === 'line') return v2.dist(pts.get(e.p1)!, pts.get(e.p2)!)
  if (e.kind === 'circle') return TAU * Math.abs(e.r)
  if (e.kind === 'arc') {
    const g = arcGeometry(e, pts)
    return Math.abs(g.sweep) * g.radius
  }
  const curve = curveOf(e, pts)
  return curve ? curveLength(curve) : 0
}
