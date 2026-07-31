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
import type { Constraint, PointId, Sketch2D, SketchEntity } from './types'

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

interface VarIndex {
  /** pointId -> index of its x variable (y is the next one). */
  point: Map<PointId, number>
  /** circle entityId -> index of its radius variable. */
  radius: Map<string, number>
  count: number
}

function buildVarIndex(sketch: Sketch2D): VarIndex {
  const point = new Map<PointId, number>()
  const radius = new Map<string, number>()
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
  return { point, radius, count: n }
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
        if (!A || !B) break
        const d1 = dirOf(A),
          d2 = dirOf(B)
        if (!d1 || !d2) break
        const k = 1 / (d1.len * d2.len) // frozen scale
        if (c.kind === 'parallel') {
          // cross(d1, d2) = 0
          b.push(c.id, k * (d1.ux * d2.uy - d1.uy * d2.ux), [
            [d1.ix1, -k * d2.uy],
            [d1.iy1, k * d2.ux],
            [d1.ix2, k * d2.uy],
            [d1.iy2, -k * d2.ux],
            [d2.ix1, k * d1.uy],
            [d2.iy1, -k * d1.ux],
            [d2.ix2, -k * d1.uy],
            [d2.iy2, k * d1.ux],
          ])
        } else {
          // dot(d1, d2) = 0
          b.push(c.id, k * (d1.ux * d2.ux + d1.uy * d2.uy), [
            [d1.ix1, -k * d2.ux],
            [d1.iy1, -k * d2.uy],
            [d1.ix2, k * d2.ux],
            [d1.iy2, k * d2.uy],
            [d2.ix1, -k * d1.ux],
            [d2.iy1, -k * d1.uy],
            [d2.ix2, k * d1.ux],
            [d2.iy2, k * d1.uy],
          ])
        }
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
        } else if (A.kind !== 'line' && B.kind !== 'line') {
          const ra = radiusOf(A),
            rb = radiusOf(B)
          b.push(
            c.id,
            ra.v - rb.v,
            [...ra.g, ...rb.g.map(([i, g]) => [i, -g] as [number, number])],
          )
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
          // cross(p - p1, u) / |u| = 0, with |u| frozen
          const wx = b.px(c.p) - b.px(e.p1)
          const wy = b.py(c.p) - b.py(e.p1)
          const k = 1 / d.len
          b.push(c.id, k * (wx * d.uy - wy * d.ux), [
            [b.ix(c.p), k * d.uy],
            [b.iy(c.p), -k * d.ux],
            [d.ix1, k * (-d.uy + wy)],
            [d.iy1, k * (-wx + d.ux)],
            [d.ix2, k * -wy],
            [d.iy2, k * wx],
          ])
        }
        break
      }
      case 'pointOnCircle': {
        const e = ent(c.e)
        if (!e || e.kind === 'line') break
        const r = radiusOf(e)
        const dx = b.px(c.p) - b.px(e.c)
        const dy = b.py(c.p) - b.py(e.c)
        const L = Math.hypot(dx, dy) || 1e-9
        b.push(c.id, L - r.v, [
          [b.ix(c.p), dx / L],
          [b.iy(c.p), dy / L],
          [b.ix(e.c), -dx / L],
          [b.iy(e.c), -dy / L],
          ...r.g.map(([i, g]) => [i, -g] as [number, number]),
        ])
        break
      }
      case 'tangent': {
        const L = ent(c.line),
          C = ent(c.circle)
        if (L?.kind !== 'line' || !C || C.kind === 'line') break
        const d = dirOf(L)!
        const r = radiusOf(C)
        const wx = b.px(C.c) - b.px(L.p1)
        const wy = b.py(C.c) - b.py(L.p1)
        const k = 1 / d.len // frozen
        // signed distance from centre to the line, minus the radius
        b.push(c.id, k * (wx * d.uy - wy * d.ux) - c.side * r.v, [
          [b.ix(C.c), k * d.uy],
          [b.iy(C.c), -k * d.ux],
          [d.ix1, k * (-d.uy + wy)],
          [d.iy1, k * (-wx + d.ux)],
          [d.ix2, k * -wy],
          [d.iy2, k * wx],
          ...r.g.map(([i, g]) => [i, -c.side * g] as [number, number]),
        ])
        break
      }
      case 'tangentArcs': {
        const A = ent(c.a),
          B = ent(c.b)
        if (!A || A.kind === 'line' || !B || B.kind === 'line') break
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
      case 'symmetric': {
        const e = ent(c.line)
        if (e?.kind !== 'line') break
        const d = dirOf(e)!
        const k = 1 / d.len
        // midpoint of a-b lies on the line
        const mx = (b.px(c.a) + b.px(c.b)) / 2 - b.px(e.p1)
        const my = (b.py(c.a) + b.py(c.b)) / 2 - b.py(e.p1)
        b.push(c.id, k * (mx * d.uy - my * d.ux), [
          [b.ix(c.a), (k * d.uy) / 2],
          [b.iy(c.a), (-k * d.ux) / 2],
          [b.ix(c.b), (k * d.uy) / 2],
          [b.iy(c.b), (-k * d.ux) / 2],
          [d.ix1, k * (-d.uy + my)],
          [d.iy1, k * (-mx + d.ux)],
          [d.ix2, k * -my],
          [d.iy2, k * mx],
        ])
        // a-b runs square to the line
        const abx = b.px(c.b) - b.px(c.a)
        const aby = b.py(c.b) - b.py(c.a)
        b.push(c.id, k * (abx * d.ux + aby * d.uy), [
          [b.ix(c.b), k * d.ux],
          [b.iy(c.b), k * d.uy],
          [b.ix(c.a), -k * d.ux],
          [b.iy(c.a), -k * d.uy],
          [d.ix1, -k * abx],
          [d.iy1, -k * aby],
          [d.ix2, k * abx],
          [d.iy2, k * aby],
        ])
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
        if (!e || e.kind === 'line') break
        const r = radiusOf(e)
        const target = c.kind === 'radius' ? c.value : c.value / 2
        b.push(c.id, r.v - target, r.g)
        break
      }
      case 'angle': {
        const A = ent(c.a),
          B = ent(c.b)
        const d1 = A && dirOf(A),
          d2 = B && dirOf(B)
        if (!d1 || !d2) break
        const th = (c.value * Math.PI) / 180
        const cs = Math.cos(th),
          sn = Math.sin(th)
        const k = 1 / (d1.len * d2.len) // frozen
        // cross * cos(theta) - dot * sin(theta) = 0
        const cross = d1.ux * d2.uy - d1.uy * d2.ux
        const dot = d1.ux * d2.ux + d1.uy * d2.uy
        b.push(c.id, k * (cross * cs - dot * sn), [
          [d1.ix1, k * (-d2.uy * cs + d2.ux * sn)],
          [d1.iy1, k * (d2.ux * cs + d2.uy * sn)],
          [d1.ix2, k * (d2.uy * cs - d2.ux * sn)],
          [d1.iy2, k * (-d2.ux * cs - d2.uy * sn)],
          [d2.ix1, k * (d1.uy * cs + d1.ux * sn)],
          [d2.iy1, k * (-d1.ux * cs + d1.uy * sn)],
          [d2.ix2, k * (-d1.uy * cs - d1.ux * sn)],
          [d2.iy2, k * (d1.ux * cs - d1.uy * sn)],
        ])
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

/**
 * Solve the sketch. Returns updated coordinates without mutating the input,
 * so callers can decide whether to commit the result.
 */
export function solveSketch(sketch: Sketch2D, opts: SolveOptions = {}): SolveResult {
  const maxIterations = opts.maxIterations ?? 100
  const tolerance = opts.tolerance ?? 1e-12
  const idx = buildVarIndex(sketch)
  const n = idx.count

  const emptyResult = (): SolveResult => ({
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
  })

  if (n === 0) return emptyResult()

  let x = packState(sketch, idx)
  const x0 = new Float64Array(x)

  let rows = buildRows(sketch, idx, x, opts, x0)
  if (rows.length === 0) {
    const r = emptyResult()
    r.dof = n
    return r
  }

  let lambda = 1e-3
  let err = rms(rows)
  let iterations = 0

  for (; iterations < maxIterations && err > tolerance; iterations++) {
    const m = rows.length
    // Normal equations: (J'J + lambda*diag) dx = -J'f
    const JtJ = new Float64Array(n * n)
    const Jtf = new Float64Array(n)
    for (let r = 0; r < m; r++) {
      const { grad, value } = rows[r]
      for (const [i, gi] of grad) {
        Jtf[i] += gi * value
        for (const [j, gj] of grad) JtJ[i * n + j] += gi * gj
      }
    }
    // Levenberg damping only. Anything added to the objective here (rather
    // than as a residual row) biases the converged answer, which is how the
    // first version of this solver ended up half a micron short on every
    // dimension. The absolute floor keeps variables that appear in no
    // constraint from producing a singular pivot.
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
    const trialRows = buildRows(sketch, idx, trial, opts, x0)
    const trialErr = rms(trialRows)

    if (trialErr < err) {
      x = trial
      rows = trialRows
      err = trialErr
      lambda = Math.max(lambda / 3, 1e-12)
    } else {
      lambda *= 4
      if (lambda > 1e12) break
    }
  }

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
  }
}
