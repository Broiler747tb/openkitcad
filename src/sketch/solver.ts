/**
 * The 2D constraint solver.
 *
 * A Levenberg-Marquardt least-squares solver over analytic Jacobians. Sketches
 * in a tinkerer's project are small - tens of entities - so a dense solve is
 * both fast enough (sub-millisecond) and far easier to reason about than a
 * sparse decomposition.
 *
 * Two deliberate simplifications:
 *
 * 1. Several constraints (parallel, perpendicular, tangent, point-on-line,
 *    angle) are normalised by a length scale that is *frozen* at the start of
 *    each iteration rather than differentiated. This is a Gauss-Newton style
 *    approximation: the gradient is slightly wrong mid-iteration, but the root
 *    is unchanged because the residual is zero there regardless of scale. It
 *    buys well-conditioned residuals - a parallel constraint on 200 mm lines
 *    would otherwise outweigh a 5 mm dimension by four orders of magnitude.
 *
 * 2. Degrees of freedom are counted by numerically ranking the Jacobian. This
 *    is what lets the UI say "this shape can still move" in plain English.
 */
import { v2, type Vec2 } from '../core/math'
import {
  basisDerivatives,
  chordParameters,
  clampedKnots,
  endHandleOf,
  evaluateBSpline,
  findSpan,
  fitSystem,
  handleSecondDerivative,
  splineDegree,
  validKnots,
} from './bspline'
import {
  DEG,
  TAU,
  bsplineCurve,
  closestOnCurve,
  curveOf,
  ellipseGeometry,
  ellipseParamOf,
  ellipsePoint,
  entityBounds,
  pointLookup,
  splineGeometry,
  type PointLookup,
} from './curves'
import type {
  Constraint,
  LineEntity,
  PointId,
  Sketch2D,
  SketchEntity,
  SplineEnd,
  SplineEntity,
  SplineHandle,
} from './types'

export interface DragTarget {
  point: PointId
  x: number
  y: number
}

export interface SolveOptions {
  maxIterations?: number
  /** Residual norm below which we call it solved. */
  tolerance?: number
  /** When set, pulls one point toward the cursor and minimises other motion. */
  drag?: DragTarget
  settle?: number
}

export interface SolveResult {
  ok: boolean
  /** Updated positions, keyed by point id. */
  points: Record<PointId, { x: number; y: number }>
  /** Updated radii for circle entities, keyed by entity id. */
  radii: Record<string, number>
  iterations: number
  /** Root-mean-square residual at exit. */
  residual: number
  /** How many ways the sketch can still move. Zero means fully defined. */
  dof: number
  /** Constraint ids that could not be satisfied, for highlighting in red. */
  failing: string[]
  /** Points that are still free to move, so the UI can colour them. */
  freePoints: string[]
  /** Circles whose radius is still free. */
  freeRadii: string[]
  ellipses: Record<string, { rx: number; ry: number; rotation: number }>
  handles: Record<string, { start?: SplineHandle; end?: SplineHandle }>
  freeEntities: string[]
}

/**
 * How hard the dragged point is pulled, relative to a real constraint.
 *
 * This must be *weak*. In a least-squares system every term negotiates with
 * every other, so a strong drag term does not merely lose an argument with a
 * pinned point - it drags it. A weak term instead has no competition at all in
 * directions the constraints leave free (so the point tracks the cursor
 * exactly there) while being overruled to within ~1e-5 mm in directions the
 * constraints own.
 */
const DRAG_WEIGHT = 0.003
/**
 * Gentle pull of every variable toward where it already was, applied only
 * while dragging. Stops unrelated geometry drifting across an under-defined
 * sketch as the user moves one corner. Must be far weaker than DRAG_WEIGHT or
 * it fights the cursor in the very directions the drag is supposed to own.
 */
const REGULARISATION = 3e-6
const SETTLE_WEIGHT = 0.03
const PLACE_RATIO = 0.01

interface VarIndex {
  /** pointId -> index of its x variable (y is the next one). */
  point: Map<PointId, number>
  /** circle entityId -> index of its radius variable. */
  radius: Map<string, number>
  ellipse: Map<string, number>
  handle: Map<string, { start?: number; end?: number }>
  hidden: Map<string, number[]>
  count: number
}

type Grad = Array<[number, number]>
type Grad2 = Array<[number, number, number]>

interface Jet {
  v: [Vec2, Vec2, Vec2]
  g: [Grad2, Grad2, Grad2]
}

function isRound(
  e: SketchEntity | undefined,
): e is Extract<SketchEntity, { kind: 'circle' | 'arc' }> {
  return !!e && (e.kind === 'circle' || e.kind === 'arc')
}

function isElliptic(
  e: SketchEntity | undefined,
): e is Extract<SketchEntity, { kind: 'ellipse' | 'ellipticalArc' }> {
  return !!e && (e.kind === 'ellipse' || e.kind === 'ellipticalArc')
}

function usableCurve(e: SketchEntity | undefined, points: Set<string>): e is SketchEntity {
  if (!e || e.kind === 'point' || e.kind === 'text') return false
  if (e.kind === 'spline') return e.points.length >= 2 && e.points.every((id) => points.has(id))
  return true
}

function special(e: SketchEntity | undefined, points: Set<string>): boolean {
  return usableCurve(e, points) && (isElliptic(e) || e.kind === 'spline')
}

function smoothUsesEnd(sketch: Sketch2D, id: string, end: SplineEnd): boolean {
  return sketch.constraints.some(
    (c) =>
      c.kind === 'smooth' && ((c.a === id && c.aEnd === end) || (c.b === id && c.bEnd === end)),
  )
}

function tangentPair(
  c: Constraint,
  entities: Map<string, SketchEntity>,
): [SketchEntity | undefined, SketchEntity | undefined] | null {
  if (c.kind === 'tangent') return [entities.get(c.line), entities.get(c.circle)]
  if (c.kind === 'tangentArcs' || c.kind === 'tangentCurves') {
    return [entities.get(c.a), entities.get(c.b)]
  }
  return null
}

function coincidenceClasses(sketch: Sketch2D): Map<string, string> {
  const parent = new Map<string, string>()
  const find = (id: string): string => {
    let root = id
    while (parent.has(root) && parent.get(root) !== root) root = parent.get(root)!
    return root
  }
  for (const c of sketch.constraints) {
    if (c.kind !== 'coincident') continue
    const a = find(c.a)
    const b = find(c.b)
    if (a !== b) parent.set(a, b)
  }
  const classes = new Map<string, string>()
  for (const p of sketch.points) classes.set(p.id, find(p.id))
  return classes
}

function jointEnd(e: SketchEntity, end: SplineEnd): PointId | null {
  if (e.kind === 'line' || e.kind === 'arc') return end === 'start' ? e.p1 : e.p2
  if (e.kind === 'spline' && e.points.length >= 2) {
    return end === 'start' ? e.points[0] : e.points[e.points.length - 1]
  }
  return null
}

function sharedJoint(
  A: SketchEntity | undefined,
  B: SketchEntity | undefined,
  classes: Map<string, string>,
): [SplineEnd, SplineEnd] | null {
  if (!A || !B || A.id === B.id) return null
  for (const aEnd of ['start', 'end'] as const) {
    const pa = jointEnd(A, aEnd)
    if (!pa) continue
    for (const bEnd of ['start', 'end'] as const) {
      const pb = jointEnd(B, bEnd)
      if (pb && (classes.get(pa) ?? pa) === (classes.get(pb) ?? pb)) return [aEnd, bEnd]
    }
  }
  return null
}

function hiddenCount(
  c: Constraint,
  entities: Map<string, SketchEntity>,
  points: Set<string>,
  classes: Map<string, string>,
): number {
  const pair = tangentPair(c, entities)
  if (pair && sharedJoint(pair[0], pair[1], classes)) return 0
  switch (c.kind) {
    case 'pointOnCurve':
    case 'pointOnCircle':
      return points.has(c.p) && special(entities.get(c.e), points) ? 1 : 0
    case 'tangentCurves': {
      const [A, B] = tangentPair(c, entities)!
      if (!usableCurve(A, points) || !usableCurve(B, points)) return 0
      return A.kind === 'line' && B.kind === 'line' ? 0 : 2
    }
    case 'tangent': {
      const [L, C] = tangentPair(c, entities)!
      return L?.kind === 'line' && special(C, points) ? 2 : 0
    }
    case 'tangentArcs': {
      const [A, B] = tangentPair(c, entities)!
      if (!usableCurve(A, points) || !usableCurve(B, points)) return 0
      if (A.kind === 'line' || B.kind === 'line') return 0
      return special(A, points) || special(B, points) ? 2 : 0
    }
    default:
      return 0
  }
}

