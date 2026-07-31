/**
 * SVG path parsing and flattening.
 *
 * replicad hands back 2D projections as SVG path strings. The DXF, SVG and
 * drill-template exporters all need those as plain polylines, plus - for
 * anything that will be drilled or cut - the circles recovered as true circles
 * rather than 64-sided polygons.
 *
 * Self-contained on purpose: this runs inside the worker where there is no DOM,
 * so none of the browser's path APIs are available.
 */
import type { ProjectionResult } from '../kernel/types'

type Pt = [number, number]

/** Segments per curve. At the scales this app works at, plenty. */
const CURVE_SEGMENTS = 24
/** A closed subpath is called a circle if every point is this close to the mean radius. */
const CIRCLE_TOLERANCE = 0.02

function tokenize(d: string): Array<string | number> {
  const out: Array<string | number> = []
  const re = /([MmLlHhVvCcSsQqTtAaZz])|(-?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?)/g
  let m: RegExpExecArray | null
  while ((m = re.exec(d))) {
    out.push(m[1] ? m[1] : Number(m[2]))
  }
  return out
}

function cubic(p0: Pt, p1: Pt, p2: Pt, p3: Pt, out: Pt[]) {
  for (let i = 1; i <= CURVE_SEGMENTS; i++) {
    const t = i / CURVE_SEGMENTS
    const u = 1 - t
    const a = u * u * u
    const b = 3 * u * u * t
    const c = 3 * u * t * t
    const e = t * t * t
    out.push([
      a * p0[0] + b * p1[0] + c * p2[0] + e * p3[0],
      a * p0[1] + b * p1[1] + c * p2[1] + e * p3[1],
    ])
  }
}

function quadratic(p0: Pt, p1: Pt, p2: Pt, out: Pt[]) {
  for (let i = 1; i <= CURVE_SEGMENTS; i++) {
    const t = i / CURVE_SEGMENTS
    const u = 1 - t
    out.push([
      u * u * p0[0] + 2 * u * t * p1[0] + t * t * p2[0],
      u * u * p0[1] + 2 * u * t * p1[1] + t * t * p2[1],
    ])
  }
}

/**
 * Endpoint-parameterised elliptical arc to sampled points, following the
 * conversion in the SVG spec's implementation notes (F.6.5).
 */
function arc(
  p0: Pt,
  rx: number,
  ry: number,
  rotationDeg: number,
  largeArc: boolean,
  sweep: boolean,
  p1: Pt,
  out: Pt[],
) {
  if (rx === 0 || ry === 0) {
    out.push(p1)
    return
  }
  rx = Math.abs(rx)
  ry = Math.abs(ry)
  const phi = (rotationDeg * Math.PI) / 180
  const cosPhi = Math.cos(phi)
  const sinPhi = Math.sin(phi)

  const dx2 = (p0[0] - p1[0]) / 2
  const dy2 = (p0[1] - p1[1]) / 2
  const x1p = cosPhi * dx2 + sinPhi * dy2
  const y1p = -sinPhi * dx2 + cosPhi * dy2

  // Scale the radii up if they are too small to span the two endpoints.
  const lambda = (x1p * x1p) / (rx * rx) + (y1p * y1p) / (ry * ry)
  if (lambda > 1) {
    const s = Math.sqrt(lambda)
    rx *= s
    ry *= s
  }

  const sign = largeArc === sweep ? -1 : 1
  const num = rx * rx * ry * ry - rx * rx * y1p * y1p - ry * ry * x1p * x1p
  const den = rx * rx * y1p * y1p + ry * ry * x1p * x1p
  const co = sign * Math.sqrt(Math.max(0, num / den))
  const cxp = (co * rx * y1p) / ry
  const cyp = (-co * ry * x1p) / rx

  const cx = cosPhi * cxp - sinPhi * cyp + (p0[0] + p1[0]) / 2
  const cy = sinPhi * cxp + cosPhi * cyp + (p0[1] + p1[1]) / 2

  const angleOf = (ux: number, uy: number, vx: number, vy: number) => {
    const dot = ux * vx + uy * vy
    const len = Math.hypot(ux, uy) * Math.hypot(vx, vy)
    let a = Math.acos(Math.min(1, Math.max(-1, dot / len)))
    if (ux * vy - uy * vx < 0) a = -a
    return a
  }

  const theta1 = angleOf(1, 0, (x1p - cxp) / rx, (y1p - cyp) / ry)
  let delta = angleOf(
    (x1p - cxp) / rx,
    (y1p - cyp) / ry,
    (-x1p - cxp) / rx,
    (-y1p - cyp) / ry,
  )
  if (!sweep && delta > 0) delta -= 2 * Math.PI
  if (sweep && delta < 0) delta += 2 * Math.PI

  const steps = Math.max(6, Math.ceil((Math.abs(delta) / (2 * Math.PI)) * 48))
  for (let i = 1; i <= steps; i++) {
    const t = theta1 + (delta * i) / steps
    const ct = Math.cos(t)
    const st = Math.sin(t)
    out.push([
      cx + rx * ct * cosPhi - ry * st * sinPhi,
      cy + rx * ct * sinPhi + ry * st * cosPhi,
    ])
  }
}