function buildVarIndex(sketch: Sketch2D): VarIndex {
  const point = new Map<PointId, number>()
  const radius = new Map<string, number>()
  const ellipse = new Map<string, number>()
  const handle = new Map<string, { start?: number; end?: number }>()
  const hidden = new Map<string, number[]>()
  let n = 0
  for (const p of sketch.points) {
    point.set(p.id, n)
    n += 2
  }
  for (const e of sketch.entities) {
    if (e.kind === 'circle') {
      radius.set(e.id, n)
      n += 1
    }
  }
  for (const e of sketch.entities) {
    if (isElliptic(e)) {
      ellipse.set(e.id, n)
      n += 3
    }
  }
  const points = new Set(sketch.points.map((p) => p.id))
  const entities = new Map(sketch.entities.map((e) => [e.id, e]))
  for (const e of sketch.entities) {
    if (e.kind !== 'spline' || e.mode !== 'fit' || !usableCurve(e, points)) continue
    const start = !!e.startHandle || smoothUsesEnd(sketch, e.id, 'start')
    const end = !!e.endHandle || smoothUsesEnd(sketch, e.id, 'end')
    if (!start && !end) continue
    const entry: { start?: number; end?: number } = {}
    if (start) {
      entry.start = n
      n += 3
    }
    if (end) {
      entry.end = n
      n += 3
    }
    handle.set(e.id, entry)
  }
  for (const e of sketch.entities) {
    if (e.kind === 'ellipticalArc') {
      hidden.set(`earc:${e.id}`, [n, n + 1])
      n += 2
    }
  }
  const classes = coincidenceClasses(sketch)
  for (const c of sketch.constraints) {
    const k = hiddenCount(c, entities, points, classes)
    if (!k) continue
    hidden.set(
      c.id,
      Array.from({ length: k }, (_, i) => n + i),
    )
    n += k
  }
  return { point, radius, ellipse, handle, hidden, count: n }
}

interface RawCurve {
  at(t: number): Vec2
  d1(t: number): Vec2
  closest(q: Vec2): number
  range: [number, number]
}

function rawCurve(e: SketchEntity, pts: PointLookup): RawCurve | null {
  switch (e.kind) {
    case 'line': {
      const a = pts.get(e.p1)!
      const d = v2.sub(pts.get(e.p2)!, a)
      const len2 = v2.dot(d, d)
      return {
        at: (t) => [a[0] + d[0] * t, a[1] + d[1] * t],
        d1: () => d,
        closest: (q) => (len2 < 1e-24 ? 0 : v2.dot(v2.sub(q, a), d) / len2),
        range: [-1, 2],
      }
    }
    case 'circle':
    case 'arc': {
      const c = pts.get(e.c)!
      const r = e.kind === 'circle' ? Math.abs(e.r) : v2.dist(c, pts.get(e.p1)!)
      return {
        at: (t) => [c[0] + r * Math.cos(t), c[1] + r * Math.sin(t)],
        d1: (t) => [-r * Math.sin(t), r * Math.cos(t)],
        closest: (q) => Math.atan2(q[1] - c[1], q[0] - c[0]),
        range: [0, TAU],
      }
    }
    case 'ellipse':
    case 'ellipticalArc': {
      const carrier: SketchEntity = {
        id: e.id,
        kind: 'ellipse',
        c: e.c,
        rx: e.rx,
        ry: e.ry,
        rotation: e.rotation,
        construction: false,
      }
      const g = ellipseGeometry(carrier, pts)
      const curve = curveOf(carrier, pts)!
      const scale = Math.max(g.rx, g.ry, 1e-6) * 2
      const cr = Math.cos(g.rotation)
      const sr = Math.sin(g.rotation)
      return {
        at: (t) => ellipsePoint(g, t),
        d1: (t) => {
          const lx = -g.rx * Math.sin(t)
          const ly = g.ry * Math.cos(t)
          return [cr * lx - sr * ly, sr * lx + cr * ly]
        },
        closest: (q) => closestOnCurve(curve, q, scale).s * TAU,
        range: [0, TAU],
      }
    }
    case 'spline': {
      const spline = splineGeometry(e, pts)
      const lo = spline.knots[spline.degree]
      const hi = spline.knots[spline.ctrl.length]
      const curve = bsplineCurve(spline)
      const bounds = entityBounds(e, pts)
      const scale = Math.max(
        Math.hypot(bounds.max[0] - bounds.min[0], bounds.max[1] - bounds.min[1]),
        1e-6,
      )
      return {
        at: (t) => evaluateBSpline(spline, t)[0],
        d1: (t) => evaluateBSpline(spline, t, 1)[1],
        closest: (q) => lo + (hi - lo) * closestOnCurve(curve, q, scale).s,
        range: [lo, hi],
      }
    }
    default:
      return null
  }
}

function initialTangentParams(
  A: SketchEntity,
  B: SketchEntity,
  pts: PointLookup,
): [number, number] {
  const ra = rawCurve(A, pts)
  const rb = rawCurve(B, pts)
  if (!ra || !rb) return [0, 0]
  const primaryIsA = A.kind !== 'line' || B.kind === 'line'
  const P = primaryIsA ? ra : rb
  const Q = primaryIsA ? rb : ra
  const probe = (t: number) => {
    const pp = P.at(t)
    const tq = Q.closest(pp)
    const dp = v2.norm(P.d1(t))
    const dq = v2.norm(Q.d1(tq))
    return { t, tq, dist: v2.dist(pp, Q.at(tq)), f: v2.cross(dp, dq) }
  }
  const N = 96
  const samples = Array.from({ length: N + 1 }, (_, i) =>
    probe(P.range[0] + ((P.range[1] - P.range[0]) * i) / N),
  )
  let nearest = samples[0]
  for (const s of samples) if (s.dist < nearest.dist) nearest = s
  let candidate: ReturnType<typeof probe> | null = null
  for (let i = 0; i < N; i++) {
    let lo = samples[i]
    let hi = samples[i + 1]
    if (lo.f * hi.f > 0) continue
    for (let k = 0; k < 40; k++) {
      const mid = probe((lo.t + hi.t) / 2)
      if (lo.f * mid.f <= 0) hi = mid
      else lo = mid
    }
    const found = Math.abs(lo.f) < Math.abs(hi.f) ? lo : hi
    if (!candidate || found.dist < candidate.dist) candidate = found
  }
  const chosen = candidate ?? nearest
  return primaryIsA ? [chosen.t, chosen.tq] : [chosen.tq, chosen.t]
}

function packState(sketch: Sketch2D, idx: VarIndex): Float64Array {
  const x = new Float64Array(idx.count)
  for (const p of sketch.points) {
    const i = idx.point.get(p.id)!
    x[i] = p.x
    x[i + 1] = p.y
  }
  for (const e of sketch.entities) {
    if (e.kind === 'circle') x[idx.radius.get(e.id)!] = e.r
  }
  if (idx.ellipse.size === 0 && idx.handle.size === 0 && idx.hidden.size === 0) return x
  const pts = pointLookup(sketch)
  const entities = new Map(sketch.entities.map((e) => [e.id, e]))
  for (const e of sketch.entities) {
    if (!isElliptic(e)) continue
    const i = idx.ellipse.get(e.id)!
    x[i] = e.rx
    x[i + 1] = e.ry
    x[i + 2] = e.rotation * DEG
  }
  for (const [id, entry] of idx.handle) {
    const e = entities.get(id) as SplineEntity
    const needsNatural =
      (entry.start !== undefined && !e.startHandle) || (entry.end !== undefined && !e.endHandle)
    const natural = needsNatural ? splineGeometry(e, pts) : null
    if (entry.start !== undefined) {
      const h = e.startHandle ?? endHandleOf(natural!, 'start')
      x[entry.start] = h.dx
      x[entry.start + 1] = h.dy
      x[entry.start + 2] = h.k
    }
    if (entry.end !== undefined) {
      const h = e.endHandle ?? endHandleOf(natural!, 'end')
      x[entry.end] = h.dx
      x[entry.end + 1] = h.dy
      x[entry.end + 2] = h.k
    }
  }
  const constraints = new Map(sketch.constraints.map((c) => [c.id, c]))
  for (const [key, vars] of idx.hidden) {
    if (key.startsWith('earc:')) {
      const e = entities.get(key.slice(5))
      if (e?.kind !== 'ellipticalArc') continue
      const g = ellipseGeometry(e, pts)
      x[vars[0]] = ellipseParamOf(g, pts.get(e.p1)!)
      x[vars[1]] = ellipseParamOf(g, pts.get(e.p2)!)
      continue
    }
    const c = constraints.get(key)
    if (!c) continue
    if (c.kind === 'pointOnCurve' || c.kind === 'pointOnCircle') {
      const curve = rawCurve(entities.get(c.e)!, pts)
      x[vars[0]] = curve ? curve.closest(pts.get(c.p)!) : 0
      continue
    }
    const pair = tangentPair(c, entities)
    if (pair && pair[0] && pair[1]) {
      const [ta, tb] = initialTangentParams(pair[0], pair[1], pts)
      x[vars[0]] = ta
      x[vars[1]] = tb
    }
  }
  return x
}

/** One scalar equation plus its sparse gradient. */
interface Row {
  value: number
  grad: Array<[number, number]>
  id: string
}

class RowBuilder {
  rows: Row[] = []
  constructor(
    private x: Float64Array,
    private idx: VarIndex,
  ) {}

  px(p: PointId) {
    return this.x[this.idx.point.get(p)!]
  }
  py(p: PointId) {
    return this.x[this.idx.point.get(p)! + 1]
  }
  ix(p: PointId) {
    return this.idx.point.get(p)!
  }
  iy(p: PointId) {
    return this.idx.point.get(p)! + 1
  }

  push(id: string, value: number, grad: Array<[number, number]>) {
    this.rows.push({ id, value, grad })
  }
}

function entityById(sketch: Sketch2D, id: string): SketchEntity | undefined {
  return sketch.entities.find((e) => e.id === id)
}

interface SplineRep {
  knots: number[]
  degree: number
  count: number
  weights: number[][] | null
  sources: Array<{ value: Vec2; jac: Grad2 }>
}

/**
 * Build every residual row for the current state vector.
 * `frozen` scale factors are computed from `x` and treated as constants.
 */
function buildRows(
  sketch: Sketch2D,
  idx: VarIndex,
  x: Float64Array,
  opts: SolveOptions,
  x0?: Float64Array,
): Row[] {
  const b = new RowBuilder(x, idx)
  const ent = (id: string) => entityById(sketch, id)

  // --- helpers -------------------------------------------------------------
  /** Radius value + gradient for circles (variable) and arcs (|c - p1|). */
  const radiusOf = (e: SketchEntity): { v: number; g: Array<[number, number]> } => {
    if (e.kind === 'circle') {
      const i = idx.radius.get(e.id)!
      return { v: x[i], g: [[i, 1]] }
    }
    if (e.kind === 'arc') {
      const dx = b.px(e.p1) - b.px(e.c)
      const dy = b.py(e.p1) - b.py(e.c)
      const L = Math.hypot(dx, dy) || 1e-9
      return {
        v: L,
        g: [
          [b.ix(e.p1), dx / L],
          [b.iy(e.p1), dy / L],
          [b.ix(e.c), -dx / L],
          [b.iy(e.c), -dy / L],
        ],
      }
    }
    return { v: 0, g: [] }
  }

  /** Direction vector of a line entity and the indices behind it. */
  const dirOf = (e: SketchEntity) => {
    if (e.kind !== 'line') return null
    const ux = b.px(e.p2) - b.px(e.p1)
    const uy = b.py(e.p2) - b.py(e.p1)
    return {
      ux,
      uy,
      len: Math.hypot(ux, uy) || 1e-9,
      ix1: b.ix(e.p1),
      iy1: b.iy(e.p1),
      ix2: b.ix(e.p2),
      iy2: b.iy(e.p2),
    }
  }

  const reps = new Map<string, SplineRep>()
  const splineRep = (e: SplineEntity): SplineRep => {
    const cached = reps.get(e.id)
    if (cached) return cached
    const pointSources = e.points.map((id) => ({
      value: [b.px(id), b.py(id)] as Vec2,
      jac: [
        [b.ix(id), 1, 0],
        [b.iy(id), 0, 1],
      ] as Grad2,
    }))
    let rep: SplineRep
    if (e.mode === 'control') {
      const knots = validKnots(e.knots, e.points.length)
      rep = {
        knots,
        degree: splineDegree(e.points.length, knots),
        count: e.points.length,
        weights: null,
        sources: pointSources,
      }
    } else {
      const handles = idx.handle.get(e.id) ?? {}
      const system = fitSystem(
        chordParameters(pointSources.map((s) => s.value)),
        handles.start !== undefined,
        handles.end !== undefined,
      )
      if (!system) {
        rep = {
          knots: clampedKnots(e.points.length, 1),
          degree: 1,
          count: e.points.length,
          weights: null,
          sources: pointSources,
        }
      } else {
        const sources = [...pointSources]
        for (const i of [handles.start, handles.end]) {
          if (i === undefined) continue
          const dx = x[i]
          const dy = x[i + 1]
          const k = x[i + 2]
          const len = Math.hypot(dx, dy) || 1e-12
          sources.push({
            value: [dx, dy],
            jac: [
              [i, 1, 0],
              [i + 1, 0, 1],
            ],
          })
          sources.push({
            value: handleSecondDerivative({ dx, dy, k }),
            jac: [
              [i, (-k * dy * dx) / len, k * (len + (dx * dx) / len)],
              [i + 1, -k * (len + (dy * dy) / len), (k * dx * dy) / len],
              [i + 2, -len * dy, len * dx],
            ],
          })
        }
        rep = {
          knots: system.knots,
          degree: 3,
          count: system.count,
          weights: system.weights,
          sources,
        }
      }
    }
    reps.set(e.id, rep)
    return rep
  }

  const splineDomain = (e: SplineEntity): [number, number] => {
    const rep = splineRep(e)
    return [rep.knots[rep.degree], rep.knots[rep.count]]
  }

  const jet = (e: SketchEntity, t: number): Jet | null => {
    switch (e.kind) {
      case 'line': {
        const ix1 = b.ix(e.p1)
        const ix2 = b.ix(e.p2)
        const ax = x[ix1]
        const ay = x[ix1 + 1]
        const dx = x[ix2] - ax
        const dy = x[ix2 + 1] - ay
        return {
          v: [
            [ax + dx * t, ay + dy * t],
            [dx, dy],
            [0, 0],
          ],
          g: [
            [
              [ix1, 1 - t, 0],
              [ix1 + 1, 0, 1 - t],
              [ix2, t, 0],
              [ix2 + 1, 0, t],
            ],
            [
              [ix1, -1, 0],
              [ix1 + 1, 0, -1],
              [ix2, 1, 0],
              [ix2 + 1, 0, 1],
            ],
            [],
          ],
        }
      }
      case 'circle': {
        const ic = b.ix(e.c)
        const ir = idx.radius.get(e.id)!
        const r = x[ir]
        const cs = Math.cos(t)
        const sn = Math.sin(t)
        return {
          v: [
            [x[ic] + r * cs, x[ic + 1] + r * sn],
            [-r * sn, r * cs],
            [-r * cs, -r * sn],
          ],
          g: [
            [
              [ic, 1, 0],
              [ic + 1, 0, 1],
              [ir, cs, sn],
            ],
            [[ir, -sn, cs]],
            [[ir, -cs, -sn]],
          ],
        }
      }
      case 'arc': {
        const ic = b.ix(e.c)
        const ip = b.ix(e.p1)
        const wx = x[ip] - x[ic]
        const wy = x[ip + 1] - x[ic + 1]
        const R = Math.hypot(wx, wy) || 1e-9
        const ux = wx / R
        const uy = wy / R
        const cs = Math.cos(t)
        const sn = Math.sin(t)
        const term = (dx: number, dy: number): Grad2 => [
          [ip, ux * dx, ux * dy],
          [ip + 1, uy * dx, uy * dy],
          [ic, -ux * dx, -ux * dy],
          [ic + 1, -uy * dx, -uy * dy],
        ]
        return {
          v: [
            [x[ic] + R * cs, x[ic + 1] + R * sn],
            [-R * sn, R * cs],
            [-R * cs, -R * sn],
          ],
          g: [[[ic, 1, 0], [ic + 1, 0, 1], ...term(cs, sn)], term(-sn, cs), term(-cs, -sn)],
        }
      }
      case 'ellipse':
      case 'ellipticalArc': {
        const ic = b.ix(e.c)
        const ie = idx.ellipse.get(e.id)!
        const rx = x[ie]
        const ry = x[ie + 1]
        const cp = Math.cos(x[ie + 2])
        const sp = Math.sin(x[ie + 2])
        const cs = Math.cos(t)
        const sn = Math.sin(t)
        const rot = (lx: number, ly: number): Vec2 => [cp * lx - sp * ly, sp * lx + cp * ly]
        const locals: Array<[Vec2, Vec2, Vec2]> = [
          [
            [rx * cs, ry * sn],
            [cs, 0],
            [0, sn],
          ],
          [
            [-rx * sn, ry * cs],
            [-sn, 0],
            [0, cs],
          ],
          [
            [-rx * cs, -ry * sn],
            [-cs, 0],
            [0, -sn],
          ],
        ]
        const v: Vec2[] = []
        const g: Grad2[] = []
        locals.forEach(([l, drx, dry], k) => {
          const rel = rot(l[0], l[1])
          const a = rot(drx[0], drx[1])
          const c2 = rot(dry[0], dry[1])
          const entries: Grad2 = [
            [ie, a[0], a[1]],
            [ie + 1, c2[0], c2[1]],
            [ie + 2, -rel[1], rel[0]],
          ]
          if (k === 0) {
            v.push([x[ic] + rel[0], x[ic + 1] + rel[1]])
            entries.push([ic, 1, 0], [ic + 1, 0, 1])
          } else {
            v.push(rel)
          }
          g.push(entries)
        })
        return { v: [v[0], v[1], v[2]], g: [g[0], g[1], g[2]] }
      }
      case 'spline': {
        const rep = splineRep(e)
        const span = findSpan(rep.count, rep.degree, t, rep.knots)
        const ders = basisDerivatives(span, t, rep.degree, 2, rep.knots)
        const v: Vec2[] = []
        const g: Grad2[] = []
        for (let k = 0; k <= 2; k++) {
          const coef = new Array<number>(rep.sources.length).fill(0)
          for (let jj = 0; jj <= rep.degree; jj++) {
            const j = span - rep.degree + jj
            const w = ders[k][jj]
            if (w === 0) continue
            if (rep.weights) {
              const line = rep.weights[j]
              for (let s = 0; s < line.length; s++) coef[s] += w * line[s]
            } else {
              coef[j] += w
            }
          }
          let vx = 0
          let vy = 0
          const entries: Grad2 = []
          for (let s = 0; s < coef.length; s++) {
            const c = coef[s]
            if (c === 0) continue
            const source = rep.sources[s]
            vx += c * source.value[0]
            vy += c * source.value[1]
            for (const [i, gx, gy] of source.jac) entries.push([i, c * gx, c * gy])
          }
          v.push([vx, vy])
          g.push(entries)
        }
        return { v: [v[0], v[1], v[2]], g: [g[0], g[1], g[2]] }
      }
      default:
        return null
    }
  }

  type Direction = NonNullable<ReturnType<typeof dirOf>>

  const directionRow = (id: string, A: Direction, B: Direction, cos: number, sin: number) => {
    const k = 1 / (A.len * B.len)
    const cross = A.ux * B.uy - A.uy * B.ux
    const dot = A.ux * B.ux + A.uy * B.uy
    const f = k * (cross * cos - dot * sin)
    const ga: Vec2 = [
      k * (cos * B.uy - sin * B.ux) - (f * A.ux) / (A.len * A.len),
      k * (-cos * B.ux - sin * B.uy) - (f * A.uy) / (A.len * A.len),
    ]
    const gb: Vec2 = [
      k * (-cos * A.uy - sin * A.ux) - (f * B.ux) / (B.len * B.len),
      k * (cos * A.ux - sin * A.uy) - (f * B.uy) / (B.len * B.len),
    ]
    b.push(id, f, [
      [A.ix2, ga[0]],
      [A.iy2, ga[1]],
      [A.ix1, -ga[0]],
      [A.iy1, -ga[1]],
      [B.ix2, gb[0]],
      [B.iy2, gb[1]],
      [B.ix1, -gb[0]],
      [B.iy1, -gb[1]],
    ])
  }

  const lineDistanceRow = (
    id: string,
    sources: Array<[PointId, number]>,
    d: Direction,
    extra = 0,
    extraGrad: Grad = [],
  ) => {
    let qx = 0
    let qy = 0
    for (const [p, weight] of sources) {
      qx += weight * b.px(p)
      qy += weight * b.py(p)
    }
    const L = d.len
    const wx = qx - x[d.ix1]
    const wy = qy - x[d.iy1]
    const f = (wx * d.uy - wy * d.ux) / L
    const gw: Vec2 = [d.uy / L, -d.ux / L]
    const gd: Vec2 = [-wy / L - (f * d.ux) / (L * L), wx / L - (f * d.uy) / (L * L)]
    const grad: Grad = []
    for (const [p, weight] of sources) {
      grad.push([b.ix(p), weight * gw[0]], [b.iy(p), weight * gw[1]])
    }
    grad.push([d.ix2, gd[0]], [d.iy2, gd[1]], [d.ix1, -gw[0] - gd[0]], [d.iy1, -gw[1] - gd[1]])
    b.push(id, f + extra, [...grad, ...extraGrad])
  }

  const lineAlongRow = (id: string, a: PointId, c2: PointId, d: Direction) => {
    const L = d.len
    const abx = b.px(c2) - b.px(a)
    const aby = b.py(c2) - b.py(a)
    const f = (abx * d.ux + aby * d.uy) / L
    const gd: Vec2 = [abx / L - (f * d.ux) / (L * L), aby / L - (f * d.uy) / (L * L)]
    b.push(id, f, [
      [b.ix(c2), d.ux / L],
      [b.iy(c2), d.uy / L],
      [b.ix(a), -d.ux / L],
      [b.iy(a), -d.uy / L],
      [d.ix2, gd[0]],
      [d.iy2, gd[1]],
      [d.ix1, -gd[0]],
      [d.iy1, -gd[1]],
    ])
  }

  const alignmentRow = (id: string, u: Vec2, gu: Grad2, v: Vec2, gv: Grad2, extra: Grad = []) => {
    const U = Math.hypot(u[0], u[1]) || 1e-9
    const V = Math.hypot(v[0], v[1]) || 1e-9
    const k = 1 / (U * V)
    const f = k * v2.cross(u, v)
    const fu: Vec2 = [k * v[1] - (f * u[0]) / (U * U), -k * v[0] - (f * u[1]) / (U * U)]
    const fv: Vec2 = [-k * u[1] - (f * v[0]) / (V * V), k * u[0] - (f * v[1]) / (V * V)]
    b.push(id, f, [
      ...gu.map(([i, gx, gy]) => [i, fu[0] * gx + fu[1] * gy] as [number, number]),
      ...gv.map(([i, gx, gy]) => [i, fv[0] * gx + fv[1] * gy] as [number, number]),
      ...extra,
    ])
    return { fu, fv }
  }

  const pointOnJet = (id: string, p: PointId, e: SketchEntity, it: number) => {
    const J = jet(e, x[it])
    if (!J) return
    b.push(id, J.v[0][0] - b.px(p), [
      [it, J.v[1][0]],
      [b.ix(p), -1],
      ...J.g[0].map(([i, gx]) => [i, gx] as [number, number]),
    ])
    b.push(id, J.v[0][1] - b.py(p), [
      [it, J.v[1][1]],
      [b.iy(p), -1],
      ...J.g[0].map(([i, , gy]) => [i, gy] as [number, number]),
    ])
  }

  const tangentJets = (id: string, A: SketchEntity, B: SketchEntity, vars: number[]) => {
    const [ia, ib] = vars
    const Ja = jet(A, x[ia])
    const Jb = jet(B, x[ib])
    if (!Ja || !Jb) return
    b.push(id, Ja.v[0][0] - Jb.v[0][0], [
      [ia, Ja.v[1][0]],
      [ib, -Jb.v[1][0]],
      ...Ja.g[0].map(([i, gx]) => [i, gx] as [number, number]),
      ...Jb.g[0].map(([i, gx]) => [i, -gx] as [number, number]),
    ])
    b.push(id, Ja.v[0][1] - Jb.v[0][1], [
      [ia, Ja.v[1][1]],
      [ib, -Jb.v[1][1]],
      ...Ja.g[0].map(([i, , gy]) => [i, gy] as [number, number]),
      ...Jb.g[0].map(([i, , gy]) => [i, -gy] as [number, number]),
    ])
    const U = Math.hypot(Ja.v[1][0], Ja.v[1][1]) || 1e-9
    const V = Math.hypot(Jb.v[1][0], Jb.v[1][1]) || 1e-9
    const f = v2.cross(Ja.v[1], Jb.v[1]) / (U * V)
    const fu: Vec2 = [
      Jb.v[1][1] / (U * V) - (f * Ja.v[1][0]) / (U * U),
      -Jb.v[1][0] / (U * V) - (f * Ja.v[1][1]) / (U * U),
    ]
    const fv: Vec2 = [
      -Ja.v[1][1] / (U * V) - (f * Jb.v[1][0]) / (V * V),
      Ja.v[1][0] / (U * V) - (f * Jb.v[1][1]) / (V * V),
    ]
    b.push(id, f, [
      [ia, fu[0] * Ja.v[2][0] + fu[1] * Ja.v[2][1]],
      [ib, fv[0] * Jb.v[2][0] + fv[1] * Jb.v[2][1]],
      ...Ja.g[1].map(([i, gx, gy]) => [i, fu[0] * gx + fu[1] * gy] as [number, number]),
      ...Jb.g[1].map(([i, gx, gy]) => [i, fv[0] * gx + fv[1] * gy] as [number, number]),
    ])
  }

  const pointOnLineRow = (id: string, p: PointId, e: LineEntity) => {
    lineDistanceRow(id, [[p, 1]], dirOf(e)!)
  }

  const pointOnCircleRows = (id: string, p: PointId, e: SketchEntity) => {
    const r = radiusOf(e)
    const centre = (e as { c: string }).c
    const dx = b.px(p) - b.px(centre)
    const dy = b.py(p) - b.py(centre)
    const L = Math.hypot(dx, dy) || 1e-9
    b.push(id, L - r.v, [
      [b.ix(p), dx / L],
      [b.iy(p), dy / L],
      [b.ix(centre), -dx / L],
      [b.iy(centre), -dy / L],
      ...r.g.map(([i, g]) => [i, -g] as [number, number]),
    ])
  }

  const symmetricPoints = (id: string, a: PointId, c2: PointId, e: LineEntity) => {
    const d = dirOf(e)!
    lineDistanceRow(
      id,
      [
        [a, 0.5],
        [c2, 0.5],
      ],
      d,
    )
    lineAlongRow(id, a, c2, d)
  }

  const coincidentRows = (id: string, a: PointId, c2: PointId) => {
    if (a === c2) return
    b.push(id, b.px(a) - b.px(c2), [
      [b.ix(a), 1],
      [b.ix(c2), -1],
    ])
    b.push(id, b.py(a) - b.py(c2), [
      [b.iy(a), 1],
      [b.iy(c2), -1],
    ])
  }

  const endPointOf = (e: SketchEntity, end: SplineEnd): PointId | null => {
    if (e.kind === 'line' || e.kind === 'arc' || e.kind === 'ellipticalArc') {
      return end === 'start' ? e.p1 : e.p2
    }
    if (e.kind === 'spline') return end === 'start' ? e.points[0] : e.points[e.points.length - 1]
    return null
  }

  const leaving = (
    e: SketchEntity,
    end: SplineEnd,
  ): { d: Vec2; gd: Grad2; kappa: number; gk: Grad } | null => {
    const sign = end === 'start' ? 1 : -1
    if (e.kind === 'line') {
      const d = dirOf(e)!
      return {
        d: [sign * d.ux, sign * d.uy],
        gd: [
          [d.ix2, sign, 0],
          [d.iy2, 0, sign],
          [d.ix1, -sign, 0],
          [d.iy1, 0, -sign],
        ],
        kappa: 0,
        gk: [],
      }
    }
    if (e.kind === 'arc') {
      const p = end === 'start' ? e.p1 : e.p2
      const wx = b.px(p) - b.px(e.c)
      const wy = b.py(p) - b.py(e.c)
      const R = Math.hypot(wx, wy) || 1e-9
      const s = (e.ccw ? 1 : -1) * sign
      const R3 = R * R * R
      return {
        d: [-s * wy, s * wx],
        gd: [
          [b.ix(p), 0, s],
          [b.iy(p), -s, 0],
          [b.ix(e.c), 0, -s],
          [b.iy(e.c), s, 0],
        ],
        kappa: s / R,
        gk: [
          [b.ix(p), (-s * wx) / R3],
          [b.iy(p), (-s * wy) / R3],
          [b.ix(e.c), (s * wx) / R3],
          [b.iy(e.c), (s * wy) / R3],
        ],
      }
    }
    if (e.kind === 'spline') {
      const [lo, hi] = splineDomain(e)
      const J = jet(e, end === 'start' ? lo : hi)!
      const v1 = J.v[1]
      const v2d = J.v[2]
      const speed = Math.hypot(v1[0], v1[1]) || 1e-9
      const s3 = speed * speed * speed
      const kappa = v2.cross(v1, v2d) / s3
      const gk: Grad = []
      for (const [i, gx, gy] of J.g[1]) {
        gk.push([
          i,
          sign *
            ((gx * v2d[1] - gy * v2d[0]) / s3 -
              (3 * kappa * (v1[0] * gx + v1[1] * gy)) / (speed * speed)),
        ])
      }
      for (const [i, gx, gy] of J.g[2]) gk.push([i, (sign * (v1[0] * gy - v1[1] * gx)) / s3])
      return {
        d: [sign * v1[0], sign * v1[1]],
        gd: J.g[1].map(([i, gx, gy]) => [i, sign * gx, sign * gy] as [number, number, number]),
        kappa: sign * kappa,
        gk,
      }
    }
    return null
  }

  const pointSet = new Set(sketch.points.map((p) => p.id))
  const classes = coincidenceClasses(sketch)

  const jointRow = (id: string, A: SketchEntity | undefined, B: SketchEntity | undefined) => {
    const joint = sharedJoint(A, B, classes)
    if (!A || !B || !joint) return false
    const la = leaving(A, joint[0])
    const lb = leaving(B, joint[1])
    if (!la || !lb) return false
    alignmentRow(id, la.d, la.gd, lb.d, lb.gd)
    return true
  }

  // --- implicit rows -------------------------------------------------------
  // An arc is stored as centre + two endpoints, which over-specifies the
  // radius. Pin the two ends to the same distance from the centre.
  for (const e of sketch.entities) {
    if (e.kind !== 'arc') continue
    const ax = b.px(e.p1) - b.px(e.c)
    const ay = b.py(e.p1) - b.py(e.c)
    const bx = b.px(e.p2) - b.px(e.c)
    const by = b.py(e.p2) - b.py(e.c)
    const la = Math.hypot(ax, ay) || 1e-9
    const lb = Math.hypot(bx, by) || 1e-9
    b.push(`arc:${e.id}`, la - lb, [
      [b.ix(e.p1), ax / la],
      [b.iy(e.p1), ay / la],
      [b.ix(e.p2), -bx / lb],
      [b.iy(e.p2), -by / lb],
      [b.ix(e.c), -ax / la + bx / lb],
      [b.iy(e.c), -ay / la + by / lb],
    ])
  }

  for (const e of sketch.entities) {
    if (e.kind !== 'ellipticalArc') continue
    const vars = idx.hidden.get(`earc:${e.id}`)
    if (!vars) continue
    pointOnJet(`earc:${e.id}`, e.p1, e, vars[0])
    pointOnJet(`earc:${e.id}`, e.p2, e, vars[1])
  }

  // --- user constraints ----------------------------------------------------
  for (const c of sketch.constraints) {
    switch (c.kind) {
      case 'coincident': {
        b.push(c.id, b.px(c.a) - b.px(c.b), [
          [b.ix(c.a), 1],
          [b.ix(c.b), -1],
        ])
        b.push(c.id, b.py(c.a) - b.py(c.b), [
          [b.iy(c.a), 1],
          [b.iy(c.b), -1],
        ])
        break
      }
      case 'fix': {
        b.push(c.id, b.px(c.p) - c.x, [[b.ix(c.p), 1]])
        b.push(c.id, b.py(c.p) - c.y, [[b.iy(c.p), 1]])
        break
      }
      case 'horizontal': {
        const e = ent(c.e)
        if (e?.kind !== 'line') break
        b.push(c.id, b.py(e.p1) - b.py(e.p2), [
          [b.iy(e.p1), 1],
          [b.iy(e.p2), -1],
        ])
        break
      }
      case 'vertical': {
        const e = ent(c.e)
        if (e?.kind !== 'line') break
        b.push(c.id, b.px(e.p1) - b.px(e.p2), [
          [b.ix(e.p1), 1],
          [b.ix(e.p2), -1],
        ])
        break
      }
      case 'parallel':
      case 'perpendicular': {
        const A = ent(c.a),
          B = ent(c.b)
        const d1 = A && dirOf(A),
          d2 = B && dirOf(B)
        if (!d1 || !d2) break
        if (c.kind === 'parallel') directionRow(c.id, d1, d2, 1, 0)
        else directionRow(c.id, d1, d2, 0, -1)
        break
      }
      case 'equal': {
        const A = ent(c.a),
          B = ent(c.b)
        if (!A || !B) break
        if (A.kind === 'line' && B.kind === 'line') {
          const d1 = dirOf(A)!,
            d2 = dirOf(B)!
          b.push(c.id, d1.len - d2.len, [
            [d1.ix1, -d1.ux / d1.len],
            [d1.iy1, -d1.uy / d1.len],
            [d1.ix2, d1.ux / d1.len],
            [d1.iy2, d1.uy / d1.len],
            [d2.ix1, d2.ux / d2.len],
            [d2.iy1, d2.uy / d2.len],
            [d2.ix2, -d2.ux / d2.len],
            [d2.iy2, -d2.uy / d2.len],
          ])
        } else if (isRound(A) && isRound(B)) {
          const ra = radiusOf(A),
            rb = radiusOf(B)
          b.push(c.id, ra.v - rb.v, [...ra.g, ...rb.g.map(([i, g]) => [i, -g] as [number, number])])
        } else if (isElliptic(A) && isElliptic(B)) {
          const ia = idx.ellipse.get(A.id)!
          const ib = idx.ellipse.get(B.id)!
          b.push(c.id, x[ia] - x[ib], [
            [ia, 1],
            [ib, -1],
          ])
          b.push(c.id, x[ia + 1] - x[ib + 1], [
            [ia + 1, 1],
            [ib + 1, -1],
          ])
        }
        break
      }
      case 'pointOnLine':
      case 'midpoint': {
        const e = ent(c.e)
        if (e?.kind !== 'line') break
        const d = dirOf(e)!
        if (c.kind === 'midpoint') {
          b.push(c.id, b.px(c.p) - (b.px(e.p1) + b.px(e.p2)) / 2, [
            [b.ix(c.p), 1],
            [d.ix1, -0.5],
            [d.ix2, -0.5],
          ])
          b.push(c.id, b.py(c.p) - (b.py(e.p1) + b.py(e.p2)) / 2, [
            [b.iy(c.p), 1],
            [d.iy1, -0.5],
            [d.iy2, -0.5],
          ])
        } else {
          lineDistanceRow(c.id, [[c.p, 1]], d)
        }
        break
      }
      case 'pointOnCircle': {
        const e = ent(c.e)
        if (isRound(e)) {
          pointOnCircleRows(c.id, c.p, e)
          break
        }
        const vars = idx.hidden.get(c.id)
        if (e && vars) pointOnJet(c.id, c.p, e, vars[0])
        break
      }
      case 'pointOnCurve': {
        const e = ent(c.e)
        if (!e || !pointSet.has(c.p)) break
        if (e.kind === 'line') pointOnLineRow(c.id, c.p, e)
        else if (isRound(e)) pointOnCircleRows(c.id, c.p, e)
        else if (e.kind === 'point') coincidentRows(c.id, c.p, e.p)
        else {
          const vars = idx.hidden.get(c.id)
          if (vars) pointOnJet(c.id, c.p, e, vars[0])
        }
        break
      }
      case 'tangent': {
        const L = ent(c.line),
          C = ent(c.circle)
        if (jointRow(c.id, L, C)) break
        if (L?.kind === 'line' && C && !isRound(C)) {
          const vars = idx.hidden.get(c.id)
          if (vars) tangentJets(c.id, L, C, vars)
          break
        }
        if (L?.kind !== 'line' || !isRound(C)) break
        const r = radiusOf(C)
        lineDistanceRow(
          c.id,
          [[C.c, 1]],
          dirOf(L)!,
          -c.side * r.v,
          r.g.map(([i, g]) => [i, -c.side * g] as [number, number]),
        )
        break
      }
      case 'tangentArcs': {
        const A = ent(c.a),
          B = ent(c.b)
        if (jointRow(c.id, A, B)) break
        if (!isRound(A) || !isRound(B)) {
          const vars = idx.hidden.get(c.id)
          if (A && B && vars) tangentJets(c.id, A, B, vars)
          break
        }
        const ra = radiusOf(A)
        const rb = radiusOf(B)
        const dx = b.px(A.c) - b.px(B.c)
        const dy = b.py(A.c) - b.py(B.c)
        const L = Math.hypot(dx, dy) || 1e-9
        // Centres exactly one combined radius apart: outside each other when
        // side is +1, nested when it is -1.
        b.push(c.id, L - (ra.v + c.side * rb.v), [
          [b.ix(A.c), dx / L],
          [b.iy(A.c), dy / L],
          [b.ix(B.c), -dx / L],
          [b.iy(B.c), -dy / L],
          ...ra.g.map(([i, g]) => [i, -g] as [number, number]),
          ...rb.g.map(([i, g]) => [i, -c.side * g] as [number, number]),
        ])
        break
      }
      case 'tangentCurves': {
        const A = ent(c.a),
          B = ent(c.b)
        if (jointRow(c.id, A, B)) break
        const vars = idx.hidden.get(c.id)
        if (A && B && vars) tangentJets(c.id, A, B, vars)
        break
      }
      case 'symmetric': {
        const e = ent(c.line)
        if (e?.kind !== 'line') break
        symmetricPoints(c.id, c.a, c.b, e)
        break
      }
      case 'distance': {
        const dx = b.px(c.a) - b.px(c.b)
        const dy = b.py(c.a) - b.py(c.b)
        const L = Math.hypot(dx, dy) || 1e-9
        b.push(c.id, L - c.value, [
          [b.ix(c.a), dx / L],
          [b.iy(c.a), dy / L],
          [b.ix(c.b), -dx / L],
          [b.iy(c.b), -dy / L],
        ])
        break
      }
      case 'distanceX': {
        b.push(c.id, b.px(c.b) - b.px(c.a) - c.value, [
          [b.ix(c.b), 1],
          [b.ix(c.a), -1],
        ])
        break
      }
      case 'distanceY': {
        b.push(c.id, b.py(c.b) - b.py(c.a) - c.value, [
          [b.iy(c.b), 1],
          [b.iy(c.a), -1],
        ])
        break
      }
      case 'radius':
      case 'diameter': {
        const e = ent(c.e)
        const target = c.kind === 'radius' ? c.value : c.value / 2
        if (isElliptic(e)) {
          const i = idx.ellipse.get(e.id)! + (c.axis === 'minor' ? 1 : 0)
          b.push(c.id, x[i] - target, [[i, 1]])
          break
        }
        if (!e || !isRound(e)) break
        const r = radiusOf(e)
        b.push(c.id, r.v - target, r.g)
        break
      }
      case 'pointLineDistance': {
        const e = ent(c.e)
        if (e?.kind !== 'line' || !pointSet.has(c.p) || c.p === e.p1 || c.p === e.p2) break
        const d = dirOf(e)!
        const wx = b.px(c.p) - x[d.ix1]
        const wy = b.py(c.p) - x[d.iy1]
        const side = wx * d.uy - wy * d.ux >= 0 ? 1 : -1
        lineDistanceRow(c.id, [[c.p, 1]], d, -side * c.value)
        break
      }
      case 'angle': {
        const A = ent(c.a),
          B = ent(c.b)
        const d1 = A && dirOf(A),
          d2 = B && dirOf(B)
        if (!d1 || !d2) break
        const th = (c.value * Math.PI) / 180
        directionRow(c.id, d1, d2, Math.cos(th), Math.sin(th))
        break
      }
      case 'collinear': {
        const A = ent(c.a),
          B = ent(c.b)
        if (A?.kind !== 'line' || B?.kind !== 'line') break
        pointOnLineRow(c.id, B.p1, A)
        pointOnLineRow(c.id, B.p2, A)
        break
      }
      case 'concentric': {
        const A = ent(c.a),
          B = ent(c.b)
        if (!A || !B || !('c' in A) || !('c' in B)) break
        coincidentRows(c.id, A.c, B.c)
        break
      }
      case 'smooth': {
        const A = ent(c.a),
          B = ent(c.b)
        if (A?.kind !== 'spline' || !B || !usableCurve(A, pointSet)) break
        if (!(B.kind === 'line' || B.kind === 'arc' || B.kind === 'spline')) break
        if (B.kind === 'spline' && !usableCurve(B, pointSet)) break
        const endA = endPointOf(A, c.aEnd)!
        const endB = endPointOf(B, c.bEnd)!
        coincidentRows(c.id, endA, endB)
        const la = leaving(A, c.aEnd)
        const lb = leaving(B, c.bEnd)
        if (!la || !lb) break
        alignmentRow(c.id, la.d, la.gd, lb.d, lb.gd)
        let scale = 0
        for (let i = 1; i < A.points.length; i++) {
          scale += Math.hypot(
            b.px(A.points[i]) - b.px(A.points[i - 1]),
            b.py(A.points[i]) - b.py(A.points[i - 1]),
          )
        }
        const L = scale > 1e-9 ? scale : 1
        b.push(c.id, L * (la.kappa + lb.kappa), [
          ...la.gk.map(([i, g]) => [i, L * g] as [number, number]),
          ...lb.gk.map(([i, g]) => [i, L * g] as [number, number]),
        ])
        break
      }
      case 'symmetricEntities': {
        const L = ent(c.line),
          A = ent(c.a),
          B = ent(c.b)
        if (L?.kind !== 'line' || !A || !B || A.kind !== B.kind) break
        const sym = (p: PointId, q: PointId) => symmetricPoints(c.id, p, q, L)
        if (
          (A.kind === 'point' || A.kind === 'text') &&
          (B.kind === 'point' || B.kind === 'text')
        ) {
          sym(A.p, B.p)
        } else if (A.kind === 'line' && B.kind === 'line') {
          if (c.flip) {
            sym(A.p1, B.p2)
            sym(A.p2, B.p1)
          } else {
            sym(A.p1, B.p1)
            sym(A.p2, B.p2)
          }
        } else if (A.kind === 'circle' && B.kind === 'circle') {
          sym(A.c, B.c)
          const ia = idx.radius.get(A.id)!
          const ib = idx.radius.get(B.id)!
          b.push(c.id, x[ia] - x[ib], [
            [ia, 1],
            [ib, -1],
          ])
        } else if (A.kind === 'arc' && B.kind === 'arc') {
          sym(A.c, B.c)
          if (A.ccw === B.ccw) {
            sym(A.p1, B.p2)
            sym(A.p2, B.p1)
          } else {
            sym(A.p1, B.p1)
            sym(A.p2, B.p2)
          }
        } else if (isElliptic(A) && isElliptic(B)) {
          sym(A.c, B.c)
          if (A.kind === 'ellipticalArc' && B.kind === 'ellipticalArc') {
            if (A.ccw === B.ccw) {
              sym(A.p1, B.p2)
              sym(A.p2, B.p1)
            } else {
              sym(A.p1, B.p1)
              sym(A.p2, B.p2)
            }
          }
          const ia = idx.ellipse.get(A.id)!
          const ib = idx.ellipse.get(B.id)!
          b.push(c.id, x[ia] - x[ib], [
            [ia, 1],
            [ib, -1],
          ])
          b.push(c.id, x[ia + 1] - x[ib + 1], [
            [ia + 1, 1],
            [ib + 1, -1],
          ])
          const d = dirOf(L)!
          const len2 = d.ux * d.ux + d.uy * d.uy || 1e-18
          const psi = Math.atan2(d.uy, d.ux)
          const phase = x[ia + 2] + x[ib + 2] - 2 * psi
          const cv = Math.cos(phase)
          b.push(c.id, Math.sin(phase), [
            [ia + 2, cv],
            [ib + 2, cv],
            [d.ix2, (-2 * cv * -d.uy) / len2],
            [d.iy2, (-2 * cv * d.ux) / len2],
            [d.ix1, (-2 * cv * d.uy) / len2],
            [d.iy1, (-2 * cv * -d.ux) / len2],
          ])
        } else if (A.kind === 'spline' && B.kind === 'spline') {
          if (A.points.length !== B.points.length) break
          const n = A.points.length
          for (let i = 0; i < n; i++) sym(A.points[i], B.points[c.flip ? n - 1 - i : i])
        }
        break
      }
      case 'ellipseAxis': {
        const L = ent(c.line),
          E = ent(c.e)
        if (L?.kind !== 'line' || !isElliptic(E)) break
        const d = dirOf(L)!
        const ie = idx.ellipse.get(E.id)!
        const phi = x[ie + 2]
        const axis: Vec2 =
          c.axis === 'major' ? [Math.cos(phi), Math.sin(phi)] : [-Math.sin(phi), Math.cos(phi)]
        const daxis: Vec2 =
          c.axis === 'major' ? [-Math.sin(phi), Math.cos(phi)] : [-Math.cos(phi), -Math.sin(phi)]
        const L2 = d.len * d.len
        const f = (d.ux * axis[1] - d.uy * axis[0]) / d.len
        const gd: Vec2 = [axis[1] / d.len - (f * d.ux) / L2, -axis[0] / d.len - (f * d.uy) / L2]
        b.push(c.id, f, [
          [d.ix2, gd[0]],
          [d.iy2, gd[1]],
          [d.ix1, -gd[0]],
          [d.iy1, -gd[1]],
          [ie + 2, (d.ux * daxis[1] - d.uy * daxis[0]) / d.len],
        ])
        break
      }
      case 'fixShape': {
        const e = ent(c.e)
        if (!e) break
        if (e.kind === 'circle' && c.r !== undefined) {
          const i = idx.radius.get(e.id)!
          b.push(c.id, x[i] - c.r, [[i, 1]])
        }
        if (isElliptic(e)) {
          const i = idx.ellipse.get(e.id)!
          if (c.rx !== undefined) b.push(c.id, x[i] - c.rx, [[i, 1]])
          if (c.ry !== undefined) b.push(c.id, x[i + 1] - c.ry, [[i + 1, 1]])
          if (c.rotation !== undefined) b.push(c.id, x[i + 2] - c.rotation * DEG, [[i + 2, 1]])
        }
        if (e.kind === 'spline') {
          const h = idx.handle.get(e.id)
          for (const [value, i] of [
            [c.start, h?.start],
            [c.end, h?.end],
          ] as Array<[SplineHandle | undefined, number | undefined]>) {
            if (!value || i === undefined) continue
            b.push(c.id, x[i] - value.dx, [[i, 1]])
            b.push(c.id, x[i + 1] - value.dy, [[i + 1, 1]])
            b.push(c.id, x[i + 2] - value.k, [[i + 2, 1]])
          }
        }
        break
      }
    }
  }

  // --- interaction rows ----------------------------------------------------
  // Only present while dragging. Both are deliberately far weaker than any
  // real constraint, and both are excluded from conflict reporting.
  if (opts.drag && idx.point.has(opts.drag.point)) {
    const p = opts.drag.point
    b.push('drag', DRAG_WEIGHT * (b.px(p) - opts.drag.x), [[b.ix(p), DRAG_WEIGHT]])
    b.push('drag', DRAG_WEIGHT * (b.py(p) - opts.drag.y), [[b.iy(p), DRAG_WEIGHT]])
    if (x0) {
      for (let i = 0; i < x.length; i++) {
        b.push('reg', REGULARISATION * (x[i] - x0[i]), [[i, REGULARISATION]])
      }
    }
  }

  return b.rows
}