/** Flatten one SVG path string into polylines. Each `M` starts a new one. */
export function flattenPath(d: string): Pt[][] {
  const tokens = tokenize(d)
  const paths: Pt[][] = []
  let current: Pt[] = []
  let cursor: Pt = [0, 0]
  let start: Pt = [0, 0]
  let lastControl: Pt | null = null
  let command = ''
  let i = 0

  const num = () => tokens[i++] as number
  const flush = () => {
    if (current.length > 1) paths.push(current)
    current = []
  }

  while (i < tokens.length) {
    const t = tokens[i]
    if (typeof t === 'string') {
      command = t
      i++
      if (command === 'Z' || command === 'z') {
        if (current.length) {
          current.push([start[0], start[1]])
          cursor = [start[0], start[1]]
        }
        flush()
        continue
      }
    }
    const rel = command === command.toLowerCase()
    const ox = rel ? cursor[0] : 0
    const oy = rel ? cursor[1] : 0

    switch (command.toUpperCase()) {
      case 'M': {
        flush()
        cursor = [num() + ox, num() + oy]
        start = [cursor[0], cursor[1]]
        current = [cursor]
        // Subsequent pairs after an M are implicit L commands.
        command = rel ? 'l' : 'L'
        lastControl = null
        break
      }
      case 'L': {
        cursor = [num() + ox, num() + oy]
        current.push(cursor)
        lastControl = null
        break
      }
      case 'H': {
        cursor = [num() + ox, cursor[1]]
        current.push(cursor)
        lastControl = null
        break
      }
      case 'V': {
        cursor = [cursor[0], num() + oy]
        current.push(cursor)
        lastControl = null
        break
      }
      case 'C': {
        const c1: Pt = [num() + ox, num() + oy]
        const c2: Pt = [num() + ox, num() + oy]
        const end: Pt = [num() + ox, num() + oy]
        cubic(cursor, c1, c2, end, current)
        lastControl = c2
        cursor = end
        break
      }
      case 'S': {
        const c1: Pt = lastControl
          ? [2 * cursor[0] - lastControl[0], 2 * cursor[1] - lastControl[1]]
          : cursor
        const c2: Pt = [num() + ox, num() + oy]
        const end: Pt = [num() + ox, num() + oy]
        cubic(cursor, c1, c2, end, current)
        lastControl = c2
        cursor = end
        break
      }
      case 'Q': {
        const c: Pt = [num() + ox, num() + oy]
        const end: Pt = [num() + ox, num() + oy]
        quadratic(cursor, c, end, current)
        lastControl = c
        cursor = end
        break
      }
      case 'T': {
        const c: Pt = lastControl
          ? [2 * cursor[0] - lastControl[0], 2 * cursor[1] - lastControl[1]]
          : cursor
        const end: Pt = [num() + ox, num() + oy]
        quadratic(cursor, c, end, current)
        lastControl = c
        cursor = end
        break
      }
      case 'A': {
        const rx = num()
        const ry = num()
        const rot = num()
        const large = num() !== 0
        const sweep = num() !== 0
        const end: Pt = [num() + ox, num() + oy]
        arc(cursor, rx, ry, rot, large, sweep, end, current)
        cursor = end
        lastControl = null
        break
      }
      default:
        // Unknown command: bail rather than loop forever.
        i = tokens.length
    }
  }
  flush()
  return paths
}

/**
 * Decide whether a closed polyline is really a circle, and if so recover it.
 * Worth the effort: a mounting hole exported as a true DXF circle can be
 * drilled or cut cleanly, where a 48-sided polygon leaves facets.
 *
 * Uses a least-squares (Kasa) fit rather than the centroid. A projected circle
 * arrives as two semicircular arcs whose shared endpoints appear three times in
 * the flattened list, and that repetition drags a centroid far enough off centre
 * to push the radius check past a 2% tolerance - which is exactly how this
 * function failed to spot four perfectly good 2.8 mm holes the first time.
 */