/** Solve a dense symmetric system by Gaussian elimination with partial pivoting. */
function solveDense(A: Float64Array, rhs: Float64Array, n: number): Float64Array | null {
  const M = new Float64Array(A)
  const x = new Float64Array(rhs)
  for (let col = 0; col < n; col++) {
    let piv = col
    let best = Math.abs(M[col * n + col])
    for (let r = col + 1; r < n; r++) {
      const v = Math.abs(M[r * n + col])
      if (v > best) {
        best = v
        piv = r
      }
    }
    if (best < 1e-14) return null
    if (piv !== col) {
      for (let k = 0; k < n; k++) {
        const t = M[col * n + k]
        M[col * n + k] = M[piv * n + k]
        M[piv * n + k] = t
      }
      const t = x[col]
      x[col] = x[piv]
      x[piv] = t
    }
    const d = M[col * n + col]
    for (let r = col + 1; r < n; r++) {
      const f = M[r * n + col] / d
      if (f === 0) continue
      for (let k = col; k < n; k++) M[r * n + k] -= f * M[col * n + k]
      x[r] -= f * x[col]
    }
  }
  for (let r = n - 1; r >= 0; r--) {
    let s = x[r]
    for (let k = r + 1; k < n; k++) s -= M[r * n + k] * x[k]
    x[r] = s / M[r * n + r]
  }
  return x
}

/**
 * Rank of the Jacobian, plus which individual variables are still free to move.
 *
 * Degrees of freedom = variables - rank, which is the number the status bar
 * shows. Knowing *which* variables make up that number is far more useful: it
 * lets the sketch draw loose geometry in a different colour, so "4 things can
 * still move" becomes something the user can point at instead of a riddle.
 *
 * Reduces the Jacobian to row-reduced echelon form. Columns without a pivot are
 * free outright; a pivot column can also move if it has any dependence on a
 * free column, which is exactly a non-zero entry in that column of its own
 * pivot row.
 */
function jacobianAnalysis(rows: Row[], n: number): { rank: number; free: Uint8Array } {
  const free = new Uint8Array(n)
  const m = rows.length
  if (n === 0) return { rank: 0, free }
  if (m === 0) {
    free.fill(1)
    return { rank: 0, free }
  }

  const M = new Float64Array(m * n)
  for (let r = 0; r < m; r++) {
    for (const [i, g] of rows[r].grad) M[r * n + i] += g
  }
  // Scale rows so a large-magnitude constraint cannot mask a small one.
  for (let r = 0; r < m; r++) {
    let norm = 0
    for (let k = 0; k < n; k++) norm = Math.max(norm, Math.abs(M[r * n + k]))
    if (norm > 1e-12) for (let k = 0; k < n; k++) M[r * n + k] /= norm
  }

  const used = new Uint8Array(m)
  const pivotRowOfCol = new Int32Array(n).fill(-1)
  let rank = 0

  for (let col = 0; col < n; col++) {
    let piv = -1
    let best = 1e-8
    for (let r = 0; r < m; r++) {
      if (used[r]) continue
      const v = Math.abs(M[r * n + col])
      if (v > best) {
        best = v
        piv = r
      }
    }
    if (piv < 0) continue
    used[piv] = 1
    pivotRowOfCol[col] = piv
    rank++
    const d = M[piv * n + col]
    for (let k = 0; k < n; k++) M[piv * n + k] /= d
    // Full reduction, including rows already used as pivots: the null space
    // basis below is only readable off a fully reduced matrix.
    for (let r = 0; r < m; r++) {
      if (r === piv) continue
      const f = M[r * n + col]
      if (f === 0) continue
      for (let k = 0; k < n; k++) M[r * n + k] -= f * M[piv * n + k]
    }
  }

  const NULL_TOLERANCE = 1e-7
  for (let col = 0; col < n; col++) {
    if (pivotRowOfCol[col] >= 0) continue
    // A column with no pivot moves freely...
    free[col] = 1
    // ...and drags every pivot variable that depends on it.
    for (let p = 0; p < n; p++) {
      const row = pivotRowOfCol[p]
      if (row >= 0 && Math.abs(M[row * n + col]) > NULL_TOLERANCE) free[p] = 1
    }
  }

  return { rank, free }
}