function asCircle(points: Pt[]): { cx: number; cy: number; r: number } | null {
  if (points.length < 12) return null
  const first = points[0]
  const last = points[points.length - 1]
  if (Math.hypot(first[0] - last[0], first[1] - last[1]) > 1e-6) return null

  const pts = points.slice(0, -1)
  const n = pts.length

  // Fit x^2 + y^2 = 2ax + 2by + c, so the centre is (a, b).
  let sxx = 0, sxy = 0, syy = 0, sx = 0, sy = 0
  let sxz = 0, syz = 0, sz = 0
  for (const [x, y] of pts) {
    const z = x * x + y * y
    sxx += x * x
    sxy += x * y
    syy += y * y
    sx += x
    sy += y
    sxz += x * z
    syz += y * z
    sz += z
  }
  // Normal equations for the design matrix rows [2x, 2y, 1].
  const M = [
    [4 * sxx, 4 * sxy, 2 * sx],
    [4 * sxy, 4 * syy, 2 * sy],
    [2 * sx, 2 * sy, n],
  ]
  const rhs = [2 * sxz, 2 * syz, sz]

  // 3x3 Gaussian elimination with partial pivoting.
  for (let col = 0; col < 3; col++) {
    let piv = col
    for (let r = col + 1; r < 3; r++) {
      if (Math.abs(M[r][col]) > Math.abs(M[piv][col])) piv = r
    }
    if (Math.abs(M[piv][col]) < 1e-12) return null
    if (piv !== col) {
      ;[M[col], M[piv]] = [M[piv], M[col]]
      ;[rhs[col], rhs[piv]] = [rhs[piv], rhs[col]]
    }
    for (let r = col + 1; r < 3; r++) {
      const f = M[r][col] / M[col][col]
      for (let k = col; k < 3; k++) M[r][k] -= f * M[col][k]
      rhs[r] -= f * rhs[col]
    }
  }
  const sol = [0, 0, 0]
  for (let r = 2; r >= 0; r--) {
    let s = rhs[r]
    for (let k = r + 1; k < 3; k++) s -= M[r][k] * sol[k]
    sol[r] = s / M[r][r]
  }
  const [cx, cy, c] = sol
  const rsq = c + cx * cx + cy * cy
  if (!(rsq > 1e-12)) return null
  const r = Math.sqrt(rsq)

  for (const [x, y] of pts) {
    if (Math.abs(Math.hypot(x - cx, y - cy) - r) / r > CIRCLE_TOLERANCE) return null
  }
  return { cx, cy, r }
}

/**
 * Flatten a set of SVG paths into the projection result the exporters use.
 *
 * `flipY` is on by default and matters more than it looks: SVG measures Y
 * downward, so replicad's projection of a 70 mm plate comes back spanning
 * y = 0 to -70. Feeding that straight into a DXF would hand the user a
 * mirror-image panel, which is only discovered after it has been cut.
 */
export function flattenSvgPaths(paths: string[], flipY = true): ProjectionResult {
  const polylines: Pt[][] = []
  const circles: ProjectionResult['circles'] = []
  const sy = flipY ? -1 : 1

  for (const d of paths) {
    for (const raw of flattenPath(d)) {
      // Drop repeated points; they add nothing and upset shape fitting.
      const poly: Pt[] = []
      for (const [x, y] of raw) {
        const p: Pt = [x, y * sy]
        const prev = poly[poly.length - 1]
        if (prev && Math.hypot(prev[0] - p[0], prev[1] - p[1]) < 1e-9) continue
        poly.push(p)
      }
      if (poly.length < 2) continue
      // asCircle needs the closing point back to recognise a closed loop.
      const closed: Pt[] =
        Math.hypot(poly[0][0] - poly[poly.length - 1][0], poly[0][1] - poly[poly.length - 1][1]) < 1e-9
          ? poly
          : [...poly, poly[0]]
      const circle = asCircle(closed)
      if (circle) circles.push(circle)
      else polylines.push(poly)
    }
  }

  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  const grow = (x: number, y: number) => {
    minX = Math.min(minX, x)
    minY = Math.min(minY, y)
    maxX = Math.max(maxX, x)
    maxY = Math.max(maxY, y)
  }
  for (const poly of polylines) for (const p of poly) grow(p[0], p[1])
  for (const c of circles) {
    grow(c.cx - c.r, c.cy - c.r)
    grow(c.cx + c.r, c.cy + c.r)
  }
  if (!Number.isFinite(minX)) {
    minX = minY = maxX = maxY = 0
  }

  return { polylines, circles, bounds: [minX, minY, maxX, maxY] }
}