function rms(rows: Row[]): number {
  if (!rows.length) return 0
  let s = 0
  for (const r of rows) s += r.value * r.value
  return Math.sqrt(s / rows.length)
}

function entityVariables(e: SketchEntity, idx: VarIndex): number[] {
  const out: number[] = []
  const pointIdsOf = (): string[] => {
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
        return e.points
    }
  }
  for (const id of pointIdsOf()) {
    const i = idx.point.get(id)
    if (i !== undefined) out.push(i, i + 1)
  }
  const r = idx.radius.get(e.id)
  if (r !== undefined) out.push(r)
  const el = idx.ellipse.get(e.id)
  if (el !== undefined) out.push(el, el + 1, el + 2)
  const h = idx.handle.get(e.id)
  if (h?.start !== undefined) out.push(h.start, h.start + 1, h.start + 2)
  if (h?.end !== undefined) out.push(h.end, h.end + 1, h.end + 2)
  return out
}

function handlesFrom(
  idx: VarIndex,
  x: ArrayLike<number>,
): Record<string, { start?: SplineHandle; end?: SplineHandle }> {
  const handles: Record<string, { start?: SplineHandle; end?: SplineHandle }> = {}
  for (const [id, entry] of idx.handle) {
    const out: { start?: SplineHandle; end?: SplineHandle } = {}
    if (entry.start !== undefined) {
      out.start = { dx: x[entry.start], dy: x[entry.start + 1], k: x[entry.start + 2] }
    }
    if (entry.end !== undefined) {
      out.end = { dx: x[entry.end], dy: x[entry.end + 1], k: x[entry.end + 2] }
    }
    handles[id] = out
  }
  return handles
}

function settleRows(
  sketch: Sketch2D,
  idx: VarIndex,
  x: Float64Array,
  x0: Float64Array,
  weight: number,
): Row[] {
  const rows: Row[] = []
  const shape = weight
  const place = weight * PLACE_RATIO
  const hidden = new Set([...idx.hidden.values()].flat())
  const distance = (state: Float64Array, a: number, c: number) =>
    Math.hypot(state[a] - state[c], state[a + 1] - state[c + 1]) || 1e-9
  const lengthRow = (a: number, c: number) => {
    const L = distance(x, a, c)
    const dx = (x[a] - x[c]) / L
    const dy = (x[a + 1] - x[c + 1]) / L
    rows.push({
      id: 'settle',
      value: shape * (L - distance(x0, a, c)),
      grad: [
        [a, shape * dx],
        [a + 1, shape * dy],
        [c, -shape * dx],
        [c + 1, -shape * dy],
      ],
    })
  }
  for (const e of sketch.entities) {
    if (e.kind === 'line') {
      const a = idx.point.get(e.p1)
      const c = idx.point.get(e.p2)
      if (a !== undefined && c !== undefined) lengthRow(a, c)
    } else if (e.kind === 'arc') {
      const a = idx.point.get(e.p1)
      const c = idx.point.get(e.c)
      if (a !== undefined && c !== undefined) lengthRow(a, c)
    } else if (e.kind === 'circle') {
      const i = idx.radius.get(e.id)!
      rows.push({ id: 'settle', value: shape * (x[i] - x0[i]), grad: [[i, shape]] })
    } else if (isElliptic(e)) {
      const i = idx.ellipse.get(e.id)!
      for (const k of [i, i + 1]) {
        rows.push({ id: 'settle', value: shape * (x[k] - x0[k]), grad: [[k, shape]] })
      }
    }
  }
  for (let i = 0; i < x.length; i++) {
    if (hidden.has(i)) continue
    rows.push({ id: 'settle', value: place * (x[i] - x0[i]), grad: [[i, place]] })
  }
  return rows
}

function descend(
  start: Float64Array,
  rowsAt: (x: Float64Array) => Row[],
  maxIterations: number,
  tolerance: number,
  n: number,
): { x: Float64Array; rows: Row[]; err: number; iterations: number } {
  let x = start
  let rows = rowsAt(x)
  let err = rms(rows)
  let lambda = 1e-3
  let iterations = 0
  for (; iterations < maxIterations && err > tolerance; iterations++) {
    const m = rows.length
    const JtJ = new Float64Array(n * n)
    const Jtf = new Float64Array(n)
    for (let r = 0; r < m; r++) {
      const { grad, value } = rows[r]
      for (const [i, gi] of grad) {
        Jtf[i] += gi * value
        for (const [j, gj] of grad) JtJ[i * n + j] += gi * gj
      }
    }
    for (let i = 0; i < n; i++) {
      JtJ[i * n + i] += lambda * Math.max(JtJ[i * n + i], 1e-6) + 1e-12
    }
    const rhs = new Float64Array(n)
    for (let i = 0; i < n; i++) rhs[i] = -Jtf[i]
    const step = solveDense(JtJ, rhs, n)
    if (!step) {
      lambda *= 10
      if (lambda > 1e12) break
      continue
    }
    const trial = new Float64Array(n)
    for (let i = 0; i < n; i++) trial[i] = x[i] + step[i]
    const trialRows = rowsAt(trial)
    const trialErr = rms(trialRows)
    if (trialErr < err) {
      const gain = err - trialErr
      x = trial
      rows = trialRows
      err = trialErr
      lambda = Math.max(lambda / 3, 1e-12)
      if (gain <= err * 1e-10) break
    } else {
      lambda *= 4
      if (lambda > 1e12) break
    }
  }
  return { x, rows, err, iterations }
}

/**
 * Solve the sketch. Returns updated coordinates without mutating the input,
 * so callers can decide whether to commit the result.
 */
export function solveSketch(sketch: Sketch2D, opts: SolveOptions = {}): SolveResult {
  const maxIterations = opts.maxIterations ?? 100
  const tolerance = opts.tolerance ?? 1e-12
  const idx = buildVarIndex(sketch)
  const n = idx.count

  const emptyResult = (): SolveResult => {
    const x = packState(sketch, idx)
    return {
      ok: true,
      points: Object.fromEntries(sketch.points.map((p) => [p.id, { x: p.x, y: p.y }])),
      radii: Object.fromEntries(
        sketch.entities.filter((e) => e.kind === 'circle').map((e) => [e.id, (e as any).r]),
      ),
      iterations: 0,
      residual: 0,
      dof: n,
      failing: [],
      freePoints: sketch.points.map((p) => p.id),
      freeRadii: sketch.entities.filter((e) => e.kind === 'circle').map((e) => e.id),
      ellipses: Object.fromEntries(
        sketch.entities
          .filter(isElliptic)
          .map((e) => [e.id, { rx: e.rx, ry: e.ry, rotation: e.rotation }]),
      ),
      handles: handlesFrom(idx, x),
      freeEntities: sketch.entities.map((e) => e.id),
    }
  }

  if (n === 0) return emptyResult()

  let x = packState(sketch, idx)
  const x0 = new Float64Array(x)

  let rows = buildRows(sketch, idx, x, opts, x0)
  if (rows.length === 0) {
    const r = emptyResult()
    r.dof = n
    return r
  }

  let iterations = 0
  const constraintRows = (state: Float64Array) => buildRows(sketch, idx, state, opts, x0)
  if (!opts.drag && rms(rows) > tolerance) {
    const settle = opts.settle ?? SETTLE_WEIGHT
    const settled = descend(
      x,
      (state) => [...constraintRows(state), ...settleRows(sketch, idx, state, x0, settle)],
      maxIterations,
      0,
      n,
    )
    x = settled.x
    iterations += settled.iterations
  }
  const exact = descend(x, constraintRows, maxIterations, tolerance, n)
  x = exact.x
  rows = exact.rows
  const err = exact.err
  iterations += exact.iterations

  // Constraints still visibly violated get reported so the UI can flag them.
  const failing: string[] = []
  const byId = new Map<string, number>()
  for (const r of rows) {
    byId.set(r.id, Math.max(byId.get(r.id) ?? 0, Math.abs(r.value)))
  }
  for (const [id, v] of byId) {
    if (v > 1e-4 && id !== 'drag' && id !== 'reg') failing.push(id)
  }

  const points: Record<PointId, { x: number; y: number }> = {}
  for (const p of sketch.points) {
    const i = idx.point.get(p.id)!
    points[p.id] = { x: x[i], y: x[i + 1] }
  }
  const radii: Record<string, number> = {}
  for (const e of sketch.entities) {
    if (e.kind === 'circle') radii[e.id] = Math.abs(x[idx.radius.get(e.id)!])
  }
  const ellipses: Record<string, { rx: number; ry: number; rotation: number }> = {}
  for (const [id, i] of idx.ellipse) {
    ellipses[id] = { rx: Math.abs(x[i]), ry: Math.abs(x[i + 1]), rotation: x[i + 2] / DEG }
  }

  // Rank the Jacobian at the solution, excluding the temporary interaction rows.
  const dofRows = rows.filter((r) => r.id !== 'drag' && r.id !== 'reg')
  const { rank, free } = jacobianAnalysis(dofRows, n)
  const dof = Math.max(0, n - rank)

  const freePoints: string[] = []
  for (const p of sketch.points) {
    const i = idx.point.get(p.id)!
    if (free[i] || free[i + 1]) freePoints.push(p.id)
  }
  const freeRadii: string[] = []
  for (const [entityId, i] of idx.radius) {
    if (free[i]) freeRadii.push(entityId)
  }
  const freeEntities = sketch.entities
    .filter((e) => entityVariables(e, idx).some((i) => free[i]))
    .map((e) => e.id)

  return {
    ok: failing.length === 0,
    points,
    radii,
    iterations,
    residual: err,
    dof,
    failing: [...new Set(failing)],
    freePoints,
    freeRadii,
    ellipses,
    handles: handlesFrom(idx, x),
    freeEntities,
  }
}

/** Apply a solve result back onto a sketch, in place. */
export function applySolve(sketch: Sketch2D, result: SolveResult): void {
  for (const p of sketch.points) {
    const np = result.points[p.id]
    if (np) {
      p.x = np.x
      p.y = np.y
    }
  }
  for (const e of sketch.entities) {
    if (e.kind === 'circle' && result.radii[e.id] !== undefined) {
      e.r = result.radii[e.id]
    }
    if ((e.kind === 'ellipse' || e.kind === 'ellipticalArc') && result.ellipses?.[e.id]) {
      const solved = result.ellipses[e.id]
      e.rx = solved.rx
      e.ry = solved.ry
      e.rotation = solved.rotation
    }
    if (e.kind === 'spline' && result.handles?.[e.id]) {
      const solved = result.handles[e.id]
      if (solved.start) e.startHandle = solved.start
      if (solved.end) e.endHandle = solved.end
    }
  }
}
